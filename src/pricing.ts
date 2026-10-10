/**
 * Tabela de preços LOCAL (USD por 1M de tokens) para ATRIBUIR custo por modelo,
 * projeto e tamanho de contexto. O ccusage só dá o custo AGREGADO do bloco
 * (`blocks`/`daily`), sem split por modelo — então usamos esta tabela só pras
 * atribuições, sempre rotuladas "≈ aproximado". O número oficial do bloco
 * continua sendo o `costUSD` do ccusage; nunca deixar a soma aqui contradizê-lo.
 *
 * Preços conferidos com a skill `claude-api` E com a base que o ccusage consulta
 * (LiteLLM) — não hardcodar de memória:
 *   Fable 5.1 / Mythos 5.1 ..... $10   in / $50   out · cache read $0,25
 *   Fable 5 / Mythos 5 ......... $10   in / $50   out
 *   Opus 5.5 ................... $4    in / $20   out · cache read $0,20
 *   Opus 5 / 4.8 / 4.7 / 4.6 ... $5    in / $25   out
 *   Sonnet 5.5 ................. $2    in / $10   out · cache read $0,10
 *   Sonnet 5 ................... $2    in / $10   out
 *   Sonnet 4.6 ................. $3    in / $15   out
 *   Haiku 5.5 .................. $0,10 in / $0,50 out
 *   Haiku 4.5 .................. $1    in / $5    out
 * Cache: escrita 1,25× o input (TTL 5min) ou 2× (TTL 1h), em todos os modelos.
 * Leitura: 0,1× o input, SALVO onde a linha acima traz valor próprio — a geração
 * 5.5 cobra menos pela leitura, então a taxa é por modelo, não um multiplicador só.
 *
 * Onde as duas fontes divergem, vale a do ccusage (é contra ele que a soma tem que
 * bater): o cache read do Sonnet 5.5 é $0,20 na skill e $0,10 na base do ccusage.
 *
 * NÃO modelado (sem turno real pra conferir contra o ccusage): o Haiku 5.5 acima de
 * 100K tokens de prompt (5× mais caro) e o fast mode do Opus 5/5.5 (2×).
 */

/** Versão da tabela — exibida na UI ("tabela vX") e no export. Subir ao mudar preços. */
export const pricingTableVersion = "2 · 2026-10";

export interface Rates {
  /** USD por 1M de tokens de input. */
  input: number;
  /** USD por 1M de tokens de output. */
  output: number;
  /** USD por 1M de tokens lidos do cache. */
  cacheRead: number;
  /** true quando o modelo não casou com nenhuma faixa conhecida (caiu no default). */
  unknown?: boolean;
}

/** Leitura de cache quando a faixa não traz valor próprio: 0,1× a taxa de input. */
const CACHE_READ_RATIO = 0.1;

/**
 * Faixas por substring do id técnico normalizado. ORDEM IMPORTA: mais específico
 * primeiro — "opus-5-5" antes de "opus", senão a faixa genérica engole a versão e
 * cobra o preço errado (foi o que inflou o Opus 5.5 em ~80%).
 */
const TABLE: { match: string; input: number; output: number; cacheRead?: number }[] = [
  { match: "fable-5-1", input: 10, output: 50, cacheRead: 0.25 },
  { match: "mythos-5-1", input: 10, output: 50, cacheRead: 0.25 },
  { match: "fable", input: 10, output: 50 },
  { match: "mythos", input: 10, output: 50 },
  { match: "opus-5-5", input: 4, output: 20, cacheRead: 0.2 },
  { match: "opus", input: 5, output: 25 },
  { match: "sonnet-5-5", input: 2, output: 10, cacheRead: 0.1 },
  { match: "sonnet-5", input: 2, output: 10 },
  { match: "sonnet", input: 3, output: 15 },
  { match: "haiku-5-5", input: 0.1, output: 0.5 },
  { match: "haiku", input: 1, output: 5 },
];

/** Default p/ modelo desconhecido: Sonnet 4.x (faixa intermediária), marcado unknown. */
const DEFAULT_RATES: Rates = {
  input: 3,
  output: 15,
  cacheRead: 3 * CACHE_READ_RATIO,
  unknown: true,
};

/**
 * Resolve as taxas ($/1M) de um id de modelo por substring. O id é normalizado
 * antes (minúsculas; ponto, espaço e `_` viram hífen) porque a versão chega nas
 * duas grafias — "claude-opus-5-5" no transcript, "claude-sonnet-4.6" em ids
 * antigos — e sem isso "opus-5.5" cairia na faixa genérica.
 */
export function ratesFor(id: string | null | undefined): Rates {
  if (!id) {
    return DEFAULT_RATES;
  }
  const m = id.toLowerCase().replace(/[.\s_]+/g, "-");
  for (const row of TABLE) {
    if (m.includes(row.match)) {
      return {
        input: row.input,
        output: row.output,
        cacheRead: row.cacheRead ?? row.input * CACHE_READ_RATIO,
      };
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

/** Custo (USD) de um turno separado por tipo de token — soma em `.total`. */
export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/**
 * Custo aproximado (USD) de UM turno SEPARADO por tipo de token, dado o `usage` e
 * o id do modelo. Fórmula: input·in + output·out + cacheRead·leitura +
 * write5m·in·1,25 + write1h·in·2, com as taxas em $/token (tabela /1e6). Quando o
 * transcript não detalha o TTL do cache (`cache_creation.ephemeral_*`), trata todo
 * `cache_creation_input_tokens` como 5min (1,25×) — o caso comum.
 */
export function costForSplit(
  usage: UsageLike | undefined,
  modelId: string | null | undefined
): CostBreakdown {
  if (!usage) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  }
  const r = ratesFor(modelId);
  const inRate = r.input / 1_000_000;
  const outRate = r.output / 1_000_000;

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheReadTok = num(usage.cache_read_input_tokens);

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

  const inputCost = input * inRate;
  const outputCost = output * outRate;
  const cacheReadCost = (cacheReadTok * r.cacheRead) / 1_000_000;
  const cacheWriteCost = write5m * inRate * 1.25 + write1h * inRate * 2;
  return {
    input: inputCost,
    output: outputCost,
    cacheRead: cacheReadCost,
    cacheWrite: cacheWriteCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

/**
 * Custo aproximado (USD) de UM turno (total). Wrapper sobre `costForSplit`.
 */
export function costFor(usage: UsageLike | undefined, modelId: string | null | undefined): number {
  return costForSplit(usage, modelId).total;
}
