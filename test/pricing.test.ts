import { describe, expect, it } from "vitest";
import { costForSplit, ratesFor } from "../src/pricing";

describe("ratesFor", () => {
  it("casa por substring do id técnico", () => {
    expect(ratesFor("claude-opus-4-8")).toEqual({ input: 5, output: 25 });
    expect(ratesFor("claude-sonnet-5")).toEqual({ input: 3, output: 15 });
    expect(ratesFor("claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5 });
    expect(ratesFor("claude-fable-5")).toEqual({ input: 10, output: 50 });
  });

  it("mais específico primeiro (fable antes de qualquer fallback)", () => {
    expect(ratesFor("CLAUDE-FABLE-5").input).toBe(10); // case-insensitive
  });

  it("modelo desconhecido → default Sonnet marcado unknown", () => {
    expect(ratesFor("gpt-alguma-coisa")).toEqual({
      input: 3,
      output: 15,
      unknown: true,
    });
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
