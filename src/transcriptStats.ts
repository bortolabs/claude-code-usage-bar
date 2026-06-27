import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { costFor, UsageLike, pricingTableVersion } from "./pricing";
import { prettyModel } from "./transcript";

/**
 * Agregador LOCAL dos transcripts do Claude Code (`~/.claude/projects/**`).
 * Numa única passada acumula tokens + custo aproximado por modelo, projeto e
 * tamanho de contexto, além da CONTAGEM de chamadas por servidor MCP e por
 * subagente. Tudo local, sem rede, sem LLM — rotulado "≈ aproximado" na UI
 * (o número oficial de custo continua sendo o do ccusage).
 *
 * O layout do transcript é ANINHADO: além de `projects/<slug>/<sessão>.jsonl`,
 * cada subagente grava em `<sessão>/subagents/agent-*.jsonl` (com `isSidechain:
 * true` e `message.model` próprio). Por isso a varredura é RECURSIVA — o
 * `projectUsage.ts` antigo só fazia 1 nível e perdia os subagentes.
 */

export interface TokenCost {
  tokens: number;
  costUSD: number;
}
export interface ModelStat extends TokenCost {
  model: string; // rótulo amigável (prettyModel)
}
export interface ProjectStat extends TokenCost {
  project: string;
}
export interface BucketStat extends TokenCost {
  bucket: string; // chave do tamanho de contexto (ver CONTEXT_BUCKETS)
  turns: number;
}
export interface CountStat {
  name: string;
  calls: number;
}

export interface TranscriptStats {
  byModel: ModelStat[];
  byProject: ProjectStat[];
  byContextBucket: BucketStat[];
  byMcpServer: CountStat[];
  bySubagent: CountStat[];
  totalTokens: number;
  totalCostUSD: number;
  turns: number;
  /** Totais por tipo de token (p/ heurísticas das dicas). */
  tokenTotals: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Sempre true: custo vem da tabela local, não do ccusage. */
  approximate: true;
  /** Versão da tabela de preços usada (p/ exibir "tabela vX"). */
  tableVersion: string;
}

/** Nível visual da dica. */
export type TipLevel = "warn" | "info";
/** Dica estruturada (texto é localizado na UI a partir de `id` + `values`). */
export interface Tip {
  id: string;
  level: TipLevel;
  values: Record<string, string | number>;
}

/** Limiares (ajustáveis) das dicas. Shares em fração (0–1); mcpCalls em contagem. */
export interface TipThresholds {
  ctxBigShare: number; // contexto >150k respondendo por ≥X do custo
  cacheReadShare: number; // cache-read ≥X dos tokens de input
  opusShare: number; // Opus ≥X do custo
  mcpCalls: number; // servidor MCP com >X chamadas
  subagentShare: number; // subagentes ≥X do custo
}

/** Defaults dos limiares (exportados p/ a UI/settings derivarem deles). */
export const DEFAULT_TIP_THRESHOLDS: TipThresholds = {
  ctxBigShare: 0.25,
  cacheReadShare: 0.7,
  opusShare: 0.7,
  mcpCalls: 40,
  subagentShare: 0.4,
};

const TIP_MIN_TURNS = 5; // amostra mínima p/ arriscar uma dica

/** Faixas de tamanho de contexto (input + cache_read do turno), em ordem. */
const CONTEXT_BUCKETS: { key: string; max: number }[] = [
  { key: "<50k", max: 50_000 },
  { key: "50–100k", max: 100_000 },
  { key: "100–150k", max: 150_000 },
  { key: "150–200k", max: 200_000 },
  { key: ">200k", max: Infinity },
];

function bucketFor(ctxTokens: number): string {
  for (const b of CONTEXT_BUCKETS) {
    if (ctxTokens < b.max) {
      return b.key;
    }
  }
  return CONTEXT_BUCKETS[CONTEXT_BUCKETS.length - 1].key;
}

function sumUsage(u: UsageLike | undefined): number {
  if (!u) {
    return 0;
  }
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return (
    n(u.input_tokens) +
    n(u.output_tokens) +
    n(u.cache_creation_input_tokens) +
    n(u.cache_read_input_tokens)
  );
}

