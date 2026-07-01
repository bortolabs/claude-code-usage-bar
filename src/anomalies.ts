import { TranscriptStats } from "./transcriptStats";
import { tr } from "./i18n";

/**
 * Detector de ANOMALIAS / desperdício de tokens — padrões ruins ACIONÁVEIS nos
 * transcripts da janela. Diferente dos "insights" (callouts descritivos) e das
 * "tips" (dicas de economia), aqui o foco é apontar um problema concreto agora:
 * contexto inflado, loop de tool calls, cache hit despencando, MCP disparado.
 *
 * Local, sem rede, sem LLM. Cada anomalia tem `id` estável + `values`; o texto é
 * montado/traduzido por `anomalyText` via `tr()` (segue o idioma do plugin).
 *
 * Os sinais que precisam de dados por-turno (`ctxInflatedTurns`, `maxToolRunLength`)
 * já vêm pré-computados em `TranscriptStats` (streaming no agregador). Aqui só se
 * aplicam os LIMIARES configuráveis — de propósito fora do cache de stats, que não
 * é invalidado por mudança de setting.
 */

export type AnomalyLevel = "crit" | "warn" | "info";
export interface Anomaly {
  id: string;
  level: AnomalyLevel;
  values: Record<string, string | number>;
}
/** Anomalia já localizada, pronta pra exibir. */
export interface AnomalyText {
  level: AnomalyLevel;
  text: string;
}

/** Limiares configuráveis (via settings). `cacheHitMinPct` em fração (0–1). */
export interface AnomalyThresholds {
  /** Hit rate de cache abaixo disto (0–1) dispara `cacheLow`. */
  cacheHitMinPct: number;
  /** Servidor MCP com mais chamadas que isto dispara `mcpRunaway`. */
  mcpCallsMax: number;
  /** Nº mínimo de turnos "inflados" (contexto > corte) p/ disparar `ctxInflated`. */
  ctxInflatedTurns: number;
  /** Tamanho do run de chamadas idênticas p/ disparar `toolLoop`. */
  toolLoopK: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  cacheHitMinPct: 0.5,
  mcpCallsMax: 60, // > tips.mcpCalls (40) de propósito: não duplicar o mesmo alerta
  ctxInflatedTurns: 3,
  toolLoopK: 5,
};

const MIN_TURNS = 5; // amostra mínima p/ arriscar uma anomalia
const MAX_ANOMALIES = 5;
const LEVEL_ORDER: Record<AnomalyLevel, number> = { crit: 0, warn: 1, info: 2 };

/** Gera as anomalias (estruturadas) a partir das estatísticas da janela. */
export function computeAnomalies(
  s: TranscriptStats,
  thresholds: Partial<AnomalyThresholds> = {}
): Anomaly[] {
  if (s.turns < MIN_TURNS) {
    return [];
  }
  const th: AnomalyThresholds = { ...DEFAULT_ANOMALY_THRESHOLDS, ...thresholds };
  const out: Anomaly[] = [];

  // toolLoop (crit) — mesma chamada de tool repetida em sequência num turno.
  if (s.maxToolRunLength >= th.toolLoopK && s.toolLoopName) {
    out.push({
      id: "toolLoop",
      level: "crit",
      values: { name: s.toolLoopName, runs: s.maxToolRunLength },
    });
  }

  // ctxInflated (warn) — muitos turnos carregando contexto muito grande.
  if (s.ctxInflatedTurns >= th.ctxInflatedTurns) {
    out.push({
      id: "ctxInflated",
      level: "warn",
      values: { turns: s.ctxInflatedTurns },
    });
  }

  // cacheLow (warn) — hit rate de cache abaixo do piso.
  const cr = s.tokenTotals.cacheRead;
  const cw = s.tokenTotals.cacheWrite;
  if (cr + cw > 0) {
    const hr = cr / (cr + cw);
    if (hr < th.cacheHitMinPct) {
      out.push({ id: "cacheLow", level: "warn", values: { pct: Math.round(hr * 100) } });
    }
  }

  // mcpRunaway (warn) — um servidor MCP com volume desproporcional de chamadas.
  const topMcp = s.byMcpServer[0];
  if (topMcp && topMcp.calls > th.mcpCallsMax) {
    out.push({
      id: "mcpRunaway",
      level: "warn",
      values: { name: topMcp.name, calls: topMcp.calls },
    });
  }

  out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return out.slice(0, MAX_ANOMALIES);
}

/** Texto localizado de uma anomalia (via `tr`, segue o idioma do plugin). */
export function anomalyText(a: Anomaly): string {
  const v = a.values;
  switch (a.id) {
    case "toolLoop":
      return tr('Possível loop: a mesma chamada "{0}" se repetiu {1}× seguidas num turno. Cheque retries presos ou testes falhando em série.', v.name, v.runs);
    case "ctxInflated":
      return tr("{0} turnos carregaram contexto acima de 200k. Contexto inflado encarece cada turno — use /compact no meio e /clear ao trocar de assunto.", v.turns);
    case "cacheLow":
      return tr("Cache hit em {0}% — criar/expirar cache custa mais que reusar. Sessões muito fragmentadas ou trocas frequentes de contexto derrubam o reaproveitamento.", v.pct);
    case "mcpRunaway":
      return tr('O servidor MCP "{0}" foi chamado {1}× na janela — volume alto demais. Pode ser um processo em loop ou chamadas redundantes queimando tokens.', v.name, v.calls);
    default:
      return "";
  }
}

/** Conveniência: anomalias já localizadas (estruturadas → texto), pra UI. */
export function computeAnomalyTexts(
  s: TranscriptStats,
  thresholds: Partial<AnomalyThresholds> = {}
): AnomalyText[] {
  return computeAnomalies(s, thresholds).map((a) => ({ level: a.level, text: anomalyText(a) }));
}

/** True se há ao menos uma anomalia de nível crítico (p/ a notificação opt-in). */
export function hasCriticalAnomaly(list: Anomaly[]): boolean {
  return list.some((a) => a.level === "crit");
}
