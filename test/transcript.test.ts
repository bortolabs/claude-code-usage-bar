import { describe, expect, it } from "vitest";
import { contextFromUsage } from "../src/transcript";

describe("contextFromUsage", () => {
  it("soma input + cache_read + cache_creation; janela 1M p/ Opus", () => {
    const r = contextFromUsage(
      {
        input_tokens: 1_000,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 41_500,
      },
      "claude-opus-4-8",
    );
    expect(r.tokens).toBe(142_500);
    expect(r.window).toBe(1_000_000);
    expect(r.pct).toBeCloseTo(14.25, 5);
  });

  it("janela 200k p/ Haiku", () => {
    const r = contextFromUsage({ input_tokens: 50_000 }, "claude-haiku-4-5");
    expect(r.window).toBe(200_000);
    expect(r.pct).toBeCloseTo(25, 5);
  });

  it("clampa em 100% quando o usado passa da janela", () => {
    const r = contextFromUsage(
      { input_tokens: 250_000 },
      "claude-haiku-4-5",
    );
    expect(r.tokens).toBe(250_000);
    expect(r.pct).toBe(100);
  });

  it("usage vazio/ausente → 0 tokens (UI esconde o card)", () => {
    expect(contextFromUsage({}, "claude-opus-4-8").tokens).toBe(0);
    expect(contextFromUsage(null, "claude-opus-4-8").tokens).toBe(0);
    expect(contextFromUsage(undefined, null).pct).toBe(0);
  });

  it("modelo desconhecido cai na janela padrão (1M)", () => {
    const r = contextFromUsage({ input_tokens: 10_000 }, null);
    expect(r.window).toBe(1_000_000);
  });
});