function projectName(cwd: string | undefined, dirName: string): string {
  if (cwd && typeof cwd === "string" && cwd.length > 1) {
    return path.basename(cwd);
  }
  const parts = dirName.replace(/^-/, "").split("-");
  return parts[parts.length - 1] || dirName;
}

/** Nome sintético do "projeto" que agrupa o gasto dos subagentes (sidechains). */
const SUBAGENTS_PROJECT = "subagentes";

class Accum {
  byModel = new Map<string, TokenCost>();
  byProject = new Map<string, TokenCost>();
  byBucket = new Map<string, BucketStat>();
  byMcp = new Map<string, number>();
  bySub = new Map<string, number>();
  totalTokens = 0;
  totalCostUSD = 0;
  turns = 0;
  // Totais por tipo de token (p/ as dicas: ex. share de cache-read).
  tInput = 0;
  tOutput = 0;
  tCacheRead = 0;
  tCacheWrite = 0;

  add(map: Map<string, TokenCost>, key: string, tokens: number, cost: number) {
    const cur = map.get(key) ?? { tokens: 0, costUSD: 0 };
    cur.tokens += tokens;
    cur.costUSD += cost;
    map.set(key, cur);
  }
}

/**
 * Processa uma linha de transcript já parseada (objeto JSON).
 * Só conta turnos de assistant com `message.usage`. Acumula no `acc`.
 */
function onLine(acc: Accum, o: any, dirName: string, windowStartMs: number, windowEndMs: number) {
  const msg = o?.message;
  const usage: UsageLike | undefined = msg?.usage;
  if (!usage) {
    return;
  }
  const ts = o?.timestamp ? Date.parse(o.timestamp) : NaN;
  if (isNaN(ts) || ts < windowStartMs || ts > windowEndMs) {
    return;
  }
  const rawModel: string | undefined = msg?.model;
  if (rawModel === "<synthetic>") {
    return;
  }

  const tokens = sumUsage(usage);
  const cost = costFor(usage, rawModel);
  acc.totalTokens += tokens;
  acc.totalCostUSD += cost;
  acc.turns += 1;
  const nn = (v: unknown) => (typeof v === "number" ? v : 0);
  acc.tInput += nn(usage.input_tokens);
  acc.tOutput += nn(usage.output_tokens);
  acc.tCacheRead += nn(usage.cache_read_input_tokens);
  acc.tCacheWrite += nn(usage.cache_creation_input_tokens);

  // Por modelo (rótulo amigável; desconhecido cai no id cru).
  const modelLabel = prettyModel(rawModel) || rawModel || "—";
  acc.add(acc.byModel, modelLabel, tokens, cost);

  // Por projeto: sidechains (subagentes) vão pro projeto sintético.
  const isSide = o?.isSidechain === true;
  const proj = isSide ? SUBAGENTS_PROJECT : projectName(o?.cwd, dirName);
  acc.add(acc.byProject, proj, tokens, cost);

  // Por tamanho de contexto: input + cache_read do turno.
  const ctxTokens =
    (typeof usage.input_tokens === "number" ? usage.input_tokens : 0) +
    (typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0);
  const bk = bucketFor(ctxTokens);
  const cur = acc.byBucket.get(bk) ?? { bucket: bk, tokens: 0, costUSD: 0, turns: 0 };
  cur.tokens += tokens;
  cur.costUSD += cost;
  cur.turns += 1;
  acc.byBucket.set(bk, cur);

  // MCP / subagentes: CONTAGEM de chamadas a partir dos blocos tool_use.
  // (Não dá pra atribuir tokens a um tool_use isolado dentro do turno.)
  const content = msg?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || block.type !== "tool_use" || typeof block.name !== "string") {
        continue;
      }
      const name: string = block.name;
      if (name.startsWith("mcp__")) {
        // mcp__<server>__<tool> → server
        const server = name.split("__")[1] || name;
        acc.byMcp.set(server, (acc.byMcp.get(server) ?? 0) + 1);
      } else if (name === "Task" || name === "Agent") {
        // O tool de subagente já foi chamado de "Task" e de "Agent".
        const sub = (block.input && block.input.subagent_type) || "subagente";
        acc.bySub.set(String(sub), (acc.bySub.get(String(sub)) ?? 0) + 1);
      }
    }
  }
}

