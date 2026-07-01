import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { costForSplit, CostBreakdown, UsageLike, pricingTableVersion } from "./pricing";
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
/** Quebra por tipo de token (tokens + custo) — usada em modelo/dia/hora/sessão. */
export interface TokenSplit {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messages: number;
}
export interface ModelStat extends TokenCost, TokenSplit {
  model: string; // rótulo amigável (prettyModel)
}
export interface ProjectStat extends TokenCost {
  project: string;
}
export interface BucketStat extends TokenCost {
  bucket: string; // chave do tamanho de contexto (ver CONTEXT_BUCKETS)
  turns: number;
}
export interface DayStat extends TokenCost, TokenSplit {
  date: string; // 'YYYY-MM-DD' (local)
}
export interface HourStat extends TokenCost, TokenSplit {
  hour: string; // 'YYYY-MM-DD HH:00' (local)
}
export interface SessionStat extends TokenCost {
  session: string; // id da sessão (basename do .jsonl, ou dir-pai p/ subagentes)
  project: string;
  messages: number;
  firstTs: number;
  lastTs: number;
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
  bySkill: CountStat[];
  byPlugin: CountStat[];
  byDay: DayStat[]; // ordem cronológica (asc), no máx. ~90 dias
  byHour: HourStat[]; // ordem cronológica (asc), no máx. ~72 horas
  bySession: SessionStat[]; // por custo (desc), limitado
  totalTokens: number;
  totalCostUSD: number;
  turns: number;
  /** Totais por tipo de token (p/ heurísticas das dicas e KPIs). */
  tokenTotals: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Custo total separado por tipo de token (composição de custo). */
  costByType: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Fração (0–1) do custo vindo de sessões com duração ≥ 8h (p/ insight). */
  longSessionCostShare: number;
  /** Nº de turnos com contexto (input+cache_read) acima de CTX_INFLATED_K (p/ anomalias). */
  ctxInflatedTurns: number;
  /** Maior run de chamadas de tool IDÊNTICAS (name+input) num mesmo turno (p/ anomalias). */
  maxToolRunLength: number;
  /** Nome da tool do maior run (p/ o texto da anomalia de loop). */
  toolLoopName: string;
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

/**
 * Corte (em tokens de contexto = input+cache_read do turno) acima do qual um turno
 * conta como "inflado" p/ a anomalia `ctxInflated`. É constante de CÓDIGO de propósito:
 * o cache de stats (`statsCache`) não inclui settings, então o corte aplicado durante a
 * varredura não pode variar por setting. O limiar CONFIGURÁVEL da anomalia é o número
 * MÍNIMO de turnos inflados (`anomalyCtxInflatedTurns`), aplicado depois em computeAnomalies.
 */
const CTX_INFLATED_K = 200_000;

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
/** Rótulo de plugin p/ skills sem namespace (built-in). */
const BUILTIN_PLUGIN = "(built-in)";

/** Acumulador "cheio": tokens + custo + quebra por tipo + nº de mensagens. */
interface FullTC extends TokenCost, TokenSplit {}
function emptyFull(): FullTC {
  return {
    tokens: 0,
    costUSD: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    messages: 0,
  };
}

/** Contribuição de UM turno (computada uma vez em onLine). */
interface TurnContrib {
  tokens: number;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}
function dayKey(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function hourKey(ts: number): string {
  const d = new Date(ts);
  return dayKey(ts) + " " + pad2(d.getHours()) + ":00";
}

class Accum {
  byModel = new Map<string, FullTC>();
  byProject = new Map<string, TokenCost>();
  byBucket = new Map<string, BucketStat>();
  byMcp = new Map<string, number>();
  bySub = new Map<string, number>();
  bySkill = new Map<string, number>();
  byPlugin = new Map<string, number>();
  byDay = new Map<string, FullTC>();
  byHour = new Map<string, FullTC>();
  bySession = new Map<string, SessionStat>();
  totalTokens = 0;
  totalCostUSD = 0;
  turns = 0;
  // Totais por tipo de token (p/ as dicas: ex. share de cache-read).
  tInput = 0;
  tOutput = 0;
  tCacheRead = 0;
  tCacheWrite = 0;
  // Custo total separado por tipo de token (composição de custo).
  cInput = 0;
  cOutput = 0;
  cCacheRead = 0;
  cCacheWrite = 0;
  // Sinais de anomalia (escalares, computados em streaming — ver onLine).
  ctxInflatedTurns = 0;
  maxToolRunLength = 0;
  toolLoopName = "";

  add(map: Map<string, TokenCost>, key: string, tokens: number, cost: number) {
    const cur = map.get(key) ?? { tokens: 0, costUSD: 0 };
    cur.tokens += tokens;
    cur.costUSD += cost;
    map.set(key, cur);
  }

  /** Acumula a contribuição de um turno num mapa "cheio" (modelo/dia/hora). */
  addFull(map: Map<string, FullTC>, key: string, c: TurnContrib) {
    const x = map.get(key) ?? emptyFull();
    x.tokens += c.tokens;
    x.costUSD += c.cost;
    x.input += c.input;
    x.output += c.output;
    x.cacheRead += c.cacheRead;
    x.cacheWrite += c.cacheWrite;
    x.messages += 1;
    map.set(key, x);
  }
}

/**
 * Processa uma linha de transcript já parseada (objeto JSON).
 * Só conta turnos de assistant com `message.usage`. Acumula no `acc`.
 */
function onLine(
  acc: Accum,
  o: any,
  dirName: string,
  sessionId: string,
  windowStartMs: number,
  windowEndMs: number
) {
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
  const cb: CostBreakdown = costForSplit(usage, rawModel);
  const cost = cb.total;
  const nn = (v: unknown) => (typeof v === "number" ? v : 0);
  const inTok = nn(usage.input_tokens);
  const outTok = nn(usage.output_tokens);
  const crTok = nn(usage.cache_read_input_tokens);
  const cwTok = nn(usage.cache_creation_input_tokens);

  acc.totalTokens += tokens;
  acc.totalCostUSD += cost;
  acc.turns += 1;
  acc.tInput += inTok;
  acc.tOutput += outTok;
  acc.tCacheRead += crTok;
  acc.tCacheWrite += cwTok;
  acc.cInput += cb.input;
  acc.cOutput += cb.output;
  acc.cCacheRead += cb.cacheRead;
  acc.cCacheWrite += cb.cacheWrite;

  const contrib: TurnContrib = {
    tokens,
    cost,
    input: inTok,
    output: outTok,
    cacheRead: crTok,
    cacheWrite: cwTok,
  };

  // Por modelo (rótulo amigável; desconhecido cai no id cru).
  const modelLabel = prettyModel(rawModel) || rawModel || "—";
  acc.addFull(acc.byModel, modelLabel, contrib);

  // Por dia / por hora (data local do turno).
  acc.addFull(acc.byDay, dayKey(ts), contrib);
  acc.addFull(acc.byHour, hourKey(ts), contrib);

  // Por projeto: sidechains (subagentes) vão pro projeto sintético.
  const isSide = o?.isSidechain === true;
  const proj = isSide ? SUBAGENTS_PROJECT : projectName(o?.cwd, dirName);
  acc.add(acc.byProject, proj, tokens, cost);

  // Por sessão (cada .jsonl). Mantém também duração (first/last timestamp).
  const sess = acc.bySession.get(sessionId) ?? {
    session: sessionId,
    project: proj,
    tokens: 0,
    costUSD: 0,
    messages: 0,
    firstTs: ts,
    lastTs: ts,
  };
  sess.tokens += tokens;
  sess.costUSD += cost;
  sess.messages += 1;
  if (ts < sess.firstTs) {
    sess.firstTs = ts;
  }
  if (ts > sess.lastTs) {
    sess.lastTs = ts;
  }
  acc.bySession.set(sessionId, sess);

  // Por tamanho de contexto: input + cache_read do turno.
  const ctxTokens = inTok + crTok;
  // Anomalia: turno com contexto acima do corte fixo (ver CTX_INFLATED_K).
  if (ctxTokens > CTX_INFLATED_K) {
    acc.ctxInflatedTurns += 1;
  }
  const bk = bucketFor(ctxTokens);
  const cur = acc.byBucket.get(bk) ?? { bucket: bk, tokens: 0, costUSD: 0, turns: 0 };
  cur.tokens += tokens;
  cur.costUSD += cost;
  cur.turns += 1;
  acc.byBucket.set(bk, cur);

  // MCP / subagentes / skills / plugins: CONTAGEM a partir dos blocos tool_use.
  // (Não dá pra atribuir tokens a um tool_use isolado dentro do turno.)
  // Anomalia `toolLoop`: maior run de chamadas IDÊNTICAS (name+input) neste turno.
  // Nível A (só dentro do turno) — sem estado cross-turn, então não confunde tools
  // de sessões diferentes na mesma passada. Casar name+input evita falso positivo
  // com N chamadas paralelas da mesma tool com args diferentes (ex.: 5 Reads).
  let runKey = "";
  let runLen = 0;
  const content = msg?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || block.type !== "tool_use" || typeof block.name !== "string") {
        continue;
      }
      const name: string = block.name;
      let inputSig: string;
      try {
        inputSig = JSON.stringify(block.input);
      } catch {
        inputSig = "";
      }
      const callKey = name + " " + inputSig;
      if (callKey === runKey) {
        runLen += 1;
      } else {
        runKey = callKey;
        runLen = 1;
      }
      if (runLen > acc.maxToolRunLength) {
        acc.maxToolRunLength = runLen;
        acc.toolLoopName = name;
      }
      if (name.startsWith("mcp__")) {
        // mcp__<server>__<tool> → server
        const server = name.split("__")[1] || name;
        acc.byMcp.set(server, (acc.byMcp.get(server) ?? 0) + 1);
      } else if (name === "Task" || name === "Agent") {
        // O tool de subagente já foi chamado de "Task" e de "Agent".
        const sub = (block.input && block.input.subagent_type) || "subagente";
        acc.bySub.set(String(sub), (acc.bySub.get(String(sub)) ?? 0) + 1);
      } else if (name === "Skill") {
        // Skill: input.skill = nome ('plugin:skill' p/ skills de plugin).
        const inp = block.input || {};
        const raw = inp.skill || inp.command || inp.name;
        if (raw && typeof raw === "string") {
          acc.bySkill.set(raw, (acc.bySkill.get(raw) ?? 0) + 1);
          const colon = raw.indexOf(":");
          if (colon > 0) {
            const plugin = raw.slice(0, colon);
            acc.byPlugin.set(plugin, (acc.byPlugin.get(plugin) ?? 0) + 1);
          } else {
            acc.byPlugin.set(BUILTIN_PLUGIN, (acc.byPlugin.get(BUILTIN_PLUGIN) ?? 0) + 1);
          }
        }
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

/**
 * Id da sessão a partir do caminho do .jsonl: o basename sem extensão, ou — quando
 * o arquivo é de subagente (`<sessão>/subagents/agent-*.jsonl`) — a pasta-pai da
 * `subagents/`, p/ os subagentes rolarem pra sessão principal.
 */
function sessionIdFor(full: string): string {
  const norm = full.replace(/\\/g, "/");
  const idx = norm.indexOf("/subagents/");
  if (idx !== -1) {
    return path.basename(norm.slice(0, idx));
  }
  return path.basename(full, ".jsonl");
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
  const sessionId = sessionIdFor(ref.full);
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
    onLine(acc, o, ref.dirName, sessionId, windowStartMs, windowEndMs);
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
  const countList = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([name, calls]) => ({ name, calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, limit);
  const byMcpServer = countList(acc.byMcp);
  const bySubagent = countList(acc.bySub);
  const bySkill = countList(acc.bySkill);
  const byPlugin = countList(acc.byPlugin);
  // Séries temporais: ordem cronológica asc; cap p/ não inflar o payload.
  const byDay = Array.from(acc.byDay.entries())
    .map(([date, f]) => ({ date, ...f }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-90);
  const byHour = Array.from(acc.byHour.entries())
    .map(([hour, f]) => ({ hour, ...f }))
    .sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : 0))
    .slice(-72);
  // Share de custo de sessões longas (≥8h) — calculado sobre TODAS as sessões.
  const EIGHT_H = 8 * 3600 * 1000;
  let sessTotal = 0;
  let sessLong = 0;
  for (const s of acc.bySession.values()) {
    sessTotal += s.costUSD;
    if (s.lastTs - s.firstTs >= EIGHT_H) {
      sessLong += s.costUSD;
    }
  }
  const longSessionCostShare = sessTotal > 0 ? sessLong / sessTotal : 0;
  const bySession = Array.from(acc.bySession.values())
    .sort((a, b) => b.costUSD - a.costUSD || b.tokens - a.tokens)
    .slice(0, limit);

  const stats: TranscriptStats = {
    byModel,
    byProject,
    byContextBucket,
    byMcpServer,
    bySubagent,
    bySkill,
    byPlugin,
    byDay,
    byHour,
    bySession,
    totalTokens: acc.totalTokens,
    totalCostUSD: acc.totalCostUSD,
    turns: acc.turns,
    tokenTotals: {
      input: acc.tInput,
      output: acc.tOutput,
      cacheRead: acc.tCacheRead,
      cacheWrite: acc.tCacheWrite,
    },
    costByType: {
      input: acc.cInput,
      output: acc.cOutput,
      cacheRead: acc.cCacheRead,
      cacheWrite: acc.cCacheWrite,
    },
    longSessionCostShare,
    ctxInflatedTurns: acc.ctxInflatedTurns,
    maxToolRunLength: acc.maxToolRunLength,
    toolLoopName: acc.toolLoopName,
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
    bySkill: [],
    byPlugin: [],
    byDay: [],
    byHour: [],
    bySession: [],
    totalTokens: 0,
    totalCostUSD: 0,
    turns: 0,
    tokenTotals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costByType: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    longSessionCostShare: 0,
    ctxInflatedTurns: 0,
    maxToolRunLength: 0,
    toolLoopName: "",
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
