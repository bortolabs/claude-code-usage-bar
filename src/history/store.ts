import * as fs from "fs";
import * as path from "path";

/**
 * Histórico local persistente de uso — sobrevive à retenção de transcripts do
 * Claude Code (que apaga os .jsonl antigos e encolhe o "Tudo" do dashboard).
 *
 * Formato: JSONL em `<globalStorage>/history.jsonl`, UMA linha por DIA:
 *   { date: "YYYY-MM-DD", tokens, costUSD, msgs, hours: number[24] }
 * `hours[h]` = tokens consumidos na hora local h. A linha do dia corrente é
 * REESCRITA a cada snapshot (upsert do dia); dias fechados ficam imutáveis.
 * Escrita atômica (tmp + rename) — appends concorrentes de outra janela do
 * VS Code no máximo perdem um snapshot intermediário, nunca corrompem o todo.
 */

export interface DaySnapshot {
  date: string; // YYYY-MM-DD (local)
  tokens: number;
  costUSD: number;
  msgs: number;
  /** Tokens por hora local (0..23). */
  hours: number[];
}

function isSnapshot(o: unknown): o is DaySnapshot {
  const s = o as DaySnapshot;
  return (
    !!s &&
    typeof s.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
    typeof s.tokens === "number" &&
    typeof s.costUSD === "number" &&
    Array.isArray(s.hours)
  );
}

export class HistoryStore {
  private file: string;

  constructor(storageDir: string) {
    this.file = path.join(storageDir, "history.jsonl");
    try {
      fs.mkdirSync(storageDir, { recursive: true });
    } catch {
      // best-effort
    }
  }

  /** Lê todos os dias válidos (linhas corrompidas são puladas), ordenados por data. */
  readAll(): DaySnapshot[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    const byDate = new Map<string, DaySnapshot>();
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const o = JSON.parse(line);
        if (isSnapshot(o)) {
          byDate.set(o.date, o); // última linha do dia vence (upsert)
        }
      } catch {
        // linha torn/corrompida — ignora
      }
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /** Últimos `days` dias (ordenados asc). */
  readRange(days: number): DaySnapshot[] {
    const all = this.readAll();
    return all.slice(-Math.max(0, days));
  }

  /**
   * Upsert dos dias informados (tipicamente o dia corrente e, na virada, o
   * anterior) + poda por retenção. Reescreve o arquivo de forma atômica.
   */
  upsert(snapshots: DaySnapshot[], retentionDays: number): void {
    const byDate = new Map<string, DaySnapshot>();
    for (const s of this.readAll()) {
      byDate.set(s.date, s);
    }
    for (const s of snapshots) {
      if (isSnapshot(s)) {
        byDate.set(s.date, s);
      }
    }
    let all = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (retentionDays > 0 && all.length > retentionDays) {
      all = all.slice(-retentionDays);
    }
    const body = all.map((s) => JSON.stringify(s)).join("\n") + "\n";
    try {
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, body);
      try {
        fs.renameSync(tmp, this.file);
      } catch {
        fs.writeFileSync(this.file, body);
        try {
          fs.unlinkSync(tmp);
        } catch {
          // ignora
        }
      }
    } catch {
      // best-effort: sem permissão/disco — não derruba o tick
    }
  }
}