/** Arquivo .jsonl na janela + metadados baratos (p/ a assinatura de cache). */
interface FileRef {
  full: string;
  dirName: string; // pasta de projeto de topo (fallback do nome do projeto)
  mtimeMs: number;
  size: number;
}

/**
 * Passada BARATA (só `statSync`, sem ler conteúdo): coleta recursivamente os
 * .jsonl tocados na janela. O conteúdo só é lido depois, no cache-miss.
 */
function collectFiles(
  dir: string,
  dirName: string,
  windowStartMs: number,
  out: FileRef[]
) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectFiles(full, dirName, windowStartMs, out);
      continue;
    }
    if (!e.name.endsWith(".jsonl")) {
      continue;
    }
    try {
      const st = fs.statSync(full);
      // Pula arquivos não tocados na janela (otimização forte em históricos grandes).
      if (st.mtimeMs < windowStartMs) {
        continue;
      }
      out.push({ full, dirName, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // arquivo problemático — ignora e segue
    }
  }
}

/** Lê e processa UM arquivo (só no cache-miss), despachando cada turno pra onLine. */
function processFile(
  ref: FileRef,
  acc: Accum,
  windowStartMs: number,
  windowEndMs: number
) {
  let content: string;
  try {
    content = fs.readFileSync(ref.full, "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    // Fast-path: só linhas de turno (com usage) interessam.
    if (!line || line.indexOf('"usage"') === -1) {
      continue;
    }
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    onLine(acc, o, ref.dirName, windowStartMs, windowEndMs);
  }
}

function sortTC<T extends TokenCost>(arr: T[]): T[] {
  return arr.sort((a, b) => b.costUSD - a.costUSD || b.tokens - a.tokens);
}

// Cache (variável de módulo) do último cálculo: evita re-ler+parsear os mesmos
// arquivos a cada tick (60s) quando nada mudou. Chave = janela + assinatura mtime.
let statsCache: { key: string; stats: TranscriptStats } | null = null;

/**
 * Lê as estatísticas dos transcripts numa janela de tempo [start, end].
 * `windowEndMs` default = agora. Nunca lança (retorna stats vazias em erro).
 *
 * Faz primeiro uma passada barata (só `statSync`) p/ montar uma assinatura de
 * mtime dos arquivos na janela; se igual à do último cálculo, devolve o cache
 * sem re-ler/parsear nada. Senão, lê só os arquivos coletados e recalcula.
 */
export function readTranscriptStats(
  windowStartMs: number,
  windowEndMs: number = Date.now(),
  limit = 8
): TranscriptStats {
  const root = path.join(os.homedir(), ".claude", "projects");
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return emptyStats();
  }

  // Passada barata (só stat): arquivos na janela + assinatura de mtime/tamanho.
  const files: FileRef[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) {
      continue;
    }
    collectFiles(path.join(root, d.name), d.name, windowStartMs, files);
  }
  files.sort((a, b) => (a.full < b.full ? -1 : a.full > b.full ? 1 : 0));
  // Bucket de 1min do windowStart absorve o drift de ms do reset do oauth; o
  // windowEnd não entra na chave (não há turnos no futuro). `limit` entra porque
  // muda o slice das listas.
  const key =
    Math.floor(windowStartMs / 60000) +
    "|" +
    limit +
    "|" +
    files.map((f) => f.full + ":" + f.mtimeMs + ":" + f.size).join("|");
  if (statsCache && statsCache.key === key) {
    return statsCache.stats;
  }

  // Cache-miss: lê+processa só os arquivos coletados.
  const acc = new Accum();
  for (const f of files) {
    processFile(f, acc, windowStartMs, windowEndMs);
  }

  const byModel = sortTC(
    Array.from(acc.byModel.entries()).map(([model, tc]) => ({ model, ...tc }))
  ).slice(0, limit);
  const byProject = sortTC(
    Array.from(acc.byProject.entries()).map(([project, tc]) => ({ project, ...tc }))
  ).slice(0, limit);
  // Buckets: ordem fixa (do menor pro maior contexto), só os com turnos.
  const byContextBucket = CONTEXT_BUCKETS.map((b) => acc.byBucket.get(b.key)).filter(
    (b): b is BucketStat => !!b && b.turns > 0
  );
  const byMcpServer = Array.from(acc.byMcp.entries())
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, limit);
  const bySubagent = Array.from(acc.bySub.entries())
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, limit);

  const stats: TranscriptStats = {
    byModel,
    byProject,
    byContextBucket,
    byMcpServer,
    bySubagent,
    totalTokens: acc.totalTokens,
    totalCostUSD: acc.totalCostUSD,
    turns: acc.turns,
    tokenTotals: {
      input: acc.tInput,
      output: acc.tOutput,
      cacheRead: acc.tCacheRead,
      cacheWrite: acc.tCacheWrite,
    },
    approximate: true,
    tableVersion: pricingTableVersion,
  };
  statsCache = { key, stats };
  return stats;
}

