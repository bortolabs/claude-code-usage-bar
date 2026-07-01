import { describe, expect, it } from "vitest";
import {
  projectLimitPct,
  etaToLimitMin,
  sessionTimePct,
} from "../src/core/projection";
import { CcusageData } from "../src/ccusage";

const H = 3600; // s
const NOW = 1_750_000_000_000; // epoch ms fixo — nada de Date.now() nos testes

/** resetsAt (em SEGUNDOS) faltando `remainingH` horas para o reset. */
const resetInSec = (remainingH: number) => Math.floor(NOW / 1000) + remainingH * H;

describe("projectLimitPct", () => {
  it("retorna null sem dados", () => {
    expect(projectLimitPct(null, resetInSec(1), 5 * H, NOW)).toBeNull();
    expect(projectLimitPct(50, null, 5 * H, NOW)).toBeNull();
  });

  it("retorna null antes de 25% da janela (ritmo ruidoso)", () => {
    // 5h de janela, faltam 4h30 → só 30min decorridos (10%).
    expect(projectLimitPct(20, resetInSec(4.5), 5 * H, NOW)).toBeNull();
  });

  it("extrapola linearmente após 25% da janela", () => {
    // 5h de janela, faltam 2h30 → metade decorrida com 40% → projeta 80%.
    expect(projectLimitPct(40, resetInSec(2.5), 5 * H, NOW)).toBeCloseTo(80, 5);
  });

  it("janela já resetou → devolve o uso atual", () => {
    expect(projectLimitPct(63, resetInSec(-0.1), 5 * H, NOW)).toBe(63);
  });
});

describe("etaToLimitMin", () => {
  it("já em 100% → 0 minutos", () => {
    expect(etaToLimitMin(100, resetInSec(2), 5 * H, NOW)).toBe(0);
  });

  it("estoura antes do reset → minutos restantes", () => {
    // Metade da janela (2h30 decorridos) com 80% → 100% em ~37,5min < 2h30.
    const eta = etaToLimitMin(80, resetInSec(2.5), 5 * H, NOW);
    expect(eta).toBe(38); // 37,5 arredonda pra 38
  });

  it("NÃO estoura antes do reset → null", () => {
    // Metade da janela com 40% → 100% só em 3h45 > 2h30 restantes.
    expect(etaToLimitMin(40, resetInSec(2.5), 5 * H, NOW)).toBeNull();
  });

  it("cedo demais (menos de 25% da janela) → null", () => {
    expect(etaToLimitMin(80, resetInSec(4.5), 5 * H, NOW)).toBeNull();
  });
});

describe("sessionTimePct", () => {
  const block = { timePct: 55 } as CcusageData;

  it("prefere o reset REAL do oauth ao bloco do ccusage", () => {
    // Faltam 2h30 de 5h → 50% do tempo decorrido (ignora o 55% do bloco).
    expect(sessionTimePct(NOW + 2.5 * H * 1000, block, NOW)).toBeCloseTo(50, 5);
  });

  it("clampa em 0..100 (reset no passado)", () => {
    expect(sessionTimePct(NOW - 1000, block, NOW)).toBe(100);
  });

  it("sem reset do oauth → cai no timePct do ccusage", () => {
    expect(sessionTimePct(null, block, NOW)).toBe(55);
  });

  it("sem nenhuma fonte → null", () => {
    expect(sessionTimePct(null, null, NOW)).toBeNull();
  });
});
