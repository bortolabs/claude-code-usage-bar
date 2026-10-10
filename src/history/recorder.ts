import { DayStat, HourStat, dayKey } from "../transcriptStats";
import { pickBackfill, snapshotsFromStats } from "./aggregate";
import { HistoryStore } from "./store";

/**
 * Gravação do histórico persistente a partir dos transcripts, sem segurar a thread
 * do extension host: a varredura é assíncrona e o store só é tocado depois dela.
 * Sem `vscode` — as dependências entram por parâmetro, p/ ser testável em unidade.
 */

/**
 * Dias recentes (além de hoje) que TODA gravação regrava. O byHour do
 * transcriptStats cobre ~72h, então hoje + 2 dias sempre saem com o split por
 * hora completo, seja qual for o tamanho da janela varrida.
 */
const FRESH_DAYS = 2;

export interface HistoryRecorderDeps {
  store: Pick<HistoryStore, "readAll" | "upsert">;
  /** Varre os transcripts em [startMs, endMs]. null = interrompida por `shouldStop`. */
  scan: (
    startMs: number,
    endMs: number,
    shouldStop: () => boolean
  ) => Promise<{ byDay: DayStat[]; byHour: HourStat[] } | null>;
  isEnabled: () => boolean;
  retentionDays: () => number;
  /** Chamado depois de cada gravação efetiva no store. */
  onWritten: () => void;
  now?: () => number;
}

export interface HistoryRecorder {
  /**
   * Varre `windowDays` dias e grava: dias ausentes do store + os dias recentes
   * (sempre regravados). Janela curta (2) no tick de 15min; longa (90) na
   * ativação, pra preencher o que ficou pra trás. Nunca rejeita.
   */
  run(windowDays: number): Promise<void>;
  dispose(): void;
  isDisposed(): boolean;
}

/** Meia-noite LOCAL de `days` dias antes de `ts` — por calendário, imune a horário de verão. */
function localMidnightDaysAgo(ts: number, days: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

export function createHistoryRecorder(deps: HistoryRecorderDeps): HistoryRecorder {
  const now = deps.now ?? Date.now;
  let busy = false;
  let disposed = false;

  const run = async (windowDays: number): Promise<void> => {
    // Uma varredura por vez: o tick que cair no meio de outra é pulado (a
    // próxima cobre os mesmos dias).
    if (busy || disposed || !deps.isEnabled()) {
      return;
    }
    busy = true;
    try {
      // Instantes fixados ANTES da varredura: ela pode cruzar a meia-noite.
      const end = now();
      const start = localMidnightDaysAgo(end, windowDays);
      const overwriteFrom = dayKey(localMidnightDaysAgo(end, FRESH_DAYS));
      const s = await deps.scan(start, end, () => disposed);
      // A varredura leva tempo: o setting pode ter sido desligado e a extensão
      // descartada nesse meio. Daqui até o upsert é síncrono — o `existing`
      // lido é o que vale na hora de gravar.
      if (!s || disposed || !deps.isEnabled()) {
        return;
      }
      const existing = new Set(deps.store.readAll().map((d) => d.date));
      const snaps = pickBackfill(
        snapshotsFromStats(s.byDay, s.byHour),
        existing,
        overwriteFrom
      );
      if (snaps.length) {
        deps.store.upsert(snaps, deps.retentionDays());
        deps.onWritten();
      }
    } catch {
      // best-effort: histórico nunca derruba o resto
    } finally {
      busy = false;
    }
  };

  return {
    run,
    dispose: () => {
      disposed = true;
    },
    isDisposed: () => disposed,
  };
}