function emptyStats(): TranscriptStats {
  return {
    byModel: [],
    byProject: [],
    byContextBucket: [],
    byMcpServer: [],
    bySubagent: [],
    totalTokens: 0,
    totalCostUSD: 0,
    turns: 0,
    tokenTotals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    approximate: true,
    tableVersion: pricingTableVersion,
  };
}

/**
 * Gera dicas heurísticas de economia a partir das estatísticas — local, sem LLM.
 * Retorna estruturas (`id` + `values`); o texto é montado/traduzido na UI.
 * Conservador: sem amostra mínima (`TIP_MIN_TURNS`) não arrisca nenhuma dica.
 */
export function computeTips(
  s: TranscriptStats,
  thresholds: Partial<TipThresholds> = {}
): Tip[] {
  const t: TipThresholds = { ...DEFAULT_TIP_THRESHOLDS, ...thresholds };
  const tips: Tip[] = [];
  const total = s.totalCostUSD;
  if (total <= 0 || s.turns < TIP_MIN_TURNS) {
    return tips;
  }
  const pctOf = (x: number) => Math.round((x / total) * 100);

  // (1) Contexto grande (>150k) concentra o custo → /compact / sessões novas.
  const bigCtx = s.byContextBucket
    .filter((b) => b.bucket === "150–200k" || b.bucket === ">200k")
    .reduce((a, b) => a + b.costUSD, 0);
  if (bigCtx / total >= t.ctxBigShare) {
    tips.push({ id: "context", level: "warn", values: { pct: pctOf(bigCtx) } });
  }

  // (2) Releitura de contexto (cache-read) domina os tokens de input.
  const inputSide =
    s.tokenTotals.input + s.tokenTotals.cacheRead + s.tokenTotals.cacheWrite;
  if (inputSide > 0 && s.tokenTotals.cacheRead / inputSide >= t.cacheReadShare) {
    tips.push({
      id: "cacheRead",
      level: "info",
      values: { pct: Math.round((s.tokenTotals.cacheRead / inputSide) * 100) },
    });
  }

  // (3) Opus concentra o custo → Sonnet/Haiku p/ tarefas leves.
  const opus = s.byModel
    .filter((m) => /opus/i.test(m.model))
    .reduce((a, m) => a + m.costUSD, 0);
  if (opus / total >= t.opusShare) {
    tips.push({ id: "opus", level: "info", values: { pct: pctOf(opus) } });
  }

  // (4) Servidor MCP muito chamado.
  const topMcp = s.byMcpServer[0];
  if (topMcp && topMcp.calls > t.mcpCalls) {
    tips.push({
      id: "mcp",
      level: "info",
      values: { name: topMcp.name, calls: topMcp.calls },
    });
  }

  // (5) Subagentes concentram o custo.
  const sub = s.byProject
    .filter((p) => p.project === SUBAGENTS_PROJECT)
    .reduce((a, p) => a + p.costUSD, 0);
  if (sub / total >= t.subagentShare) {
    tips.push({ id: "subagents", level: "info", values: { pct: pctOf(sub) } });
  }

  return tips;
}
