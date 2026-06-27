/**
 * Tabela de preços LOCAL (USD por 1M de tokens) para ATRIBUIR custo por modelo,
 * projeto e tamanho de contexto. O ccusage só dá o custo AGREGADO do bloco
 * (`blocks`/`daily`), sem split por modelo — então usamos esta tabela só pras
 * atribuições, sempre rotuladas "≈ aproximado". O número oficial do bloco
 * continua sendo o `costUSD` do ccusage; nunca deixar a soma aqui contradizê-lo.
 *
 * Preços conferidos com a skill `claude-api` (não hardcodar de memória):
 *   Fable 5 / Mythos 5 ......... $10 in / $50 out
 *   Opus 4.8 / 4.7 / 4.6 ....... $5  in / $25 out
 *   Sonnet 4.6 ................. $3  in / $15 out
 *   Haiku 4.5 ................. $1  in / $5  out
 * Cache: leitura ≈ 0,1× a taxa de input; escrita 1,25× (TTL 5min) ou 2× (TTL 1h).
 */

/** Versão da tabela — exibida na UI ("tabela vX") e no export. Subir ao mudar preços. */
export const pricingTableVersion = "1 · 2026-06";

export interface Rates {
  /** USD por 1M de tokens de input. */
  input: number;
  /** USD por 1M de tokens de output. */
  output: number;
  /** true quando o modelo não casou com nenhuma faixa conhecida (caiu no default). */
  unknown?: boolean;
}

/** Faixas por substring do id técnico (minúsculo). Ordem importa: mais específico primeiro. */
const TABLE: { match: string; input: number; output: number }[] = [
  { match: "fable", input: 10, output: 50 },
  { match: "mythos", input: 10, output: 50 },
  { match: "opus", input: 5, output: 25 },
  { match: "sonnet", input: 3, output: 15 },
  { match: "haiku", input: 1, output: 5 },
];

/** Default p/ modelo desconhecido: Sonnet (faixa intermediária), marcado unknown. */
const DEFAULT_RATES: Rates = { input: 3, output: 15, unknown: true };

/** Resolve as taxas ($/1M) de um id de modelo por substring. */
export function ratesFor(id: string | null | undefined): Rates {
  if (!id) {
    return DEFAULT_RATES;
  }
  const m = id.toLowerCase();
  for (const row of TABLE) {
    if (m.includes(row.match)) {
      return { input: row.input, output: row.output };
    }
  }
  return DEFAULT_RATES;
}

/** Campos de uso que entram no custo (subset do `message.usage` do transcript). */
export interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

function num(v: unknown): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * Custo aproximado (USD) de UM turno, dado o `usage` e o id do modelo.
 * Fórmula: input·in + output·out + cacheRead·in·0,1 + write5m·in·1,25 + write1h·in·2,
 * com as taxas em $/token (tabela /1e6). Quando o transcript não detalha o TTL do
 * cache (`cache_creation.ephemeral_*`), trata todo `cache_creation_input_tokens`
 * como 5min (1,25×) — o caso comum.
 */
export function costFor(usage: UsageLike | undefined, modelId: string | null | undefined): number {
  if (!usage) {
    return 0;
  }
  const r = ratesFor(modelId);
  const inRate = r.input / 1_000_000;
  const outRate = r.output / 1_000_000;

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);

  let write5m = 0;
  let write1h = 0;
  const cc = usage.cache_creation;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    write5m = num(cc.ephemeral_5m_input_tokens);
    write1h = num(cc.ephemeral_1h_input_tokens);
  } else {
    // Sem detalhe de TTL: assume tudo como cache de 5min (1,25×).
    write5m = num(usage.cache_creation_input_tokens);
  }

  return (
    input * inRate +
    output * outRate +
    cacheRead * inRate * 0.1 +
    write5m * inRate * 1.25 +
    write1h * inRate * 2
  );
}
