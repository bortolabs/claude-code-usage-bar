import { describe, expect, it } from "vitest";
import { evaluateAdvice, AdvisorInput } from "../src/advisor";

/** Input sintético com overrides pontuais — tudo null/ausente por padrão. */
const base = (over: Partial<AdvisorInput> = {}): AdvisorInput => ({
  fiveHourPct: null,
  sevenDayPct: null,
  sevenDaySonnet: null,
  sevenDayOpus: null,
  blockTokens: null,
  tokensPerMinute: null,
  remainingMinutes: null,
  peak: null,
  ...over,
});

const NOW = 1_700_000_000_000; // epoch fixo p/ determinismo
const DAY = 86_400_000;

describe("evaluateAdvice", () => {
  describe("regra modelSwitch (histerese)", () => {
    it("opus 82% + sonnet 31% → dispara, warn, notify, detail com reset", () => {
      const r = evaluateAdvice(
        base({
          sevenDayOpus: { utilization: 82, resetsAt: NOW + 2 * DAY },
          sevenDaySonnet: { utilization: 31, resetsAt: null },
          nowMs: NOW,
        })
      );
      const advice = r.find((a) => a.key === "modelSwitch");
      expect(advice).toBeDefined();
      expect(advice!.severity).toBe("warn");
      expect(advice!.notify).toBe(true);
      expect(advice!.detail).toContain("(reseta em 2d)");
    });

    it("opus null (plano Pro) → não dispara modelSwitch", () => {
      const r = evaluateAdvice(
        base({
          sevenDayOpus: null,
          sevenDaySonnet: { utilization: 10, resetsAt: null },
          nowMs: NOW,
        })
      );
      expect(r.find((a) => a.key === "modelSwitch")).toBeUndefined();
    });

    it("limiar de entrada: 69% NÃO dispara, 70% dispara (sem activeKeys)", () => {
      const r69 = evaluateAdvice(
        base({
          sevenDayOpus: { utilization: 69, resetsAt: null },
          sevenDaySonnet: { utilization: 10, resetsAt: null },
          nowMs: NOW,
        })
      );
      expect(r69.find((a) => a.key === "modelSwitch")).toBeUndefined();

      const r70 = evaluateAdvice(
        base({
          sevenDayOpus: { utilization: 70, resetsAt: null },
          sevenDaySonnet: { utilization: 10, resetsAt: null },
          nowMs: NOW,
        })
      );
      expect(r70.find((a) => a.key === "modelSwitch")).toBeDefined();
    });

    it("histerese de utilização: 67% com activeKeys ainda dispara (saída em 65%); 64% não dispara", () => {
      const active = new Set(["modelSwitch"]);

      const r67 = evaluateAdvice(
        base({
          sevenDayOpus: { utilization: 67, resetsAt: null },
          sevenDaySonnet: { utilization: 10, resetsAt: null },
          nowMs: NOW,
        }),
        active
      );
      expect(r67.find((a) => a.key === "modelSwitch")).toBeDefined();

      const r64 = evaluateAdvice(
        base({
          sevenDayOpus: { utilization: 64, resetsAt: null },
          sevenDaySonnet: { utilization: 10, resetsAt: null },
          nowMs: NOW,
        }),
        active
      );
      expect(r64.find((a) => a.key === "modelSwitch")).toBeUndefined();
    });

    it("histerese de gap: gap 25 não dispara sem activeKeys (precisa 30), mas dispara com activeKeys (precisa 25)", () => {
      const input = base({
        sevenDayOpus: { utilization: 70, resetsAt: null },
        sevenDaySonnet: { utilization: 45, resetsAt: null },
        nowMs: NOW,
      });

      const rSemActive = evaluateAdvice(input);
      expect(rSemActive.find((a) => a.key === "modelSwitch")).toBeUndefined();

      const rComActive = evaluateAdvice(input, new Set(["modelSwitch"]));
      expect(rComActive.find((a) => a.key === "modelSwitch")).toBeDefined();
    });
  });

  describe("regra fitsUntilReset", () => {
    it("fiveHourPct 50 + blockTokens 10M → cabem ~10.0M, info, sem notify", () => {
      const r = evaluateAdvice(
        base({ fiveHourPct: 50, blockTokens: 10_000_000, nowMs: NOW })
      );
      const advice = r.find((a) => a.key === "fitsUntilReset");
      expect(advice).toBeDefined();
      expect(advice!.title).toContain("10.0M");
      expect(advice!.severity).toBe("info");
      expect(advice!.notify).toBe(false);
    });

    it("limitado pelo ritmo×tempo: tokensPerMinute 10k × remainingMinutes 100 → 1.0M", () => {
      const r = evaluateAdvice(
        base({
          fiveHourPct: 50,
          blockTokens: 10_000_000,
          tokensPerMinute: 10_000,
          remainingMinutes: 100,
          nowMs: NOW,
        })
      );
      const advice = r.find((a) => a.key === "fitsUntilReset");
      expect(advice).toBeDefined();
      expect(advice!.title).toContain("1.0M");
    });

    it("guarda: fiveHourPct 3 (< 5) → ausente", () => {
      const r = evaluateAdvice(
        base({ fiveHourPct: 3, blockTokens: 10_000_000, nowMs: NOW })
      );
      expect(r.find((a) => a.key === "fitsUntilReset")).toBeUndefined();
    });

    it("guarda: fiveHourPct 100 → ausente", () => {
      const r = evaluateAdvice(
        base({ fiveHourPct: 100, blockTokens: 10_000_000, nowMs: NOW })
      );
      expect(r.find((a) => a.key === "fitsUntilReset")).toBeUndefined();
    });

    it("guarda: blockTokens null → ausente", () => {
      const r = evaluateAdvice(
        base({ fiveHourPct: 50, blockTokens: null, nowMs: NOW })
      );
      expect(r.find((a) => a.key === "fitsUntilReset")).toBeUndefined();
    });
  });

  describe("regras goodWindow / weekTight", () => {
    it("fiveHourPct 5 + sevenDayPct 30 → goodWindow (info)", () => {
      const r = evaluateAdvice(
        base({ fiveHourPct: 5, sevenDayPct: 30, nowMs: NOW })
      );
      const advice = r.find((a) => a.key === "goodWindow");
      expect(advice).toBeDefined();
      expect(advice!.severity).toBe("info");
    });

    it("peak batendo com dia/hora atuais → detail menciona 'pico'", () => {
      const d = new Date(NOW);
      const r = evaluateAdvice(
        base({
          fiveHourPct: 5,
          sevenDayPct: 30,
          peak: { weekday: d.getDay(), hour: d.getHours() },
          nowMs: NOW,
        })
      );
      const advice = r.find((a) => a.key === "goodWindow");
      expect(advice).toBeDefined();
      expect(advice!.detail).toContain("pico");
    });

    it("peak fora do dia/hora atuais → detail NÃO menciona 'pico'", () => {
      const d = new Date(NOW);
      const otherWeekday = (d.getDay() + 1) % 7;
      const r = evaluateAdvice(
        base({
          fiveHourPct: 5,
          sevenDayPct: 30,
          peak: { weekday: otherWeekday, hour: d.getHours() },
          nowMs: NOW,
        })
      );
      const advice = r.find((a) => a.key === "goodWindow");
      expect(advice).toBeDefined();
      expect(advice!.detail).not.toContain("pico");
    });

    it("sevenDayPct 90 → weekTight (warn) e NÃO goodWindow", () => {
      const r = evaluateAdvice(
        base({ fiveHourPct: 5, sevenDayPct: 90, nowMs: NOW })
      );
      const weekTight = r.find((a) => a.key === "weekTight");
      expect(weekTight).toBeDefined();
      expect(weekTight!.severity).toBe("warn");
      expect(r.find((a) => a.key === "goodWindow")).toBeUndefined();
    });

    it("histerese weekTight: 82% com activeKeys ainda dispara (saída em 80%); 79% não dispara", () => {
      const active = new Set(["weekTight"]);

      const r82 = evaluateAdvice(
        base({ fiveHourPct: 5, sevenDayPct: 82, nowMs: NOW }),
        active
      );
      expect(r82.find((a) => a.key === "weekTight")).toBeDefined();

      const r79 = evaluateAdvice(
        base({ fiveHourPct: 5, sevenDayPct: 79, nowMs: NOW }),
        active
      );
      expect(r79.find((a) => a.key === "weekTight")).toBeUndefined();
    });
  });

  it("input vazio (tudo null) → []", () => {
    const r = evaluateAdvice(base({ nowMs: NOW }));
    expect(r).toEqual([]);
  });
});
