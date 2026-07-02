import { describe, expect, it } from "vitest";
import { forecastFiveHour, lightestUpcomingHour } from "../src/core/forecast";

/** Heatmap 7×24 com a MESMA curva diurna em todo weekday (weekday vira irrelevante). */
function heatFromHourly(profile: number[]): number[][] {
  return Array.from({ length: 7 }, () => profile.slice());
}

/** Perfil de 24h só com os valores informados por hora; resto 0. */
function profile(byHour: Record<number, number>): number[] {
  const p = new Array(24).fill(0);
  for (const [h, v] of Object.entries(byHour)) {
    p[Number(h)] = v;
  }
  return p;
}

// Janela de 5h fixa: começa 10:00, reseta 15:00 (horário LOCAL).
const RESET = new Date(2026, 5, 3, 15, 0, 0).getTime();
const at = (h: number, m = 0) => new Date(2026, 5, 3, h, m, 0).getTime();

describe("forecastFiveHour", () => {
  it("heatmap uniforme colapsa no linear (invariante)", () => {
    const heatmap = heatFromHourly(new Array(24).fill(100));
    const r = forecastFiveHour({
      usedPct: 50,
      fiveHourResetMs: RESET,
      heatmap,
      nowMs: at(12, 30), // 2.5h decorridas
    });
    expect(r).not.toBeNull();
    expect(r!.method).toBe("heatmap");
    expect(r!.linearPct).toBe(100);
    expect(r!.projectedPct).toBeGreaterThanOrEqual(99);
    expect(r!.projectedPct).toBeLessThanOrEqual(100);
  });

  it("passado pesado + futuro leve → projeta ABAIXO do linear (fits)", () => {
    const heatmap = heatFromHourly(
      profile({ 10: 300, 11: 300, 12: 60, 13: 30, 14: 30 })
    );
    const r = forecastFiveHour({
      usedPct: 50,
      fiveHourResetMs: RESET,
      heatmap,
      nowMs: at(12, 30),
    });
    expect(r).not.toBeNull();
    expect(r!.method).toBe("heatmap");
    expect(r!.projectedPct).toBeLessThan(r!.linearPct!); // < linear
    expect(r!.verdict).toBe("fits");
  });

  it("passado leve + futuro pesado → projeta ACIMA do linear (exhausts)", () => {
    const heatmap = heatFromHourly(
      profile({ 10: 30, 11: 30, 12: 60, 13: 300, 14: 300 })
    );
    const r = forecastFiveHour({
      usedPct: 50,
      fiveHourResetMs: RESET,
      heatmap,
      nowMs: at(12, 30),
    });
    expect(r).not.toBeNull();
    expect(r!.method).toBe("heatmap");
    expect(r!.projectedPct).toBeGreaterThan(r!.linearPct!); // > linear
    expect(r!.verdict).toBe("exhausts");
  });

  it("sem heatmap → fallback linear", () => {
    const r = forecastFiveHour({
      usedPct: 50,
      fiveHourResetMs: RESET,
      heatmap: null,
      nowMs: at(12, 30),
    });
    expect(r).not.toBeNull();
    expect(r!.method).toBe("linear");
    expect(r!.projectedPct).toBe(100);
  });

  it("heatmap todo-zero → fallback linear", () => {
    const r = forecastFiveHour({
      usedPct: 50,
      fiveHourResetMs: RESET,
      heatmap: heatFromHourly(new Array(24).fill(0)),
      nowMs: at(12, 30),
    });
    expect(r!.method).toBe("linear");
  });

  it("cedo demais (< 25% da janela) → null", () => {
    const r = forecastFiveHour({
      usedPct: 20,
      fiveHourResetMs: RESET,
      heatmap: heatFromHourly(new Array(24).fill(100)),
      nowMs: at(10, 30), // 0.5h de 5h = 10%
    });
    expect(r).toBeNull();
  });

  it("após o reset (remaining <= 0) → devolve o uso atual, sem projetar", () => {
    const r = forecastFiveHour({
      usedPct: 80,
      fiveHourResetMs: RESET,
      heatmap: heatFromHourly(new Array(24).fill(100)),
      nowMs: at(16, 0),
    });
    expect(r).not.toBeNull();
    expect(r!.projectedPct).toBe(80);
    expect(r!.verdict).toBe("fits");
  });

  it("usedPct null ou sem reset → null", () => {
    expect(
      forecastFiveHour({ usedPct: null, fiveHourResetMs: RESET, heatmap: null })
    ).toBeNull();
    expect(
      forecastFiveHour({ usedPct: 50, fiveHourResetMs: null, heatmap: null })
    ).toBeNull();
  });
});

describe("lightestUpcomingHour", () => {
  it("aponta a hora de menor intensidade nas próximas N horas", () => {
    // Dip na hora 13; todas as outras pesadas.
    const heatmap = heatFromHourly(
      profile({ 11: 100, 12: 100, 13: 5, 14: 100, 15: 100 })
    );
    const now = at(10, 0);
    const best = lightestUpcomingHour(heatmap, 5, now); // checa 11..15
    expect(best).not.toBeNull();
    expect(best!.hour).toBe(13);
    expect(best!.weekday).toBe(new Date(at(13, 0)).getDay());
  });

  it("sem sinal → null", () => {
    expect(lightestUpcomingHour(null, 5, at(10, 0))).toBeNull();
    expect(
      lightestUpcomingHour(heatFromHourly(new Array(24).fill(0)), 5, at(10, 0))
    ).toBeNull();
  });
});
