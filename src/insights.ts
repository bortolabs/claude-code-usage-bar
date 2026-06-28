import { TranscriptStats } from "./transcriptStats";
import { tr } from "./i18n";

/**
 * Insights LOCAIS do dashboard — callouts em linguagem natural derivados das
 * agregações dos transcripts. Sem rede, sem LLM. Cada insight tem um `id`
 * estável + `values`; o texto é montado/traduzido por `insightText` via `tr()`.
 *
 * (Os "tips" da sidebar — `transcriptStats.computeTips` — continuam separados;
 * estes são mais ricos: incluem sessões longas, eficiência de cache e share de
 * output, e já saem em texto pronto pro dashboard.)
 */

export type InsightLevel = "warn" | "info" | "good";
export interface Insight {
  id: string;
  level: InsightLevel;
  values: Record<string, string | number>;
}
/** Insight já localizado, pronto pra exibir. */
export interface InsightText {
  level: InsightLevel;
  text: string;
}

const MIN_TURNS = 5; // amostra mínima p/ arriscar um insight
const MAX_INSIGHTS = 5;

/** Limiares (fração 0–1, exceto mcpCalls). */
const TH = {
  ctxBigShare: 0.4,
  longSessionShare: 0.4,
  cacheGood: 0.85,
  cacheLow: 0.5,
  opusShare: 0.6,
  outputShare: 0.4,
  subagentShare: 0.4,
  mcpCalls: 40,
};

const SUBAGENTS_PROJECT = "subagentes";
const LEVEL_ORDER: Record<InsightLevel, number> = { warn: 0, info: 1, good: 2 };

/** Gera os insights (estruturados) a partir das estatísticas da janela. */
export function computeInsights(s: TranscriptStats): Insight[] {
  const total = s.totalCostUSD;
  if (total <= 0 || s.turns < MIN_TURNS) {
    return [];
  }
  const out: Insight[] = [];
  const pct = (x: number) => Math.round((x / total) * 100);

  // Contexto grande (>150k) concentra o custo.
  const bigCtx = s.byContextBucket
    .filter((b) => b.bucket === "150–200k" || b.bucket === ">200k")
    .reduce((a, b) => a + b.costUSD, 0);
  if (bigCtx / total >= TH.ctxBigShare) {
    out.push({ id: "ctxBig", level: "warn", values: { pct: pct(bigCtx) } });
  }

  // Sessões longas (≥8h) concentram o custo.
  if (s.longSessionCostShare >= TH.longSessionShare) {
    out.push({
      id: "longSessions",
      level: "warn",
      values: { pct: Math.round(s.longSessionCostShare * 100), hours: 8 },
    });
  }

  // Eficiência de cache (hit rate = cacheRead / (cacheRead + cacheWrite)).
  const cr = s.tokenTotals.cacheRead;
  const cw = s.tokenTotals.cacheWrite;
  if (cr + cw > 0) {
    const hr = cr / (cr + cw);
    if (hr >= TH.cacheGood) {
      out.push({ id: "cacheGood", level: "good", values: { pct: Math.round(hr * 100) } });
    } else if (hr < TH.cacheLow) {
      out.push({ id: "cacheLow", level: "info", values: { pct: Math.round(hr * 100) } });
    }
  }

  // Output domina o custo (output é ~5× input).
  if (s.costByType.output / total >= TH.outputShare) {
    out.push({ id: "output", level: "info", values: { pct: pct(s.costByType.output) } });
  }

  // Opus concentra o custo.
  const opus = s.byModel
    .filter((m) => /opus/i.test(m.model))
    .reduce((a, m) => a + m.costUSD, 0);
  if (opus / total >= TH.opusShare) {
    out.push({ id: "opus", level: "info", values: { pct: pct(opus) } });
  }

  // Subagentes concentram o custo.
  const sub = s.byProject
    .filter((p) => p.project === SUBAGENTS_PROJECT)
    .reduce((a, p) => a + p.costUSD, 0);
  if (sub / total >= TH.subagentShare) {
    out.push({ id: "subagents", level: "info", values: { pct: pct(sub) } });
  }

  // Servidor MCP muito chamado.
  const topMcp = s.byMcpServer[0];
  if (topMcp && topMcp.calls > TH.mcpCalls) {
    out.push({ id: "mcp", level: "info", values: { name: topMcp.name, calls: topMcp.calls } });
  }

  out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return out.slice(0, MAX_INSIGHTS);
}

/** Texto localizado de um insight (via `tr`, segue o idioma do plugin). */
export function insightText(i: Insight): string {
  const v = i.values;
  switch (i.id) {
    case "ctxBig":
      return tr("{0}% do seu custo veio de turnos com contexto >150k. Use /compact no meio da tarefa e /clear ao trocar de assunto.", v.pct);
    case "longSessions":
      return tr("{0}% do custo veio de sessões ativas {1}h+. Sessões contínuas somam rápido — vale conferir se foram intencionais.", v.pct, v.hours);
    case "cacheGood":
      return tr("Ótimo aproveitamento de cache: {0}% de cache hit. Releitura barata em vez de reprocessar contexto.", v.pct);
    case "cacheLow":
      return tr("Cache hit em {0}% — baixo. Criar/expirar cache custa mais; sessões muito fragmentadas reduzem o reaproveitamento.", v.pct);
    case "output":
      return tr("{0}% do custo é geração (output) — o token mais caro (~5× o input). Respostas mais enxutas economizam.", v.pct);
    case "opus":
      return tr("Opus concentra {0}% do custo. Para tarefas leves, Sonnet/Haiku cortam bastante.", v.pct);
    case "subagents":
      return tr("Subagentes puxam {0}% do custo. Úteis, mas pesados — avalie reduzir o fan-out.", v.pct);
    case "mcp":
      return tr('O servidor MCP "{0}" foi chamado {1}×. Vale conferir chamadas redundantes.', v.name, v.calls);
    default:
      return "";
  }
}

/** Conveniência: insights já localizados (estruturados → texto), pra UI. */
export function computeInsightTexts(s: TranscriptStats): InsightText[] {
  return computeInsights(s).map((i) => ({ level: i.level, text: insightText(i) }));
}
