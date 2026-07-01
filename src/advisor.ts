import { tr } from "./i18n";

/**
 * Copiloto de cota — conselhos LOCAIS e contínuos (sem LLM, sem rede),
 * complementares ao AI advice (que é sob demanda). Espelha o formato do
 * alerts.ts: função pura `evaluateAdvice(input)` → lista de conselhos.
 *
 * Anti-flapping: regras com limiar usam HISTERESE — o limiar de ENTRADA vale
 * quando o conselho não está ativo; uma vez ativo (key em `activeKeys`), só sai
 * quando cruzar o limiar de SAÍDA (alguns pontos abaixo). O chamador guarda as
 * keys ativas do render anterior.
 */

export interface AdvisorWindow {
  utilization: number; // 0..100
  resetsAt: number | null; // epoch ms
}

export interface AdvisorInput {
  fiveHourPct: number | null;
  sevenDayPct: number | null;
  sevenDaySonnet: AdvisorWindow | null;
  sevenDayOpus: AdvisorWindow | null;
  /** Tokens consumidos no bloco 5h atual (ccusage) — p/ "o que ainda cabe". */
  blockTokens: number | null;
  tokensPerMinute: number | null;
  remainingMinutes: number | null;
  /** Pico do heatmap (histórico), se houver — enriquece a dica de janela. */
  peak: { weekday: number; hour: number } | null;
  nowMs?: number;
}

export interface Advice {
  key: string;
  severity: "info" | "warn";
  title: string;
  detail: string;
  /** true = candidata a notificação nativa (gated por advisorNotifyEnabled). */
  notify: boolean;
}

/** Limiar com histerese: entra em `enter`, só sai abaixo de `exit`. */
function over(
  value: number,
  enter: number,
  exit: number,
  isActive: boolean
): boolean {
  return value >= (isActive ? exit : enter);
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(1) + "M";
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(0) + "k";
  }
  return String(Math.max(0, Math.round(n)));
}

function fmtDays(ms: number): string {
  const d = ms / 86_400_000;
  if (d >= 1) {
    return Math.round(d) + "d";
  }
  const h = Math.max(1, Math.round(ms / 3_600_000));
  return h + "h";
}

export function evaluateAdvice(
  input: AdvisorInput,
  activeKeys: ReadonlySet<string> = new Set()
): Advice[] {
  const now = input.nowMs ?? Date.now();
  const out: Advice[] = [];

  // 1. Troca de modelo: Opus semanal apertado E Sonnet com folga clara.
  //    Só existe quando o plano tem janela dedicada de Opus (Max; null no Pro).
  const opus = input.sevenDayOpus;
  const sonnet = input.sevenDaySonnet;
  if (opus && sonnet) {
    const active = activeKeys.has("modelSwitch");
    const opusHigh = over(opus.utilization, 70, 65, active);
    const gap = opus.utilization - sonnet.utilization;
    if (opusHigh && gap >= (active ? 25 : 30)) {
      const reset = opus.resetsAt && opus.resetsAt > now
        ? " " + tr("(reseta em {0})", fmtDays(opus.resetsAt - now))
        : "";
      out.push({
        key: "modelSwitch",
        severity: "warn",
        title: tr("Opus semanal em {0}%", Math.round(opus.utilization)),
        detail: tr(
          "Sonnet está em {0}% — considere Sonnet nas tarefas comuns até o reset{1}.",
          Math.round(sonnet.utilization),
          reset
        ),
        notify: true,
      });
    }
  }

  // 2. O que ainda cabe até o reset (estimativa, sempre com "~").
  //    tokens-por-ponto do bloco atual × pontos restantes, limitado pelo
  //    ritmo×tempo quando o ccusage informa tokens/min.
  if (
    input.fiveHourPct != null &&
    input.fiveHourPct >= 5 &&
    input.fiveHourPct < 100 &&
    input.blockTokens != null &&
    input.blockTokens > 0
  ) {
    const perPct = input.blockTokens / input.fiveHourPct;
    let fits = (100 - input.fiveHourPct) * perPct;
    if (
      input.tokensPerMinute != null &&
      input.tokensPerMinute > 0 &&
      input.remainingMinutes != null &&
      input.remainingMinutes > 0
    ) {
      fits = Math.min(fits, input.tokensPerMinute * input.remainingMinutes);
    }
    if (fits > 0) {
      out.push({
        key: "fitsUntilReset",
        severity: "info",
        title: tr("Cabem ~{0} tokens até o reset", fmtTok(fits)),
        detail: tr("Estimativa no ritmo atual da sessão de 5h."),
        notify: false,
      });
    }
  }

  // 3. Janela: recém-resetada e semana folgada = bom momento; semana quase no
  //    limite = priorize. Mutuamente exclusivas.
  if (input.fiveHourPct != null && input.sevenDayPct != null) {
    const tightActive = activeKeys.has("weekTight");
    if (over(input.sevenDayPct, 85, 80, tightActive)) {
      out.push({
        key: "weekTight",
        severity: "warn",
        title: tr("Semana quase no limite ({0}%)", Math.round(input.sevenDayPct)),
        detail: tr("Priorize o que importa — o limite semanal reseta mais devagar que o de 5h."),
        notify: false,
      });
    } else if (input.fiveHourPct < 10 && input.sevenDayPct < 50) {
      let extra = "";
      if (input.peak) {
        const d = new Date(now);
        if (
          d.getDay() === input.peak.weekday &&
          d.getHours() === input.peak.hour
        ) {
          extra = " " + tr("Normalmente este é seu horário de pico.");
        }
      }
      out.push({
        key: "goodWindow",
        severity: "info",
        title: tr("Bom momento para trabalho pesado"),
        detail:
          tr("Janela de 5h recém-resetada e semana com folga.") + extra,
        notify: false,
      });
    }
  }

  return out;
}
