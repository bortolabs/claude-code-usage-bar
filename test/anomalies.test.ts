import { describe, expect, it } from "vitest";
import {
  computeAnomalies,
  computeAnomalyTexts,
  DEFAULT_ANOMALY_THRESHOLDS,
} from "../src/anomalies";
import { TranscriptStats } from "../src/transcriptStats";

/** TranscriptStats sintético: 20 turnos, tudo "saudável" por padrão. */
const stats = (over: Partial<TranscriptStats> = {}): TranscriptStats => ({
  byModel: [],
  byProject: [],
  byContextBucket: [],
  byMcpServer: [],
  bySubagent: [],
  bySkill: [],
  byPlugin: [],
  byDay: [],
  byHour: [],
  bySession: [],
  totalTokens: 1_000_000,
  totalCostUSD: 10,
  turns: 20,
  tokenTotals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costByType: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  longSessionCostShare: 0,
  ctxInflatedTurns: 0,
  maxToolRunLength: 0,
  toolLoopName: "",
  approximate: true,
  tableVersion: "test",
  ...over,
});

const ids = (s: TranscriptStats, th = {}) => computeAnomalies(s, th).map((a) => a.id);

describe("computeAnomalies", () => {
  it("amostra pequena (turnos < 5) → sem anomalias", () => {
    expect(computeAnomalies(stats({ turns: 3, maxToolRunLength: 10 }))).toEqual([]);
  });

  it("stats saudável → nenhuma anomalia", () => {
    expect(computeAnomalies(stats())).toEqual([]);
  });

  describe("toolLoop (crit)", () => {
    it("run ≥ K com nome → dispara", () => {
      const out = computeAnomalies(stats({ maxToolRunLength: 5, toolLoopName: "Bash" }));
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("toolLoop");
      expect(out[0].level).toBe("crit");
      expect(out[0].values).toMatchObject({ name: "Bash", runs: 5 });
    });
    it("run < K → não dispara", () => {
      expect(ids(stats({ maxToolRunLength: 4, toolLoopName: "Bash" }))).not.toContain("toolLoop");
    });
    it("run alto mas sem nome → não dispara", () => {
      expect(ids(stats({ maxToolRunLength: 9, toolLoopName: "" }))).not.toContain("toolLoop");
    });
    it("respeita threshold custom", () => {
      expect(ids(stats({ maxToolRunLength: 3, toolLoopName: "Read" }), { toolLoopK: 3 })).toContain("toolLoop");
    });
  });

  describe("ctxInflated (warn)", () => {
    it("turnos inflados ≥ limiar → dispara", () => {
      const out = computeAnomalies(stats({ ctxInflatedTurns: 3 }));
      expect(out.map((a) => a.id)).toContain("ctxInflated");
      expect(out.find((a) => a.id === "ctxInflated")?.values).toMatchObject({ turns: 3 });
    });
    it("abaixo do limiar → não dispara", () => {
      expect(ids(stats({ ctxInflatedTurns: 2 }))).not.toContain("ctxInflated");
    });
    it("threshold custom mais alto suprime", () => {
      expect(ids(stats({ ctxInflatedTurns: 3 }), { ctxInflatedTurns: 10 })).not.toContain("ctxInflated");
    });
  });

  describe("cacheLow (warn)", () => {
    it("hit rate abaixo do piso → dispara", () => {
      const out = computeAnomalies(
        stats({ tokenTotals: { input: 0, output: 0, cacheRead: 30, cacheWrite: 70 } })
      );
      const a = out.find((x) => x.id === "cacheLow");
      expect(a).toBeTruthy();
      expect(a?.values.pct).toBe(30);
    });
    it("hit rate acima do piso → não dispara", () => {
      const s = stats({ tokenTotals: { input: 0, output: 0, cacheRead: 80, cacheWrite: 20 } });
      expect(ids(s)).not.toContain("cacheLow");
    });
    it("sem tokens de cache → não dispara (evita divisão por zero)", () => {
      expect(ids(stats())).not.toContain("cacheLow");
    });
  });

  describe("mcpRunaway (warn)", () => {
    it("servidor MCP acima do máximo → dispara", () => {
      const out = computeAnomalies(stats({ byMcpServer: [{ name: "github", calls: 80 }] }));
      const a = out.find((x) => x.id === "mcpRunaway");
      expect(a?.values).toMatchObject({ name: "github", calls: 80 });
    });
    it("abaixo do máximo → não dispara", () => {
      expect(ids(stats({ byMcpServer: [{ name: "github", calls: 40 }] }))).not.toContain("mcpRunaway");
    });
  });

  it("ordena crit antes de warn e limita a 5", () => {
    const out = computeAnomalies(
      stats({
        maxToolRunLength: 6,
        toolLoopName: "Bash",
        ctxInflatedTurns: 5,
        tokenTotals: { input: 0, output: 0, cacheRead: 10, cacheWrite: 90 },
        byMcpServer: [{ name: "x", calls: 100 }],
      })
    );
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out[0].level).toBe("crit");
  });

  it("usa DEFAULT_ANOMALY_THRESHOLDS quando não passa thresholds", () => {
    expect(DEFAULT_ANOMALY_THRESHOLDS.toolLoopK).toBe(5);
    expect(ids(stats({ maxToolRunLength: 5, toolLoopName: "Bash" }))).toContain("toolLoop");
  });
});

describe("computeAnomalyTexts", () => {
  it("retorna texto não-vazio e o nível de cada anomalia", () => {
    const out = computeAnomalyTexts(stats({ maxToolRunLength: 7, toolLoopName: "Bash" }));
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("crit");
    expect(out[0].text.length).toBeGreaterThan(0);
    expect(out[0].text).toContain("Bash");
  });

  it("stats saudável → lista vazia", () => {
    expect(computeAnomalyTexts(stats())).toEqual([]);
  });
});
