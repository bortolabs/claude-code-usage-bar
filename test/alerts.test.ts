import { describe, expect, it } from "vitest";
import { evaluateAlerts, AlertInput } from "../src/alerts";
import { CcusageData } from "../src/ccusage";

/** Bloco ccusage sintético com overrides pontuais. */
const block = (over: Partial<CcusageData> = {}): CcusageData => ({
  available: true,
  startMs: 0,
  endMs: 0,
  remainingMinutes: 120,
  timePct: 50,
  costUSD: 3,
  totalTokens: 1_000_000,
  model: "claude-opus-4-8",
  burnCostPerHour: null,
  tokensPerMinute: null,
  projectedCost: null,
  projectedTokens: null,
  tokenCounts: undefined,
  ...over,
});

const base = (over: Partial<AlertInput> = {}): AlertInput => ({
  block: null,
  costCap: 0,
  maxPerHour: 0,
  tokenCap: 0,
  fiveHour: null,
  sevenDay: null,
  fiveHourResetsAt: null,
  sevenDayResetsAt: null,
  ...over,
});

// resets relativos ao agora real (a projeção usa Date.now() por padrão) — o
// que importa nos testes são os OFFSETS, então continua determinístico.
const nowSec = () => Math.floor(Date.now() / 1000);

describe("evaluateAlerts", () => {
  it("sem gatilhos → inativo com key vazia", () => {
    const r = evaluateAlerts(base());
    expect(r.active).toBe(false);
    expect(r.key).toBe("");
    expect(r.reasons).toEqual([]);
  });

  it("projeção de custo acima do teto → key 'cost'", () => {
    const r = evaluateAlerts(
      base({ block: block({ projectedCost: 12 }), costCap: 5 })
    );
    expect(r.active).toBe(true);
    expect(r.key).toBe("cost");
  });

  it("projeção de tokens acima do teto → key 'tokens'", () => {
    const r = evaluateAlerts(
      base({ block: block({ projectedTokens: 2_000_000 }), tokenCap: 1_500_000 })
    );
    expect(r.key).toBe("tokens");
  });

  it("ritmo $/h acima do limite → key 'rate'", () => {
    const r = evaluateAlerts(
      base({ block: block({ burnCostPerHour: 30 }), maxPerHour: 20 })
    );
    expect(r.key).toBe("rate");
  });

  it("plano 5h projeta 100% antes do reset → key 'plan5h'", () => {
    // Metade da janela (2h30 restantes) com 80% → projeta 160%.
    const r = evaluateAlerts(
      base({ fiveHour: 80, fiveHourResetsAt: nowSec() + 2.5 * 3600 })
    );
    expect(r.key).toBe("plan5h");
  });

  it("cedo demais na janela 5h (regra dos 25%) → NÃO dispara", () => {
    // 30min decorridos (faltam 4h30) com 80% — antes disparava com 60s.
    const r = evaluateAlerts(
      base({ fiveHour: 80, fiveHourResetsAt: nowSec() + 4.5 * 3600 })
    );
    expect(r.active).toBe(false);
  });

  it("plano 7d projeta 100% → key 'plan7d'", () => {
    // Metade da semana (3,5 dias restantes) com 80% → projeta 160%.
    const r = evaluateAlerts(
      base({ sevenDay: 80, sevenDayResetsAt: nowSec() + 3.5 * 24 * 3600 })
    );
    expect(r.key).toBe("plan7d");
  });

  it("gatilhos múltiplos → key composta ordenada e 1ª razão como mensagem", () => {
    const r = evaluateAlerts(
      base({
        block: block({ projectedCost: 12, burnCostPerHour: 30 }),
        costCap: 5,
        maxPerHour: 20,
      })
    );
    expect(r.key).toBe("cost+rate");
    expect(r.message).toBe(r.reasons[0]);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("dica de ritmo (💡) entra como sub-linha quando projeta estouro", () => {
    const r = evaluateAlerts(
      base({ fiveHour: 80, fiveHourResetsAt: nowSec() + 2.5 * 3600 })
    );
    expect(r.reasons.some((x) => x.includes("💡"))).toBe(true);
    // …mas NÃO muda a key (não é um tipo novo de alerta).
    expect(r.key).toBe("plan5h");
  });
});
