import { describe, expect, it } from "vitest";
import { costForSplit, ratesFor } from "../src/pricing";

describe("ratesFor", () => {
  it("casa por substring do id técnico", () => {
    expect(ratesFor("claude-opus-4-8")).toEqual({ input: 5, output: 25, cacheRead: 0.5 });
    expect(ratesFor("claude-sonnet-4-6")).toMatchObject({ input: 3, output: 15 });
    expect(ratesFor("claude-haiku-4-5-20251001")).toMatchObject({ input: 1, output: 5 });
    expect(ratesFor("claude-fable-5")).toMatchObject({ input: 10, output: 50 });
  });

  it("case-insensitive", () => {
    expect(ratesFor("CLAUDE-FABLE-5").input).toBe(10);
  });

  it("geração 5.x tem preço próprio, não o da faixa genérica", () => {
    expect(ratesFor("claude-opus-5-5")).toMatchObject({ input: 4, output: 20 });
    expect(ratesFor("claude-sonnet-5-5")).toMatchObject({ input: 2, output: 10 });
    expect(ratesFor("claude-sonnet-5")).toMatchObject({ input: 2, output: 10 });
    expect(ratesFor("claude-haiku-5-5")).toMatchObject({ input: 0.1, output: 0.5 });
  });

  // A tabela casa por substring, na ordem: a versão específica tem que vir antes
  // da faixa genérica que a contém. Foi a falta disso que inflou o Opus 5.5.
  it("a versão mais específica vence a faixa que a contém", () => {
    expect(ratesFor("claude-opus-5-5").input).not.toBe(ratesFor("claude-opus-5").input);
    expect(ratesFor("claude-haiku-5-5").input).not.toBe(ratesFor("claude-haiku-4-5").input);
    // Mesmo preço de tabela, leitura de cache diferente: é o que os distingue.
    expect(ratesFor("claude-sonnet-5-5").cacheRead).not.toBe(ratesFor("claude-sonnet-5").cacheRead);
    expect(ratesFor("claude-fable-5-1").cacheRead).not.toBe(ratesFor("claude-fable-5").cacheRead);
    expect(ratesFor("claude-mythos-5-1").cacheRead).not.toBe(ratesFor("claude-mythos-5").cacheRead);
  });

  it("versões antigas com um 5 no id não caem nas faixas novas", () => {
    expect(ratesFor("claude-opus-4-5-20251101")).toMatchObject({ input: 5, output: 25 });
    expect(ratesFor("claude-sonnet-4-5-20250929")).toMatchObject({ input: 3, output: 15 });
    expect(ratesFor("claude-haiku-4-5-20251001")).toMatchObject({ input: 1, output: 5 });
    expect(ratesFor("claude-3-5-sonnet-20241022")).toMatchObject({ input: 3, output: 15 });
  });

  it("versão com ponto ou espaço casa igual à com hífen", () => {
    expect(ratesFor("claude-opus-5.5")).toEqual(ratesFor("claude-opus-5-5"));
    expect(ratesFor("Opus 5.5 (1M context)")).toEqual(ratesFor("claude-opus-5-5"));
    expect(ratesFor("claude-sonnet-4.6")).toEqual(ratesFor("claude-sonnet-4-6"));
  });

  it("leitura de cache: 0,1× o input, salvo onde o modelo tem taxa própria", () => {
    expect(ratesFor("claude-opus-5").cacheRead).toBeCloseTo(0.5, 9);
    expect(ratesFor("claude-sonnet-5").cacheRead).toBeCloseTo(0.2, 9);
    expect(ratesFor("claude-haiku-5-5").cacheRead).toBeCloseTo(0.01, 9);
    expect(ratesFor("claude-fable-5").cacheRead).toBeCloseTo(1, 9);
    // Taxa própria (abaixo dos 10%):
    expect(ratesFor("claude-opus-5-5").cacheRead).toBe(0.2);
    expect(ratesFor("claude-sonnet-5-5").cacheRead).toBe(0.1);
    expect(ratesFor("claude-fable-5-1").cacheRead).toBe(0.25);
    expect(ratesFor("claude-mythos-5-1").cacheRead).toBe(0.25);
  });

  it("modelo desconhecido → default Sonnet 4.x marcado unknown", () => {
    expect(ratesFor("gpt-alguma-coisa")).toMatchObject({
      input: 3,
      output: 15,
      unknown: true,
    });
    expect(ratesFor("gpt-alguma-coisa").cacheRead).toBeCloseTo(0.3, 9);
    expect(ratesFor(null)).toMatchObject({ unknown: true });
  });
});

describe("costForSplit", () => {
  it("sem usage → tudo zero", () => {
    expect(costForSplit(undefined, "claude-opus-4-8").total).toBe(0);
  });

  it("input/output com as taxas da tabela", () => {
    // Opus: $5/M in, $25/M out → 1M in + 1M out = $30.
    const cb = costForSplit(
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      "claude-opus-4-8"
    );
    expect(cb.input).toBeCloseTo(5, 6);
    expect(cb.output).toBeCloseTo(25, 6);
    expect(cb.total).toBeCloseTo(30, 6);
  });

  it("cache read a 0,1× do input", () => {
    const cb = costForSplit(
      { cache_read_input_tokens: 1_000_000 },
      "claude-opus-4-8"
    );
    expect(cb.cacheRead).toBeCloseTo(0.5, 6); // 5 × 0,1
  });

  it("cache read com a taxa própria do modelo (Opus 5.5: $0,20, não 10% do input)", () => {
    const cb = costForSplit(
      { cache_read_input_tokens: 1_000_000 },
      "claude-opus-5-5"
    );
    expect(cb.cacheRead).toBeCloseTo(0.2, 9);
  });

  // Um dia real de Opus 5.5 (23/09/2026, 273 turnos somados), conferido contra o
  // ccusage: US$ 24,2683.
  // Com a faixa genérica "opus" (5/25, leitura a 10%) essa conta dava US$ 41,69.
  it("reproduz o custo oficial de um dia real de Opus 5.5", () => {
    const cb = costForSplit(
      {
        input_tokens: 546,
        output_tokens: 411_286,
        cache_read_input_tokens: 45_433_603,
        cache_creation: {
          ephemeral_5m_input_tokens: 237_684,
          ephemeral_1h_input_tokens: 720_662,
        },
      },
      "claude-opus-5-5"
    );
    expect(cb.total).toBeCloseTo(24.2683, 3);
  });

  it("cache write sem TTL detalhado → tudo como 5min (1,25×)", () => {
    const cb = costForSplit(
      { cache_creation_input_tokens: 1_000_000 },
      "claude-opus-4-8"
    );
    expect(cb.cacheWrite).toBeCloseTo(6.25, 6); // 5 × 1,25
  });

  it("cache write com TTL detalhado → 5min a 1,25× e 1h a 2×", () => {
    const cb = costForSplit(
      {
        cache_creation_input_tokens: 2_000_000, // ignorado quando há detalhe
        cache_creation: {
          ephemeral_5m_input_tokens: 1_000_000,
          ephemeral_1h_input_tokens: 1_000_000,
        },
      },
      "claude-opus-4-8"
    );
    expect(cb.cacheWrite).toBeCloseTo(5 * 1.25 + 5 * 2, 6);
  });
});
