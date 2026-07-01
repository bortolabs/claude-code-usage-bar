import { describe, expect, it } from "vitest";
import { computeInsights } from "../src/insights";
import { TranscriptStats } from "../src/transcriptStats";

/** TranscriptStats sintético: custo total 10, 20 turnos, tudo zerado por padrão. */
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
  approximate: true,
  tableVersion: "test",
  ...over,
});

describe("computeInsights", () => {
  it("amostra pequena (turnos < 5 ou custo 0) → sem insights", () => {
    expect(computeInsights(stats({ turns: 3 }))).toEqual([]);
    expect(computeInsights(stats({ totalCostUSD: 0 }))).toEqual([]);
  });

  it("contexto >150k concentrando ≥40% do custo → ctxBig (warn)", () => {
    const s = stats({
      byContextBucket: [
        { bucket: ">200k", tokens: 0, costUSD: 5, turns: 5 },
        { bucket: "<50k", tokens: 0, costUSD: 5, turns: 15 },
      ],
    });
    const ids = computeInsights(s).map((i) => i.id);
    expect(ids).toContain("ctxBig");
  });

  it("cache hit ≥85% → cacheGood; <50% → cacheLow", () => {
    const good = stats({
      tokenTotals: { input: 0, output: 0, cacheRead: 90, cacheWrite: 10 },
    });
    expect(computeInsights(good).map((i) => i.id)).toContain("cacheGood");

    const low = stats({
      tokenTotals: { input: 0, output: 0, cacheRead: 40, cacheWrite: 60 },
    });
    expect(computeInsights(low).map((i) => i.id)).toContain("cacheLow");
  });

  it("Opus ≥60% do custo → insight opus", () => {
    const s = stats({
      byModel: [
        { model: "Opus 4.8", tokens: 0, costUSD: 7, input: 0, output: 0,
          cacheRead: 0, cacheWrite: 0, messages: 1 },
      ],
    });
    expect(computeInsights(s).map((i) => i.id)).toContain("opus");
  });

  it("warn vem antes de info/good e no máximo 5 insights", () => {
    const s = stats({
      longSessionCostShare: 0.6, // warn
      byContextBucket: [{ bucket: ">200k", tokens: 0, costUSD: 10, turns: 5 }], // warn
      tokenTotals: { input: 0, output: 0, cacheRead: 95, cacheWrite: 5 }, // good
      costByType: { input: 0, output: 5, cacheRead: 0, cacheWrite: 0 }, // info
      byMcpServer: [{ name: "supabase", calls: 99 }], // info
      byModel: [{ model: "Opus 4.8", tokens: 0, costUSD: 10, input: 0,
        output: 0, cacheRead: 0, cacheWrite: 0, messages: 1 }], // info
    });
    const out = computeInsights(s);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out[0].level).toBe("warn");
    const levels = out.map((i) => i.level);
    expect(levels.indexOf("warn")).toBeLessThan(
      Math.max(levels.indexOf("info"), levels.indexOf("good"))
    );
  });
});
