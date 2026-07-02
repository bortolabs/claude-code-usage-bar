import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UsageViewProvider, PanelData } from "./panel";
import {
  DashboardPanel,
  exportDashboardHtml,
  DashboardData,
  DashWindow,
  DashSeriesPoint,
} from "./dashboard";
import {
  runCcusage,
  runCcusageDaily,
  CcusageResult,
  CcusageData,
  CcusageDaily,
} from "./ccusage";
import { evaluateAlerts, AlertResult } from "./alerts";
import { readCurrentTurn, prettyModel } from "./transcript";
import {
  fetchOAuthUsage,
  OAuthUsageResult,
  OAuthUsage,
  OAuthUnavailableReason,
} from "./oauthUsage";
import {
  readTranscriptStats,
  computeTips,
  TranscriptStats,
  Tip,
  TipThresholds,
} from "./transcriptStats";
import { computeInsightTexts } from "./insights";
import {
  computeAnomalies,
  computeAnomalyTexts,
  anomalyText,
  suppressCoveredTips,
  Anomaly,
  AnomalyThresholds,
} from "./anomalies";
import { runAiAdvice, setAiAdviceKey } from "./aiAdvice";
import { fetchStatus, StatusResult, StatusData, hasIssue } from "./status";
import { initI18n, setLang, tr } from "./i18n";
import { evaluateAdvice, Advice } from "./advisor";
import { HistoryStore } from "./history/store";
import {
  snapshotsFromStats,
  hourlyHeatmap,
  heatmapPeak,
  compareWindows,
} from "./history/aggregate";
import {
  projectLimitPct,
  etaToLimitMin,
  sessionTimePct,
} from "./core/projection";

/** Forma do JSON gravado por statusline-command.sh (bridge). */
interface RateWindow {
  used_percentage?: number | null;
  resets_at?: number | null;
}
interface LastCall {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}
interface UsageState {
  ts?: number;
  model?: string;
  session_id?: string;
  session_name?: string;
  cwd?: string;
  cost_usd?: number;
  context?: {
    input?: number;
    output?: number;
    size?: number;
    used_pct?: number | null;
  };
  last_call?: LastCall | null;
  five_hour?: RateWindow | null;
  seven_day?: RateWindow | null;
}

type Mode = "auto" | "subscriber" | "cost";
type BarStyle = "ring" | "bar" | "number" | "icon";

// Anel de progresso em texto: 9 níveis de 0% a 100%.
const RING_GLYPHS = ["○", "◔", "◔", "◑", "◑", "◕", "◕", "●", "●"];

function ringFor(pct: number): string {
  const idx = Math.min(
    RING_GLYPHS.length - 1,
    Math.max(0, Math.round((pct / 100) * (RING_GLYPHS.length - 1)))
  );
  return RING_GLYPHS[idx];
}

function textBar(pct: number, width = 5): string {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function styleText(
  style: BarStyle,
  ringPct: number | null,
  primary: string,
  suffix: string
): string {
  const p = ringPct ?? 0;
  switch (style) {
    case "bar":
      return `${textBar(p)} ${primary}${suffix}`;
    case "number":
      return `${primary}${suffix}`;
    case "icon":
      return `$(pulse) ${primary}${suffix}`;
    case "ring":
    default:
      return `${ringFor(p)} ${primary}${suffix}`;
  }
}

function fmtTokens(n: number | undefined): string {
  if (!n || n <= 0) {
    return "0";
  }
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return String(n);
}

function fmtUsd(n: number | undefined): string {
  const v = n ?? 0;
  if (v >= 100) {
    return "$" + v.toFixed(0);
  }
  if (v >= 10) {
    return "$" + v.toFixed(1);
  }
  return "$" + v.toFixed(2);
}

function fmtResetsAt(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) {
    return "—";
  }
  return tr("em {0}", fmtDuration(epochSeconds * 1000 - Date.now()));
}

/** Duração curta a partir de ms: "40m", "2h13", "3d". */
function fmtResetsShort(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) {
    return "";
  }
  return fmtDuration(epochSeconds * 1000 - Date.now());
}

function fmtDuration(deltaMs: number): string {
  if (deltaMs <= 0) {
    return "0m";
  }
  const totalMin = Math.round(deltaMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d${rh}h` : `${d}d`;
  }
  if (h > 0) {
    return `${h}h${String(m).padStart(2, "0")}`;
  }
  return `${m}m`;
}

/**
 * Quebra de tokens por tipo (p/ o card de hover): % de cada tipo sobre o total
 * e o "cache hit %". Recebe os totais já agregados da janela
 * (TranscriptStats.tokenTotals) — não somar byModel, que é fatiado em `limit`.
 */
function tokenBreakdown(t: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): {
  total: number;
  rows: { label: string; count: number; pct: number }[];
  cacheHitPct: number;
} {
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const rows = [
    { label: tr("Input"), count: t.input, pct: pct(t.input) },
    { label: tr("Output"), count: t.output, pct: pct(t.output) },
    { label: tr("Cache (leitura)"), count: t.cacheRead, pct: pct(t.cacheRead) },
    { label: tr("Cache (escrita)"), count: t.cacheWrite, pct: pct(t.cacheWrite) },
  ];
  // "hit" = releitura sobre o total de cache (leitura+escrita). Proposital:
  // difere da fórmula da DICA (extension.ts ~649), que usa input+leitura+escrita.
  const cacheDenom = t.cacheRead + t.cacheWrite;
  const cacheHitPct = cacheDenom > 0 ? (t.cacheRead / cacheDenom) * 100 : 0;
  return { total, rows, cacheHitPct };
}

// Janela das QUEBRAS de custo (aba Custos). Valor de runtime autoritativo —
// ver costWindowValue — pra não depender de config.update propagar.
type CostWindow = "5h" | "today" | "7d" | "30d";

// Motivo do oauth/usage estar indisponível, em forma ESTRUTURADA. Guardamos o
// estado cru (não a string já traduzida) e só montamos o texto na hora de
// exibir — assim ele acompanha o idioma ATUAL do plugin. Sem isto, a frase fica
// congelada no idioma em que a falha ocorreu (ex.: voltar do alemão pro pt e
// ainda ver "Wartezeit…" na Fonte de dados).
type OAuthStatusReason =
  | { kind: "disabled" }
  | OAuthUnavailableReason
  | { kind: "backoff"; inner: OAuthUnavailableReason; waitMs: number };

/** Monta o texto do motivo no idioma atual (chamado no render). */
function localizeOAuthReason(r: OAuthStatusReason | null): string | null {
  if (!r) {
    return null;
  }
  switch (r.kind) {
    case "disabled":
      return tr("desativado nas configurações");
    case "consent":
      return tr(
        "aguardando seu consentimento — conceda o acesso ao token na aba Config"
      );
    case "noToken":
      return tr(
        "token OAuth não encontrado (.credentials.json / Keychain / CLAUDE_CODE_OAUTH_TOKEN)"
      );
    case "httpError":
      return tr("falha ao consultar oauth/usage ({0})", r.detail);
    case "backoff":
      return tr(
        "{0} — recuando, nova tentativa em ~{1}",
        localizeOAuthReason(r.inner) ?? "—",
        fmtDuration(r.waitMs)
      );
  }
}

/** Traduz o impacto de incidente (vindo em inglês da API) para o idioma ativo. */
function impactPt(imp: string): string {
  return (
    {
      none: tr("sem impacto"),
      minor: tr("impacto menor"),
      major: tr("impacto alto"),
      critical: tr("crítico"),
      maintenance: tr("manutenção"),
    } as Record<string, string>
  )[imp] || imp;
}

function fmtAgo(ts: number | undefined): string {
  if (!ts) {
    return "—";
  }
  const sec = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (sec < 60) {
    return tr("há {0}s", sec);
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return tr("há {0}min", min);
  }
  const h = Math.round(min / 60);
  return tr("há {0}h", h);
}

export function activate(context: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("claudeUsageBar");

  // i18n com override de idioma. Guardado no globalState (não num setting), pois
  // settings só podem ser escritos quando JÁ registrados — logo após instalar a
  // extensão por cima de uma janela aberta, `config.update` falha e a seleção das
  // bandeiras não persistia. O globalState é sempre gravável (e é sincronizado).
  initI18n(context.extensionPath);
  setLang(context.globalState.get<string>("language"));

  // alignment/priority só podem ser definidos na CRIAÇÃO do item — o VS Code não
  // deixa mutar depois. Por isso guardamos os valores atuais e recriamos o item
  // quando esses settings mudam (senão trocar "left"/priority não fazia nada).
  const readAlignment = () =>
    cfg().get<string>("alignment") === "left"
      ? vscode.StatusBarAlignment.Left
      : vscode.StatusBarAlignment.Right;
  let curAlignment = readAlignment();
  let curPriority = cfg().get<number>("priority") ?? 100;
  const makeStatusItem = () => {
    const it = vscode.window.createStatusBarItem(curAlignment, curPriority);
    it.command = "claudeUsageBar.openPanel";
    it.show();
    context.subscriptions.push(it);
    return it;
  };
  let item = makeStatusItem();

  let lastState: UsageState | null = null;
  let lastCcusage: CcusageResult | null = null;
  // Janela das quebras de custo: valor de runtime AUTORITATIVO (não lemos
  // cfg().get a cada uso). As bandeiras/botões gravam aqui via comando dedicado
  // e SÓ então persistem no setting — assim a troca vale na hora, sem depender
  // de config.update propagar/disparar o evento (que se mostrou não confiável,
  // igual ao bug do idioma). Inicia do setting salvo (respeita o que o usuário
  // já tinha) e é re-sincronizado se ele editar direto nas Settings.
  let costWindowValue: CostWindow = ((): CostWindow => {
    const w = cfg().get<string>("costWindow");
    return w === "today" || w === "7d" || w === "30d" ? w : "5h";
  })();
  // Janela do DASHBOARD (independente da janela das quebras da sidebar).
  let dashboardWindowValue: DashWindow = ((): DashWindow => {
    const w = cfg().get<string>("dashboardWindow");
    return w === "week" || w === "month" || w === "all" ? w : "today";
  })();
  // Uso REAL do plano (igual /usage), via endpoint OAuth — fonte primária.
  let lastOAuth: OAuthUsageResult | null = null;
  let lastOAuthOkMs = 0; // quando o oauth respondeu com sucesso pela última vez
  // Resultado da ÚLTIMA tentativa de oauth/usage (p/ mostrar a fonte e, quando
  // cai no fallback, explicar o motivo — em vez de cair no ccusage em silêncio).
  let lastOAuthStatus: { ok: boolean; reason: OAuthStatusReason | null } = {
    ok: false,
    reason: null,
  };
  // Backoff do oauth/usage: o endpoint tem rate-limit próprio e, com o polling
  // de 60s + os disparos por foco/visibilidade, dá pra levar 429 mesmo SEM a
  // cota ter estourado. Em falha (sobretudo 429) recuamos exponencialmente —
  // qualquer gatilho (intervalo, foco, view) respeita esse "até quando".
  // Persistido no globalState: recarregar a janela zerava o backoff em memória
  // e o burst de startup batia de novo num endpoint ainda em 429.
  const savedBackoff = context.globalState.get<{
    untilMs: number;
    streak: number;
  }>("oauthBackoff");
  let oauthBackoffUntilMs =
    savedBackoff && savedBackoff.untilMs > Date.now()
      ? savedBackoff.untilMs
      : 0; // epoch ms: não chamar a API antes disso
  let oauthFailStreak =
    oauthBackoffUntilMs > 0 ? savedBackoff?.streak ?? 0 : 0; // nº de falhas consecutivas (dobra o recuo)
  const persistBackoff = () => {
    // best-effort; não bloqueia o fluxo do refresh
    void context.globalState.update(
      "oauthBackoff",
      oauthBackoffUntilMs > 0
        ? { untilMs: oauthBackoffUntilMs, streak: oauthFailStreak }
        : undefined
    );
  };
  // No startup (reabrir o VS Code) vários gatilhos chamam refreshOAuth quase
  // juntos (activate + onReady da view + foco da janela). Sem este guard eles
  // viram um BURST de requests ao MESMO endpoint e o próprio burst (somado ao
  // poll do Claude Code) leva 429. Garante "uma chamada de cada vez".
  let oauthInFlight = false;
  let lastUpdateMs = 0; // última vez que QUALQUER fonte trouxe dados (p/ "atualizado há Xs")
  // Modelo atual em uso (lido do transcript; o ccusage mistura modelos do bloco).
  let currentModel: string | null = null;
  // % de contexto do último turno (do transcript) — fonte primária do Contexto,
  // funciona no app/IDE sem depender da statusline (que pode estar velha).
  let currentContextPct: number | null = null;
  // Histórico diário (sparkline). Atualizado num intervalo mais folgado.
  let lastDaily: CcusageDaily[] = [];
  // Estatísticas locais dos transcripts (custo por modelo etc.) do bloco de 5h.
  // Só calculado quando `insightsEnabled` (gate da leitura de disco).
  let lastStats: TranscriptStats | null = null;
  // Histórico persistente (sobrevive à retenção de transcripts do Claude Code).
  const history = new HistoryStore(context.globalStorageUri.fsPath);
  let historyTick: NodeJS.Timeout | undefined;
  // Cache das agregações de histórico do dashboard (recalcula a cada 5 min).
  let dashHistoryCache: {
    atMs: number;
    value: DashboardData["history"];
  } | null = null;
  // Status da Anthropic (status.claude.com) + dedupe da notificação.
  let lastStatus: StatusResult | null = null;
  let notifiedIncidentIds = new Set<string>();
  let watcher: fs.FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let tick: NodeJS.Timeout | undefined;
  let ccTick: NodeJS.Timeout | undefined;
  let dailyTick: NodeJS.Timeout | undefined;
  let oauthTick: NodeJS.Timeout | undefined;
  let statusTick: NodeJS.Timeout | undefined;
  // Alerta: controle de cooldown da notificação.
  let lastAlertKey = "";
  let lastAlertAtMs = 0;
  // Anomalia crítica (loop): cooldown/histerese da notificação opt-in.
  let lastAnomalyKey = "";
  let lastAnomalyAtMs = 0;
  // Copiloto de cota: histerese (keys ativas no render anterior) + cooldown
  // próprio da notificação (bem mais folgado que o do alerta — 6h default).
  let activeAdviceKeys = new Set<string>();
  let lastAdviceKey = "";
  let lastAdviceNotifyAtMs = 0;
  // "Silenciar 1h": epoch ms até quando NENHUM alerta deve notificar (independe
  // do tipo de alerta — senão uma mudança de chave fura o silêncio).
  let snoozeUntilMs = 0;
  // Aviso de fim de janela (#8): endMs do bloco já avisado (1x por janela).
  let resetWarnedEndMs = 0;
  // Resumo ao fechar o bloco (#9): rastreia a janela atual e o pico de uso nela.
  let curWindowResetMs = 0; // reset (epoch ms) da janela 5h atualmente em curso
  let curWindowPeakPct = 0; // maior % de cota observado na janela atual
  let curWindowPeakTokens = 0; // maior nº de tokens observado na janela atual
  let curWindowPeakCost = 0; // maior custo equivalente observado na janela atual
  // Alerta de cota baixa (opcional): janelas já avisadas ("5h"/"7d"). Re-arma
  // sozinho quando a cota se recupera acima do limiar (a janela reseta).
  const lowQuotaWarned = new Set<string>();
  // Alerta de orçamento mensal: chaves já avisadas ("projected"/"consumed").
  // Re-arma quando o gasto cai abaixo de ~90% do orçamento (histerese).
  const monthBudgetWarned = new Set<string>();

  // View ancorada na Activity Bar (sidebar esquerda).
  const viewProvider = new UsageViewProvider();
  // Recarrega TODAS as fontes (statusline, ccusage, diário, oauth, status).
  const refreshAll = () => {
    readState();
    refreshCcusage();
    refreshDaily();
    refreshOAuth();
    refreshStatus();
  };
  // Auto-refresh por foco/visibilidade, com throttle p/ não martelar (focar a
  // janela e revelar a view costumam disparar quase juntos). Evita o "dado
  // velho" ao reabrir o VS Code ou ao acordar de sleep — refaz o fetch na hora.
  let lastAutoRefreshMs = 0;
  const autoRefresh = () => {
    const now = Date.now();
    if (now - lastAutoRefreshMs < 3000) {
      return;
    }
    lastAutoRefreshMs = now;
    refreshAll();
  };
  viewProvider.onReady = refreshAll;
  viewProvider.onVisible = autoRefresh;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      UsageViewProvider.viewType,
      viewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  // Ao recuperar o foco da janela (reabrir o VS Code, voltar de outro app ou
  // acordar de sleep), refaz o fetch — evita exibir dados velhos.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        autoRefresh();
      }
    })
  );

  const resolveStatePath = (): string => {
    const custom = (cfg().get<string>("stateFilePath") || "").trim();
    if (custom) {
      return custom.startsWith("~")
        ? path.join(os.homedir(), custom.slice(1))
        : custom;
    }
    return path.join(os.homedir(), ".claude", "usage-state.json");
  };

  // Caminho do arquivo de EXPORT (uso atual gravado pelo plugin p/ agentes/scripts).
  // Vazio = ~/.claude/usage-bar.json. os.homedir() resolve em Windows/macOS/Linux.
  const resolveExportPath = (): string => {
    const custom = (cfg().get<string>("exportStatePath") || "").trim();
    if (custom) {
      return custom.startsWith("~")
        ? path.join(os.homedir(), custom.slice(1))
        : custom;
    }
    return path.join(os.homedir(), ".claude", "usage-bar.json");
  };

  /**
   * Grava o uso atual num JSON local (escrita atômica) para agentes/scripts lerem
   * — ex.: parar o auto-mode quando `fiveHour.remainingPct` ficar baixo. Só expõe
   * `trustworthy: true` quando a fonte é cota REAL (oauth/statusline); no ccusage
   * (% de tempo) marca false e não inventa "remaining". Sem token, sem rede.
   */
  const writeExport = (v: View | null): void => {
    if (!(cfg().get<boolean>("exportStateEnabled") ?? true)) {
      return;
    }
    const sourceKind: "oauth" | "statusline" | "ccusage" | "none" = !v
      ? "none"
      : oa()
      ? "oauth"
      : stateIsFresh(v.state) && stateHasRate(v.state)
      ? "statusline"
      : v.block
      ? "ccusage"
      : "none";
    const trustworthy = sourceKind === "oauth" || sourceKind === "statusline";
    const win = (
      pct: number | null,
      resetMs: number | null,
      resetsAtSec: number | null | undefined
    ) =>
      pct == null
        ? null
        : {
            usedPct: Math.round(pct),
            remainingPct: Math.max(0, Math.min(100, Math.round(100 - pct))),
            resetsAt: resetMs ?? (resetsAtSec ? resetsAtSec * 1000 : null),
          };
    const obj = {
      v: 2,
      ts: Date.now(),
      source: sourceKind,
      trustworthy,
      level: v?.level ?? null,
      model: (v && prettyModel(v.modelName)) || null,
      fiveHour: v
        ? win(v.fiveHour, v.fiveHourResetMs, v.state?.five_hour?.resets_at)
        : null,
      sevenDay: v
        ? win(v.sevenDay, v.sevenDayResetMs, v.state?.seven_day?.resets_at)
        : null,
      // Janelas 7d dedicadas por modelo (oauth) — null quando o plano não tem.
      sevenDaySonnet: v?.sevenDaySonnet
        ? win(v.sevenDaySonnet.utilization, v.sevenDaySonnet.resetsAt, null)
        : null,
      sevenDayOpus: v?.sevenDayOpus
        ? win(v.sevenDayOpus.utilization, v.sevenDayOpus.resetsAt, null)
        : null,
      contextPct: v?.ctxPct != null ? Math.round(v.ctxPct) : null,
      cost: v ? Number((v.cost ?? 0).toFixed(2)) : null,
      etaMinutes: v?.etaMin ?? null,
      // v2: custo de hoje/mês (ccusage, oficial) + quebra por modelo (≈ aproximado).
      today: v ? Number((v.today ?? 0).toFixed(2)) : null,
      month: v
        ? {
            costUSD: Number((v.monthToDate ?? 0).toFixed(2)),
            projectedUSD: Number((v.monthProjected ?? 0).toFixed(2)),
            budgetUSD: v.monthlyBudgetUsd || 0,
            overBudget:
              v.monthlyBudgetUsd > 0 && v.monthToDate >= v.monthlyBudgetUsd,
          }
        : null,
      byModel: v && v.stats
        ? v.stats.byModel.map((m) => ({
            model: m.model,
            tokens: m.tokens,
            costUSD: Number(m.costUSD.toFixed(4)),
            approximate: true,
          }))
        : null,
    };
    try {
      const p = resolveExportPath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const json = JSON.stringify(obj, null, 2);
      const tmp = p + ".tmp";
      fs.writeFileSync(tmp, json);
      try {
        fs.renameSync(tmp, p); // atômico (POSIX); no Windows o Node já sobrescreve
      } catch {
        fs.writeFileSync(p, json); // fallback se o rename falhar
        try {
          fs.unlinkSync(tmp);
        } catch {
          // ignora
        }
      }
    } catch {
      // best-effort: caminho inválido/sem permissão — não quebra o render
    }
  };
  const stateIsFresh = (s: UsageState | null): boolean => {
    if (!s || !s.ts) {
      return false;
    }
    const maxAge = cfg().get<number>("staleAfterSeconds") ?? 900;
    return Date.now() / 1000 - s.ts <= maxAge;
  };
  const stateHasRate = (s: UsageState | null): boolean =>
    !!s &&
    (s.five_hour?.used_percentage != null ||
      s.seven_day?.used_percentage != null);

  const readState = () => {
    const p = resolveStatePath();
    try {
      const raw = fs.readFileSync(p, "utf8");
      lastState = JSON.parse(raw) as UsageState;
    } catch {
      // arquivo ausente ou leitura no meio de um mv — mantém o último estado
    }
    // Modelo + contexto atuais vêm do transcript (o ccusage mistura modelos do
    // bloco; e o contexto da statusline pode estar velho no app/IDE).
    const turn = readCurrentTurn();
    if (turn.model) {
      currentModel = turn.model;
    }
    if (turn.contextPct != null) {
      currentContextPct = turn.contextPct;
    }
    render();
  };

  // Janela (epoch ms de início) das QUEBRAS de custo, conforme `costWindow`.
  // "5h" = bloco atual (reset do oauth ou startMs do ccusage); "today" = meia-noite
  // local; "7d"/"30d" = janela móvel. O fim é sempre "agora".
  const costWindowStart = (): number => {
    const w = costWindowValue;
    const now = Date.now();
    if (w === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (w === "7d") {
      return now - 7 * 24 * 3600 * 1000;
    }
    if (w === "30d") {
      return now - 30 * 24 * 3600 * 1000;
    }
    // "5h": bloco atual — reset real do oauth (resetAt - 5h) ou startMs do ccusage.
    const resetMs = oa()?.fiveHour?.resetsAt ?? null;
    const block = lastCcusage && lastCcusage.available ? lastCcusage : null;
    return resetMs
      ? resetMs - 5 * 3600 * 1000
      : block
      ? block.startMs
      : now - 5 * 3600 * 1000;
  };

  // Início da janela do dashboard (Hoje/Semana/Mês/Tudo).
  const dashWindowStart = (w: DashWindow): number => {
    const now = Date.now();
    if (w === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (w === "week") {
      return now - 7 * 24 * 3600 * 1000;
    }
    if (w === "month") {
      return now - 30 * 24 * 3600 * 1000;
    }
    return 0; // "all" = tudo (epoch 0)
  };

  /** Meia-noite LOCAL de hoje (epoch ms). */
  const startOfLocalDay = (): number => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const todayKey = (): string => {
    const d = new Date();
    const p2 = (n: number) => (n < 10 ? "0" + n : String(n));
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  };

  /**
   * Grava o histórico persistente a partir dos transcripts. `windowDays` curto
   * (2) no tick de 15min — o byHour do transcriptStats só cobre ~72h, então o
   * dia corrente/anterior sempre têm o split por hora. `backfill` (ativação):
   * janela longa só pra preencher DIAS AINDA AUSENTES no store (sem horas), sem
   * sobrescrever dias já gravados com horas boas.
   */
  const recordHistory = (windowDays: number, backfill = false) => {
    if (!(cfg().get<boolean>("historyEnabled") ?? true)) {
      return;
    }
    try {
      const start = startOfLocalDay() - windowDays * 86_400_000;
      const s = readTranscriptStats(start);
      let snaps = snapshotsFromStats(s.byDay, s.byHour);
      if (backfill) {
        const existing = new Set(history.readAll().map((d) => d.date));
        snaps = snaps.filter((d) => !existing.has(d.date));
      }
      if (snaps.length) {
        history.upsert(
          snaps,
          cfg().get<number>("historyRetentionDays") ?? 365
        );
        dashHistoryCache = null; // invalida as agregações
      }
    } catch {
      // best-effort: histórico nunca derruba o resto
    }
  };

  /** Agregações do histórico p/ o dashboard (cache de 5 min). */
  const buildDashHistory = (): DashboardData["history"] => {
    if (!(cfg().get<boolean>("historyEnabled") ?? true)) {
      return null;
    }
    if (dashHistoryCache && Date.now() - dashHistoryCache.atMs < 5 * 60_000) {
      return dashHistoryCache.value;
    }
    let value: DashboardData["history"] = null;
    try {
      const days = history.readRange(90);
      if (days.length) {
        const withHours = days.filter((d) => d.hours.some((h) => h > 0));
        const heat = hourlyHeatmap(withHours);
        value = {
          heatmap: heat,
          peak: heatmapPeak(heat),
          daysTracked: withHours.length,
          comparisons: compareWindows(days, todayKey()),
        };
      }
    } catch {
      value = null;
    }
    dashHistoryCache = { atMs: Date.now(), value };
    return value;
  };

  /**
   * Resumo semanal opt-in (ROADMAP #17): 1x por semana (na 2ª feira, no 1º
   * render do dia), custo/tokens da semana vs a anterior + link do dashboard.
   */
  const maybeWeeklySummary = () => {
    if (!(cfg().get<boolean>("weeklySummaryEnabled") ?? false)) {
      return;
    }
    const now = new Date();
    if (now.getDay() !== 1) {
      return; // só segunda
    }
    const weekKey = todayKey(); // a data da própria segunda identifica a semana
    if (context.globalState.get<string>("lastWeeklySummaryKey") === weekKey) {
      return;
    }
    const cmp = compareWindows(history.readAll(), weekKey).weekVsPrev;
    if (!cmp) {
      return; // ainda sem base de comparação — tenta na próxima semana
    }
    void context.globalState.update("lastWeeklySummaryKey", weekKey);
    const delta =
      cmp.costPct != null
        ? ` (${cmp.costPct >= 0 ? "+" : ""}${Math.round(cmp.costPct)}%)`
        : "";
    const btnDash = tr("Abrir dashboard");
    vscode.window
      .showInformationMessage(
        tr(
          "Claude Usage — sua semana: {0} tokens, ~{1}{2} vs a anterior.",
          fmtTokens(cmp.current.tokens),
          fmtUsd(cmp.current.costUSD),
          delta
        ),
        btnDash
      )
      .then((c) => {
        if (c === btnDash) {
          vscode.commands.executeCommand("claudeUsageBar.openDashboard");
        }
      });
  };

  // Monta o payload do dashboard de analytics para a janela ativa.
  const buildDashboardData = (): DashboardData => {
    const w = dashboardWindowValue;
    const s = readTranscriptStats(dashWindowStart(w));
    const cr = s.tokenTotals.cacheRead;
    const cw = s.tokenTotals.cacheWrite;
    const hitRate = cr + cw > 0 ? (cr / (cr + cw)) * 100 : 0;
    // Série temporal: por hora quando "Hoje", por dia nas demais janelas.
    const useHour = w === "today";
    const points: DashSeriesPoint[] = (useHour ? s.byHour : s.byDay).map((p: any) => ({
      label: useHour ? String(p.hour).slice(11) : String(p.date).slice(5), // "HH:00" / "MM-DD"
      input: p.input,
      output: p.output,
      cacheRead: p.cacheRead,
      cacheWrite: p.cacheWrite,
      tokens: p.tokens,
      costUSD: p.costUSD,
      messages: p.messages,
    }));
    return {
      window: w,
      kpis: {
        costUSD: s.totalCostUSD,
        messages: s.turns,
        input: s.tokenTotals.input,
        output: s.tokenTotals.output,
        cacheRead: cr,
        cacheWrite: cw,
        cacheHitRate: hitRate,
        totalTokens: s.totalTokens,
      },
      costByType: s.costByType,
      series: { unit: useHour ? "hour" : "day", points },
      insights: computeInsightTexts(s),
      anomalies: (cfg().get<boolean>("anomalyDetectionEnabled") ?? true)
        ? computeAnomalyTexts(s, anomalyThresholds())
        : [],
      byModel: s.byModel,
      byProject: s.byProject.map((p) => ({
        project: p.project,
        costUSD: p.costUSD,
        tokens: p.tokens,
      })),
      bySession: s.bySession.map((x) => ({
        session: x.session,
        project: x.project,
        costUSD: x.costUSD,
        tokens: x.tokens,
        messages: x.messages,
        durationMs: Math.max(0, x.lastTs - x.firstTs),
      })),
      byContext: s.byContextBucket.map((b) => ({
        bucket: b.bucket,
        costUSD: b.costUSD,
        tokens: b.tokens,
        turns: b.turns,
      })),
      bySkill: s.bySkill,
      byPlugin: s.byPlugin,
      byMcp: s.byMcpServer,
      bySubagent: s.bySubagent,
      isSub: resolveAccountType() === "subscription",
      tableVersion: s.tableVersion,
      history: buildDashHistory(),
    };
  };

  // Limiares das dicas a partir dos settings (shares em % → fração).
  const tipThresholds = (): Partial<TipThresholds> => {
    const c = cfg();
    const frac = (k: string, d: number) => {
      const v = c.get<number>(k);
      return (typeof v === "number" ? v : d) / 100;
    };
    return {
      ctxBigShare: frac("tipsContextBigPct", 25),
      cacheReadShare: frac("tipsCacheReadPct", 70),
      opusShare: frac("tipsOpusPct", 70),
      mcpCalls: cfg().get<number>("tipsMcpCalls") ?? 40,
      subagentShare: frac("tipsSubagentPct", 40),
    };
  };

  // Limiares do detector de anomalias a partir dos settings (cacheHit em % → fração).
  const anomalyThresholds = (): Partial<AnomalyThresholds> => {
    const c = cfg();
    const num = (k: string, d: number) => {
      const v = c.get<number>(k);
      return typeof v === "number" ? v : d;
    };
    return {
      cacheHitMinPct: num("anomalyCacheHitMinPct", 50) / 100,
      mcpCallsMax: num("anomalyMcpCallsMax", 60),
      ctxInflatedTurns: num("anomalyCtxInflatedTurns", 3),
      toolLoopK: num("anomalyToolLoopK", 5),
    };
  };

  // Anomalias localizadas p/ a UI. Gate: insightsEnabled (I/O de stats já feita)
  // + anomalyDetectionEnabled específico. Vazio se stats ausente ou desligado.
  const currentAnomalies = (): Anomaly[] => {
    if (!lastStats) {
      return [];
    }
    if (!(cfg().get<boolean>("anomalyDetectionEnabled") ?? true)) {
      return [];
    }
    return computeAnomalies(lastStats, anomalyThresholds());
  };

  // Recalcula as estatísticas locais (custo por modelo/projeto/contexto/MCP/
  // subagente) na janela escolhida. Gateado por insightsEnabled (pula a I/O).
  const refreshStats = () => {
    if (cfg().get<boolean>("insightsEnabled") ?? true) {
      try {
        lastStats = readTranscriptStats(costWindowStart());
      } catch {
        lastStats = null;
      }
    } else {
      lastStats = null;
    }
    render();
  };

  const refreshCcusage = async () => {
    const cmd =
      (cfg().get<string>("ccusageCommand") || "").trim() ||
      "npx -y ccusage@latest blocks --active --json";
    lastCcusage = await runCcusage(cmd);
    if (lastCcusage.available) {
      lastUpdateMs = Date.now();
    }
    refreshStats();
  };

  // ── Consentimento para leitura do token OAuth ──────────────────────────
  // O token de login do Claude Code CLI só é lido com opt-in EXPLÍCITO do
  // usuário (diálogo modal), persistido no globalState. Vale pra todo mundo,
  // inclusive quem já usava a extensão antes (sem grandfathering).
  const OAUTH_CONSENT_KEY = "oauthConsent";
  const oauthConsent = (): "granted" | "denied" | undefined =>
    context.globalState.get<"granted" | "denied">(OAUTH_CONSENT_KEY);

  const requestOauthConsent = async (fromCommand: boolean): Promise<void> => {
    const btnAllow = tr("Permitir");
    const btnNotNow = tr("Agora não");
    const choice = await vscode.window.showInformationMessage(
      tr("Ler o token do Claude Code para mostrar sua cota?"),
      {
        modal: true,
        detail: tr(
          "A extensão lê o token de login LOCAL do Claude Code CLI — de ~/.claude/.credentials.json, do Keychain do sistema ou da variável CLAUDE_CODE_OAUTH_TOKEN — e o usa somente para chamar o endpoint oficial da Anthropic (api.anthropic.com/api/oauth/usage, via HTTPS) e exibir a cota do seu próprio plano (5h/7d), igual ao /usage.\n\nO token nunca é registrado em logs, nunca é armazenado em outro lugar e nunca é enviado a terceiros. A extensão não tem telemetria.\n\nSem permissão, a extensão continua funcionando com as fontes locais (statusline/ccusage). Você pode mudar essa decisão a qualquer momento na aba Config."
        ),
      },
      btnAllow,
      btnNotNow
    );
    if (choice === btnAllow) {
      await context.globalState.update(OAUTH_CONSENT_KEY, "granted");
      refreshOAuth();
    } else if (choice === btnNotNow) {
      await context.globalState.update(OAUTH_CONSENT_KEY, "denied");
      lastOAuth = null;
      lastOAuthOkMs = 0;
      lastOAuthStatus = { ok: false, reason: { kind: "consent" } };
      render();
    } else if (!fromCommand) {
      // Esc no fluxo AUTOMÁTICO: registra "denied" pra não re-perguntar a
      // cada boot (máx. 1 pergunta automática). Reabre pela Config/comando.
      await context.globalState.update(OAUTH_CONSENT_KEY, "denied");
      render();
    }
    // Via comando, Esc não muda a decisão existente. Em todos os casos o
    // rebuild remonta o webview — a aba Config tem guard anti-re-render e só
    // assim o estado novo aparece na hora.
    viewProvider.rebuild();
  };

  const refreshOAuth = async () => {
    if (!(cfg().get<boolean>("useOAuthUsage") ?? true)) {
      lastOAuth = null;
      lastOAuthOkMs = 0;
      lastOAuthStatus = { ok: false, reason: { kind: "disabled" } };
      render();
      return;
    }
    // CONSENTIMENTO: sem opt-in explícito do usuário, NUNCA tocamos nas
    // credenciais — fetchOAuthUsage (única função que lê arquivo/Keychain/env)
    // nem é chamada. O painel cai nos fallbacks locais (statusline/ccusage) e
    // o card "Fonte de dados" explica o motivo.
    if (oauthConsent() !== "granted") {
      lastOAuth = null;
      lastOAuthOkMs = 0;
      lastOAuthStatus = { ok: false, reason: { kind: "consent" } };
      render();
      return;
    }
    // Uma chamada de cada vez: no startup vários gatilhos disparam quase juntos
    // (activate + onReady da view + foco). Sem isto eles viram um BURST ao mesmo
    // endpoint e o próprio burst (somado ao poll do Claude Code) leva 429 — é o
    // "problema que volta ao reabrir o VS Code".
    if (oauthInFlight) {
      return;
    }
    // Respeita o backoff: enquanto recuando, NÃO chama a API (vale p/ qualquer
    // gatilho — intervalo, foco ou abertura da view). Só re-renderiza a UI.
    if (Date.now() < oauthBackoffUntilMs) {
      render();
      return;
    }
    // Coalescência do foco: focar a janela (alt-tab) dispara refreshOAuth toda
    // hora. Se já temos um oauth bom RECENTE (<30s), não refaz a chamada — mata
    // o spam de alt-tab sem perder o refresh-ao-acordar (passados ~30s, refaz).
    // As fontes locais (statusline/ccusage) seguem atualizando no foco; só o
    // oauth (que tem rate-limit) é coalescido aqui. O intervalo de 60s e o
    // backoff continuam valendo normalmente.
    if (lastOAuthOkMs && Date.now() - lastOAuthOkMs < 30_000) {
      return;
    }
    oauthInFlight = true;
    let res: OAuthUsageResult;
    try {
      res = await fetchOAuthUsage();
    } finally {
      oauthInFlight = false;
    }
    if (res.available) {
      // Sucesso: guarda o resultado bom e o momento, e zera o backoff.
      lastOAuth = res;
      lastOAuthOkMs = Date.now();
      lastUpdateMs = Date.now();
      lastOAuthStatus = { ok: true, reason: null };
      oauthFailStreak = 0;
      oauthBackoffUntilMs = 0;
      persistBackoff();
    } else {
      // Backoff exponencial GENTIL: 1ª falha recua ~20s (cura a colisão
      // transitória de startup, quando o nosso fetch e o poll do Claude Code se
      // cruzam), dobrando até teto de 15min só quando o 429 é persistente. Um
      // piso alto (2min) no 1º 429 deixaria o painel no ccusage à toa.
      oauthFailStreak = Math.min(oauthFailStreak + 1, 8);
      const waitMs = Math.min(15 * 60_000, 10_000 * Math.pow(2, oauthFailStreak));
      oauthBackoffUntilMs = Date.now() + waitMs;
      persistBackoff();
      // Guarda o motivo CRU + o tempo de recuo; a frase é montada no render, no
      // idioma atual (ver localizeOAuthReason). Não congelar a string aqui.
      lastOAuthStatus = {
        ok: false,
        reason: { kind: "backoff", inner: res.reason, waitMs },
      };
    }
    // Falha pontual: NÃO descarta o último resultado bom (evita o flicker
    // entre o layout oauth e o ccusage). Só expira após oauthStaleMs.
    render();
  };

  // Mantém o último oauth bom enquanto não ficar velho demais — evita piscar
  // de volta pro layout do ccusage quando uma atualização falha pontualmente.
  const oa = (): OAuthUsage | null => {
    if (!lastOAuth || !lastOAuth.available) {
      return null;
    }
    const staleMs =
      (cfg().get<number>("oauthRefreshSeconds") ?? 60) * 1000 * 5; // 5 ciclos
    if (lastOAuthOkMs && Date.now() - lastOAuthOkMs > staleMs) {
      return null; // velho demais → deixa cair pro fallback
    }
    return lastOAuth;
  };

  // Status da Anthropic (status.claude.com). Atualiza badge + notifica incidentes.
  const refreshStatus = async () => {
    if (!(cfg().get<boolean>("statusCheckEnabled") ?? true)) {
      lastStatus = null;
      render();
      return;
    }
    const res = await fetchStatus();
    lastStatus = res;
    // Notificação 1x por incidente novo (se habilitado).
    if (res.available && (cfg().get<boolean>("statusNotifyEnabled") ?? true)) {
      for (const inc of res.incidents) {
        if (!notifiedIncidentIds.has(inc.id)) {
          notifiedIncidentIds.add(inc.id);
          const link = inc.shortlink || "https://status.claude.com";
          const btnStatus = tr("Ver status");
          vscode.window
            .showWarningMessage(
              tr(
                "Anthropic — {0} ({1})",
                inc.name,
                impactPt(inc.impact)
              ),
              btnStatus
            )
            .then((c) => {
              if (c === btnStatus) {
                vscode.env.openExternal(vscode.Uri.parse(link));
              }
            });
        }
      }
      // Limpa ids de incidentes que já resolveram (libera nova notificação futura).
      const activeIds = new Set(res.incidents.map((i) => i.id));
      notifiedIncidentIds.forEach((id) => {
        if (!activeIds.has(id)) {
          notifiedIncidentIds.delete(id);
        }
      });
    }
    render();
  };

  const st = (): StatusData | null =>
    lastStatus && lastStatus.available ? lastStatus : null;

  /**
   * Deriva o comando `daily` do `ccusageCommand` (que é do `blocks --active`),
   * trocando "blocks --active" por "daily" e mantendo o resto (ex: --json e o
   * binário/caminho configurado). Se não casar, usa o default com npx.
   */
  const dailyCommand = (): string => {
    const base = (cfg().get<string>("ccusageCommand") || "").trim();
    if (base && base.includes("blocks --active")) {
      return base.replace("blocks --active", "daily");
    }
    return "npx -y ccusage@latest daily --json";
  };

  const refreshDaily = async () => {
    lastDaily = await runCcusageDaily(dailyCommand());
    render();
  };

  /** Decide o modo efetivo a partir da config e dos dados disponíveis. */
  const effectiveMode = (hasRate: boolean): "plan" | "api" => {
    const wanted = (cfg().get<Mode>("mode") ?? "auto") as Mode;
    if (wanted === "subscriber") {
      return "plan";
    }
    if (wanted === "cost") {
      return "api";
    }
    return hasRate ? "plan" : "api";
  };

  /**
   * Tipo de conta. Em "subscription" o custo em $ é só equivalente de API
   * (não há cobrança adicional enquanto não estourar os limites do plano),
   * então não tem teto nem alerta de custo.
   */
  const resolveAccountType = (): "subscription" | "api" => {
    const wanted =
      (cfg().get<string>("accountType") ?? "auto") as
        | "auto"
        | "subscription"
        | "api";
    if (wanted === "api") {
      return "api";
    }
    // "subscription" e "auto" → assinatura. Não há sinal confiável p/ detectar
    // API automaticamente (ambos rodam no app), então auto assume o caso comum.
    // Quem usa API configura accountType: "api".
    return "subscription";
  };

  // Hex válido de 6 dígitos (ex: #D97757). Usado para validar a cor do tema.
  const HEX6 = /^#[0-9a-fA-F]{6}$/;
  // Laranja oficial do Claude, usado no tema "claude".
  const CLAUDE_ORANGE = "#D97757";

  /**
   * Resolve a cor de override do anel/barras a partir do tema configurado.
   * Retorna `null` no tema "semaforo" (mantém o comportamento atual: cor por
   * nível). Nos temas "claude"/"mono"/"custom" devolve a cor base — que o painel
   * aplica apenas quando o nível NÃO é crítico (no `err` continua vermelho).
   * Hex inválido em mono/custom é descartado (cai para `null`) p/ não quebrar o SVG.
   */
  const resolveRingColorOverride = (): string | null => {
    const theme = (cfg().get<string>("ringTheme") ?? "semaforo").trim();
    if (theme === "semaforo") {
      return null;
    }
    if (theme === "claude") {
      return CLAUDE_ORANGE;
    }
    // "mono" e "custom" (alias): cor definida pelo usuário, se for hex válido.
    const color = (cfg().get<string>("ringColor") || "").trim();
    return HEX6.test(color) ? color : null;
  };

  const ctxPctOf = (s: UsageState | null): number | null => {
    if (!s) {
      return null;
    }
    if (s.context?.used_pct != null) {
      return s.context.used_pct;
    }
    // Sem used_pct: só dá pra calcular se a statusline reportou tokens de
    // contexto. Se input+output == 0 (statusline não populou o contexto),
    // retornamos null (desconhecido) em vez de "0%" — a linha some no painel,
    // em vez de mostrar uma barra vazia enganosa.
    const used = (s.context?.input ?? 0) + (s.context?.output ?? 0);
    if (s.context?.size && s.context.size > 0 && used > 0) {
      return (used / s.context.size) * 100;
    }
    return null;
  };

  const cc = (): CcusageData | null =>
    lastCcusage && lastCcusage.available ? lastCcusage : null;

  /**
   * Custo de hoje, do mês até agora e projeção do mês, a partir do histórico
   * diário do ccusage (`daily`). É o número OFICIAL do ccusage (não a tabela
   * local). As datas do ccusage seguem o fuso local; comparamos com a data
   * local de hoje. Projeção = (gasto do mês / dias decorridos) × dias no mês.
   */
  const costSummary = (): {
    today: number;
    monthToDate: number;
    monthProjected: number;
  } => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}`;
    const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-`;
    let today = 0;
    let mtd = 0;
    for (const d of lastDaily) {
      if (!d.date) {
        continue;
      }
      if (d.date === todayStr) {
        today += d.costUSD;
      }
      if (d.date.startsWith(monthPrefix)) {
        mtd += d.costUSD;
      }
    }
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();
    const monthProjected =
      dayOfMonth > 0 ? (mtd / dayOfMonth) * daysInMonth : mtd;
    return { today, monthToDate: mtd, monthProjected };
  };

  const render = () => {
    const c = cfg();
    const warn = c.get<number>("warnThreshold") ?? 60;
    const err = c.get<number>("errorThreshold") ?? 85;
    const staleAfter = c.get<number>("staleAfterSeconds") ?? 900;
    const costCap = c.get<number>("costCapUsd") ?? 5;
    const style = (c.get<BarStyle>("barStyle") ?? "ring") as BarStyle;

    const s = lastState;
    const block = cc();
    const usage = oa(); // uso real do plano (oauth) — fonte primária
    const fresh = stateIsFresh(s);
    const hasRate = (fresh && stateHasRate(s)) || !!usage;

    // Sem nenhuma fonte: placeholder.
    if (!hasRate && !block && !fresh && !usage) {
      item.text = "$(circle-outline) Claude —";
      const md = new vscode.MarkdownString(
        tr(
          "**Claude Code Usage**\n\nSem dados ainda. A extensão usa o **ccusage** (uso da sessão de 5h, calculado dos transcripts) e, quando você roda o Claude Code no terminal, os limites **5h/7d** da statusline.\n\n_Rode `npx ccusage blocks --active` no terminal para testar a fonte._"
        )
      );
      md.isTrusted = true;
      item.tooltip = md;
      item.color = new vscode.ThemeColor("disabledForeground");
      item.backgroundColor = undefined;
      writeExport(null);
      return;
    }

    // Aviso de fim de janela (#8): notifica 1x quando faltar pouco pro reset 5h.
    const resetWarnMin = c.get<number>("resetWarningMinutes") ?? 10;
    if (resetWarnMin > 0 && block && block.remainingMinutes > 0) {
      const within = block.remainingMinutes <= resetWarnMin;
      if (within && resetWarnedEndMs !== block.endMs) {
        resetWarnedEndMs = block.endMs; // só uma vez por janela
        vscode.window.showInformationMessage(
          tr(
            "Claude Usage — sua sessão de 5h reseta em ~{0}.",
            fmtDuration(block.remainingMinutes * 60000)
          )
        );
      }
    }

    // oauth/usage tem prioridade máxima → modo "plan" (anel = cota real 5h).
    const mode = usage ? "plan" : effectiveMode(hasRate);
    const isSub = resolveAccountType() === "subscription";
    // Limites: oauth primeiro, depois statusline.
    const fiveHour =
      usage?.fiveHour?.utilization ?? s?.five_hour?.used_percentage ?? null;
    const sevenDay =
      usage?.sevenDay?.utilization ?? s?.seven_day?.used_percentage ?? null;
    // Reset real (epoch ms) da fonte oauth, se houver.
    const fiveHourResetMs = usage?.fiveHour?.resetsAt ?? null;
    const sevenDayResetMs = usage?.sevenDay?.resetsAt ?? null;
    // Contexto: prefere o cálculo AO VIVO do transcript (último turno / janela do
    // modelo), que funciona no app/IDE; cai pra statusline só se fresca. Assim
    // não congela mais num valor velho (ex.: "6%" de 47h atrás) quando a
    // statusline está parada.
    const ctxPct =
      currentContextPct != null ? currentContextPct : fresh ? ctxPctOf(s) : null;
    // Custo: prefere o do bloco ccusage (real do bloco de 5h); senão statusline.
    const cost = block?.costUSD ?? s?.cost_usd ?? 0;

    // Alerta de cota baixa (opcional, p/ quem não usa agente): avisa 1x quando
    // resta menos de X% numa janela real (oauth/statusline). Re-arma sozinho
    // quando a cota se recupera (histerese de +2pts evita oscilar no limiar).
    // Respeita o silêncio de 1h. Limiar 0 = desligado.
    const lowThr = c.get<number>("lowQuotaThreshold") ?? 15;
    if (lowThr > 0 && Date.now() >= snoozeUntilMs) {
      const fireLow = (
        win: "5h" | "7d",
        pct: number | null,
        resetMs: number | null
      ) => {
        if (pct == null) return;
        const remaining = 100 - pct;
        if (remaining <= lowThr) {
          if (!lowQuotaWarned.has(win)) {
            lowQuotaWarned.add(win);
            const left = Math.max(0, Math.round(remaining));
            const inReset =
              resetMs && resetMs > Date.now()
                ? tr(" (reseta em {0})", fmtDuration(resetMs - Date.now()))
                : "";
            const msg =
              win === "5h"
                ? tr(
                    "Claude Usage — sessão de 5h: resta {0}%{1}.",
                    left,
                    inReset
                  )
                : tr(
                    "Claude Usage — semana (7d): resta {0}%{1}.",
                    left,
                    inReset
                  );
            const btnOpen = tr("Abrir painel");
            const btnSnooze = tr("Silenciar 1h");
            vscode.window
              .showWarningMessage(msg, btnOpen, btnSnooze)
              .then((choice) => {
                if (choice === btnOpen) {
                  vscode.commands.executeCommand("claudeUsageBar.openPanel");
                } else if (choice === btnSnooze) {
                  snoozeUntilMs = Date.now() + 60 * 60_000;
                }
              });
          }
        } else if (remaining > lowThr + 2) {
          lowQuotaWarned.delete(win); // recuperou: re-arma p/ a próxima
        }
      };
      fireLow("5h", fiveHour, fiveHourResetMs);
      fireLow("7d", sevenDay, sevenDayResetMs);
    }

    // Alerta de orçamento mensal (opcional). Em assinatura o custo é só
    // equivalente de API → desligado por padrão, salvo se ativado explicitamente.
    const monthlyBudget = c.get<number>("monthlyBudgetUsd") ?? 0;
    const budgetSetExplicit =
      c.inspect<boolean>("monthlyBudgetAlertEnabled")?.globalValue ??
      c.inspect<boolean>("monthlyBudgetAlertEnabled")?.workspaceValue;
    const budgetAlertOn = isSub
      ? budgetSetExplicit === true
      : c.get<boolean>("monthlyBudgetAlertEnabled") ?? true;
    if (monthlyBudget > 0 && budgetAlertOn && Date.now() >= snoozeUntilMs) {
      const { monthToDate, monthProjected } = costSummary();
      const rearm = monthlyBudget * 0.9; // histerese: só re-arma abaixo de 90%
      const notifyBudget = (key: string, msg: string) => {
        if (monthBudgetWarned.has(key)) {
          return;
        }
        monthBudgetWarned.add(key);
        const btnOpen = tr("Abrir painel");
        const btnSnooze = tr("Silenciar 1h");
        vscode.window
          .showWarningMessage(msg, btnOpen, btnSnooze)
          .then((choice) => {
            if (choice === btnOpen) {
              vscode.commands.executeCommand("claudeUsageBar.openPanel");
            } else if (choice === btnSnooze) {
              snoozeUntilMs = Date.now() + 60 * 60_000;
            }
          });
      };
      // Consumido: já bateu o orçamento (mais grave).
      if (monthToDate >= monthlyBudget) {
        notifyBudget(
          "month-consumed",
          tr(
            "Claude Usage — orçamento mensal: já usou {0} de {1}.",
            fmtUsd(monthToDate),
            fmtUsd(monthlyBudget)
          )
        );
      } else if (monthToDate < rearm) {
        monthBudgetWarned.delete("month-consumed");
      }
      // Projetado: no ritmo atual o mês deve estourar (aviso antecipado) — só
      // enquanto ainda não estourou de fato (senão o "consumido" já cobre).
      if (monthToDate < monthlyBudget && monthProjected >= monthlyBudget) {
        notifyBudget(
          "month-projected",
          tr(
            "Claude Usage — no ritmo atual o mês deve fechar em ~{0} (orçamento {1}).",
            fmtUsd(monthProjected),
            fmtUsd(monthlyBudget)
          )
        );
      } else if (monthProjected < rearm) {
        monthBudgetWarned.delete("month-projected");
      }
    }

    // Resumo ao fechar o bloco (#9): quando a janela de 5h vira (reset mudou),
    // notifica o que a janela anterior consumiu e reinicia o rastreio.
    if (cfg().get<boolean>("blockSummaryEnabled") ?? true) {
      const windowKey = fiveHourResetMs ?? block?.endMs ?? 0;
      if (windowKey) {
        // IMPORTANTE: o resets_at do oauth varia alguns ms a cada chamada dentro
        // do MESMO bloco. Só consideramos "janela nova" quando o reset salta para
        // bem depois do anterior (≥ 1h) — um bloco de 5h novo reseta ~5h à frente.
        // Variação de ms/segundos é ruído da própria API e NÃO é reset.
        const NEW_WINDOW_THRESHOLD_MS = 60 * 60 * 1000; // 1h
        if (curWindowResetMs === 0) {
          // primeira observação: começa a rastrear sem notificar
          curWindowResetMs = windowKey;
        } else if (windowKey - curWindowResetMs > NEW_WINDOW_THRESHOLD_MS) {
          // a janela virou de verdade → resume a anterior (se teve uso relevante)
          if (curWindowPeakTokens > 0 || curWindowPeakPct > 0) {
            const partes: string[] = [];
            if (curWindowPeakPct > 0) {
              partes.push(
                tr("{0}% da cota", Math.round(curWindowPeakPct))
              );
            }
            if (curWindowPeakTokens > 0) {
              partes.push(
                tr("{0} tokens", fmtTokens(curWindowPeakTokens))
              );
            }
            if (curWindowPeakCost > 0) {
              partes.push(tr("~{0} equiv.", fmtUsd(curWindowPeakCost)));
            }
            vscode.window.showInformationMessage(
              tr(
                "Claude Usage — sessão de 5h encerrada: {0}. Janela nova começou.",
                partes.join(" · ")
              )
            );
          }
          // reinicia para a nova janela
          curWindowResetMs = windowKey;
          curWindowPeakPct = 0;
          curWindowPeakTokens = 0;
          curWindowPeakCost = 0;
        } else if (windowKey > curWindowResetMs) {
          // mesma janela, só refresca o reset (absorve o drift de ms sem resetar)
          curWindowResetMs = windowKey;
        }
        // acumula os picos da janela em curso
        curWindowPeakPct = Math.max(curWindowPeakPct, fiveHour ?? 0);
        curWindowPeakTokens = Math.max(
          curWindowPeakTokens,
          block?.totalTokens ?? 0
        );
        curWindowPeakCost = Math.max(curWindowPeakCost, cost);
      }
    }

    // Em assinatura, o custo NÃO entra na cor (não é cobrança).
    const costPctForColor =
      !isSub && costCap > 0 ? Math.min(100, (cost / costCap) * 100) : 0;

    // Cor por projeção (pior dos dois): calcula a % projetada conforme o modo.
    const colorByProj = c.get<boolean>("colorByProjection") ?? true;
    const intenseTpm = c.get<number>("intenseTokensPerMin") ?? 50000;
    const tokenCap = c.get<number>("sessionTokenCap") ?? 0;
    // % de tokens projetados vs teto da sessão (no ritmo atual). Vale em qualquer
    // modo com bloco ccusage — é o "estouro de tokens da sessão".
    const tokenProjPct =
      tokenCap > 0 && block?.projectedTokens != null
        ? (block.projectedTokens / tokenCap) * 100
        : null;
    let projPct: number | null = null; // % projetada (0..100+), p/ a cor
    if (colorByProj) {
      const p5 = projectLimitPct(fiveHour, s?.five_hour?.resets_at ?? null, 5 * 3600);
      const p7 = projectLimitPct(
        sevenDay,
        s?.seven_day?.resets_at ?? null,
        7 * 24 * 3600
      );
      const planProj = Math.max(p5 ?? 0, p7 ?? 0);
      if (mode === "plan") {
        projPct = Math.max(planProj, tokenProjPct ?? 0);
      } else if (block) {
        // app: custo projetado (api), ritmo de tokens (assinatura) e/ou
        // projeção de tokens vs teto da sessão.
        const costProjPct =
          !isSub && costCap > 0 && block.projectedCost != null
            ? (block.projectedCost / costCap) * 100
            : 0;
        const tokenIntensityPct =
          isSub && block.tokensPerMinute != null && intenseTpm > 0
            ? (block.tokensPerMinute / intenseTpm) * 100
            : 0;
        projPct = Math.max(
          costProjPct,
          tokenIntensityPct,
          tokenProjPct ?? 0,
          planProj
        );
      }
    }
    const projForColor = Math.min(150, projPct ?? 0); // cap p/ não explodir cores

    // ETA até estourar (#7): só faz sentido com limites reais (terminal) ou
    // custo (api). Pega o menor tempo entre os limites relevantes.
    let etaMin: number | null = null;
    if (mode === "plan") {
      const e5 = etaToLimitMin(fiveHour, s?.five_hour?.resets_at ?? null, 5 * 3600);
      const e7 = etaToLimitMin(
        sevenDay,
        s?.seven_day?.resets_at ?? null,
        7 * 24 * 3600
      );
      const etas = [e5, e7].filter((x): x is number => x != null);
      etaMin = etas.length ? Math.min(...etas) : null;
    } else if (!isSub && block && costCap > 0 && block.burnCostPerHour) {
      // API: ETA até o custo atingir o teto, no ritmo atual ($/h).
      const remainingUsd = costCap - cost;
      if (remainingUsd > 0) {
        const hrs = remainingUsd / block.burnCostPerHour;
        const mins = Math.round(hrs * 60);
        // só se estoura dentro do que resta do bloco
        if (mins < block.remainingMinutes) {
          etaMin = mins;
        }
      } else {
        etaMin = 0;
      }
    }

    // ETA até estourar o TETO DE TOKENS da sessão, no ritmo atual (tokens/min).
    // Vale em qualquer modo (o "estouro de tokens" que o usuário pediu).
    if (
      tokenCap > 0 &&
      block &&
      block.tokensPerMinute &&
      block.tokensPerMinute > 0
    ) {
      const remainingTokens = tokenCap - block.totalTokens;
      let tokEta: number | null;
      if (remainingTokens <= 0) {
        tokEta = 0;
      } else {
        const mins = Math.round(remainingTokens / block.tokensPerMinute);
        tokEta = mins < block.remainingMinutes ? mins : null;
      }
      if (tokEta != null) {
        etaMin = etaMin != null ? Math.min(etaMin, tokEta) : tokEta;
      }
    }

    let ringPct: number | null;
    let primary: string;
    let suffix: string;
    let centerLabel: string;
    let centerSub: string;
    let effective: number;

    if (mode === "plan") {
      // Anel = COTA REAL da sessão 5h (oauth/usage, igual /usage) ou statusline.
      ringPct = fiveHour;
      primary = fiveHour != null ? `${Math.round(fiveHour)}%` : "—";
      // Reset: prefere o epoch real do oauth; senão o da statusline.
      const resetShort = fiveHourResetMs
        ? fmtDuration(fiveHourResetMs - Date.now())
        : fmtResetsShort(s?.five_hour?.resets_at);
      suffix = resetShort ? ` · ${resetShort}` : "";
      centerLabel = primary;
      centerSub = resetShort
        ? tr("sessão 5h · reseta {0}", resetShort)
        : tr("sessão · 5h");
      effective = Math.max(fiveHour ?? 0, sevenDay ?? 0, projForColor);
    } else if (block) {
      // App/IDE: ccusage. SEM cota real — o herói é a % de TEMPO da sessão de 5h
      // (aproximado), por isso o "≈ tempo" no rótulo, pra não confundir com cota.
      ringPct = block.timePct;
      primary = `${Math.round(block.timePct)}%`;
      const resetShort = fmtDuration(block.remainingMinutes * 60000);
      suffix = ` · ${resetShort}`;
      centerLabel = primary;
      centerSub = tr("≈ tempo · reseta {0}", resetShort);
      // A COR nunca vem do TEMPO decorrido: tempo acabando é BOM (vem reset).
      // No ccusage (sem cota real) ela reflete só o custo (api) / projeção —
      // o número/anel ainda mostra o % de tempo, mas sem alarmar por isso.
      effective = Math.max(costPctForColor, projForColor);
    } else {
      // Só statusline fresca sem rate (raro).
      if (isSub) {
        // Assinatura sem rate/ccusage: mostra contexto (custo não é cobrança).
        ringPct = ctxPct;
        primary = ctxPct != null ? `${Math.round(ctxPct)}%` : "—";
        suffix = "";
        centerLabel = primary;
        centerSub = tr("contexto");
        effective = ctxPct ?? 0;
      } else {
        ringPct = ctxPct;
        primary = fmtUsd(cost);
        suffix = "";
        centerLabel = fmtUsd(cost);
        centerSub = tr("custo da sessão");
        effective = Math.max(ctxPct ?? 0, costPctForColor);
      }
    }

    // Modo "custo" na status bar (feature 4): troca o NÚMERO exibido por $ de
    // hoje ou do bloco de 5h, mantendo o anel/estilo e a cor (ringPct/effective
    // seguem refletindo a cota/tempo). Em assinatura, prefixa "~" (equivalente
    // API, não cobrança).
    const sbValue = (c.get<string>("statusBarValue") ?? "quota") as
      | "quota"
      | "today"
      | "session";
    if (sbValue !== "quota") {
      const dollar = sbValue === "today" ? costSummary().today : cost;
      const txt = (isSub ? "~" : "") + fmtUsd(dollar);
      primary = txt;
      centerLabel = txt;
    }

    // Avalia alerta de burn rate (projeção de estouro).
    const alertOn = c.get<boolean>("burnRateAlertEnabled") ?? true;
    // Em assinatura: custo não é cobrança → sem gatilho de custo;
    // gatilho de $/h só se o usuário tiver DEFINIDO burnRateMaxPerHour explicitamente.
    const maxPerHourSet =
      c.inspect<number>("burnRateMaxPerHour")?.globalValue ??
      c.inspect<number>("burnRateMaxPerHour")?.workspaceValue;
    const alertCostCap = isSub ? 0 : costCap;
    const alertMaxPerHour = isSub
      ? typeof maxPerHourSet === "number"
        ? maxPerHourSet
        : 0
      : c.get<number>("burnRateMaxPerHour") ?? 20;
    const alert: AlertResult = alertOn
      ? evaluateAlerts({
          block,
          costCap: alertCostCap,
          maxPerHour: alertMaxPerHour,
          tokenCap, // teto de tokens vale em qualquer modo (inclui assinatura)
          fiveHour,
          sevenDay,
          // resets em epoch SEGUNDOS: oauth (ms→s) tem prioridade.
          fiveHourResetsAt: fiveHourResetMs
            ? Math.floor(fiveHourResetMs / 1000)
            : s?.five_hour?.resets_at ?? null,
          sevenDayResetsAt: sevenDayResetMs
            ? Math.floor(sevenDayResetMs / 1000)
            : s?.seven_day?.resets_at ?? null,
        })
      : { active: false, message: "", reasons: [], key: "" };

    // Badge de status da Anthropic (se habilitado e há incidente).
    const statusBadgeOn = c.get<boolean>("statusBadgeEnabled") ?? true;
    const status = st();
    const statusIssue = !!status && statusBadgeOn && hasIssue(status);
    const statusBadge = statusIssue ? "$(cloud) " : "";

    // Ícone de alerta de burn rate antecede o texto quando ativo.
    item.text =
      statusBadge +
      (alert.active ? "$(warning) " : "") +
      styleText(style, ringPct, primary, suffix);

    let level: "ok" | "warn" | "err" =
      effective >= err ? "err" : effective >= warn ? "warn" : "ok";
    if (alert.active) {
      // Estouro JÁ consumado (uso atual crítico) = vermelho.
      // Apenas PROJEÇÃO de estouro = amarelo (warning), menos agressivo.
      const alreadyOver = Math.max(fiveHour ?? 0, sevenDay ?? 0) >= err;
      level = alreadyOver ? "err" : "warn";
    }
    if (level === "err") {
      item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else if (level === "warn") {
      item.color = undefined;
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    } else {
      item.color = undefined;
      item.backgroundColor = undefined;
    }

    // Notificação com cooldown (e re-dispara se o tipo de alerta mudar), mas
    // NUNCA durante o silêncio de 1h pedido pelo usuário ("Silenciar 1h").
    if (alert.active && Date.now() >= snoozeUntilMs) {
      const cooldownMs =
        (c.get<number>("alertCooldownMinutes") ?? 15) * 60_000;
      const now = Date.now();
      if (
        alert.key !== lastAlertKey ||
        now - lastAlertAtMs > cooldownMs
      ) {
        lastAlertKey = alert.key;
        lastAlertAtMs = now;
        // Incorpora a ETA na mensagem quando há previsão de estouro (#7).
        const etaSuffix =
          etaMin != null
            ? tr(" — estoura em ~{0}", fmtDuration(etaMin * 60000))
            : "";
        const btnOpen = tr("Abrir painel");
        const btnSnooze = tr("Silenciar 1h");
        const btnOff = tr("Desligar alertas");
        vscode.window
          .showWarningMessage(
            tr("Claude Usage — {0}", `${alert.message}${etaSuffix}`),
            btnOpen,
            btnSnooze,
            btnOff
          )
          .then((choice) => {
            if (choice === btnOpen) {
              vscode.commands.executeCommand("claudeUsageBar.openPanel");
            } else if (choice === btnSnooze) {
              // Silencia QUALQUER alerta por 1h, independentemente do tipo.
              snoozeUntilMs = Date.now() + 60 * 60_000;
            } else if (choice === btnOff) {
              cfg().update(
                "burnRateAlertEnabled",
                false,
                vscode.ConfigurationTarget.Global
              );
              render();
            }
          });
      }
    } else {
      lastAlertKey = "";
    }

    // Anomalia CRÍTICA (loop de tool) — notificação OPT-IN (default off). Só
    // dispara p/ nível "crit", respeita o silêncio de 1h e um cooldown próprio.
    // Re-arma sozinha quando não há mais anomalia crítica (mesma mecânica do
    // burn rate: zera a key p/ voltar a notificar quando reaparecer).
    const anomalyNotifyOn = c.get<boolean>("anomalyNotifyEnabled") ?? false;
    const critList = lastStats
      ? computeAnomalies(lastStats, anomalyThresholds()).filter((a) => a.level === "crit")
      : [];
    const critAnomaly = critList[0];
    if (
      anomalyNotifyOn &&
      critAnomaly &&
      (cfg().get<boolean>("anomalyDetectionEnabled") ?? true) &&
      Date.now() >= snoozeUntilMs
    ) {
      const cooldownMs = (c.get<number>("alertCooldownMinutes") ?? 15) * 60_000;
      const key = critAnomaly.id + ":" + JSON.stringify(critAnomaly.values);
      const now = Date.now();
      if (key !== lastAnomalyKey || now - lastAnomalyAtMs > cooldownMs) {
        lastAnomalyKey = key;
        lastAnomalyAtMs = now;
        const btnOpen = tr("Abrir painel");
        const btnSnooze = tr("Silenciar 1h");
        const btnOff = tr("Desligar avisos");
        vscode.window
          .showWarningMessage(
            tr("Claude Usage — {0}", anomalyText(critAnomaly)),
            btnOpen,
            btnSnooze,
            btnOff
          )
          .then((choice) => {
            if (choice === btnOpen) {
              vscode.commands.executeCommand("claudeUsageBar.openPanel");
            } else if (choice === btnSnooze) {
              snoozeUntilMs = Date.now() + 60 * 60_000;
            } else if (choice === btnOff) {
              cfg().update(
                "anomalyNotifyEnabled",
                false,
                vscode.ConfigurationTarget.Global
              );
              render();
            }
          });
      }
    } else if (!critAnomaly) {
      lastAnomalyKey = "";
    }

    // Copiloto de cota: conselhos locais (advisor.ts) com histerese entre
    // renders. A notificação (só a de troca de modelo) é OPT-IN e tem cooldown
    // próprio, bem mais folgado que o dos alertas.
    let advice: Advice[] = [];
    if (cfg().get<boolean>("advisorEnabled") ?? true) {
      const hist = buildDashHistory();
      advice = evaluateAdvice(
        {
          fiveHourPct: fiveHour,
          sevenDayPct: sevenDay,
          sevenDaySonnet: usage?.sevenDaySonnet ?? null,
          sevenDayOpus: usage?.sevenDayOpus ?? null,
          blockTokens: block?.totalTokens ?? null,
          tokensPerMinute: block?.tokensPerMinute ?? null,
          remainingMinutes: block?.remainingMinutes ?? null,
          peak: hist?.peak
            ? { weekday: hist.peak.weekday, hour: hist.peak.hour }
            : null,
        },
        activeAdviceKeys
      );
      // Tier 1 domina: com o alerta de burn rate ativo, o "Cabem ~X até o reset"
      // vira ruído (o alerta já diz que vai ESTOURAR, e com a ação). Suprime pra
      // não ter duas vozes sobre cota lado a lado.
      if (alert.active) {
        advice = advice.filter((a) => a.key !== "fitsUntilReset");
      }
      // Metas de token (ROADMAP #16): opt-in (0 = desligado). Avaliadas aqui
      // (fora do advisor.ts) porque dependem de fontes locais (bloco/daily).
      const goal5h = cfg().get<number>("tokenGoalFiveHour") ?? 0;
      if (goal5h > 0 && block && block.totalTokens > goal5h) {
        advice.push({
          key: "tokenGoal5h",
          severity: "warn",
          title: tr("Meta de tokens da sessão estourada"),
          detail: tr(
            "{0} de {1} na janela de 5h.",
            fmtTokens(block.totalTokens),
            fmtTokens(goal5h)
          ),
          notify: false,
        });
      }
      const goalDaily = cfg().get<number>("tokenGoalDaily") ?? 0;
      if (goalDaily > 0) {
        const today = lastDaily.find((d) => d.date === todayKey());
        if (today && today.totalTokens > goalDaily) {
          advice.push({
            key: "tokenGoalDaily",
            severity: "warn",
            title: tr("Meta diária de tokens estourada"),
            detail: tr(
              "{0} de {1} hoje.",
              fmtTokens(today.totalTokens),
              fmtTokens(goalDaily)
            ),
            notify: false,
          });
        }
      }
      activeAdviceKeys = new Set(advice.map((a) => a.key));
      const notifiable = advice.find((a) => a.notify);
      if (
        notifiable &&
        (cfg().get<boolean>("advisorNotifyEnabled") ?? false) &&
        Date.now() >= snoozeUntilMs
      ) {
        const cooldownMs =
          (cfg().get<number>("advisorCooldownHours") ?? 6) * 3_600_000;
        if (
          notifiable.key !== lastAdviceKey ||
          Date.now() - lastAdviceNotifyAtMs > cooldownMs
        ) {
          lastAdviceKey = notifiable.key;
          lastAdviceNotifyAtMs = Date.now();
          const btnOpen = tr("Abrir painel");
          const btnSnooze = tr("Silenciar hoje");
          vscode.window
            .showInformationMessage(
              `${notifiable.title} — ${notifiable.detail}`,
              btnOpen,
              btnSnooze
            )
            .then((choice) => {
              if (choice === btnOpen) {
                vscode.commands.executeCommand("claudeUsageBar.openPanel");
              } else if (choice === btnSnooze) {
                snoozeUntilMs = Date.now() + 24 * 3_600_000;
              }
            });
        }
      }
    } else {
      activeAdviceKeys = new Set();
    }

    // Modelo atual: statusline fresca > transcript > ccusage (último do bloco).
    const modelName =
      (fresh && s?.model) || currentModel || block?.model || null;

    // Anomalias (uma passada): a CRÍTICA sobe pro banner (Tier 1, junto do burn
    // rate); as ⚠ warn vão pro Copiloto no webview (Tier 2); as dicas cobertas
    // somem (Tier 3, via suppressCoveredTips no `tips` abaixo).
    const anomalyList = currentAnomalies();
    const critForBanner = anomalyList.find((a) => a.level === "crit");
    const alertOut: AlertResult = critForBanner
      ? alert.active
        ? { ...alert, reasons: [...alert.reasons, anomalyText(critForBanner)] }
        : {
            active: true,
            message: anomalyText(critForBanner),
            reasons: [anomalyText(critForBanner)],
            key: "anomaly:" + critForBanner.id,
          }
      : alert;

    const summary = costSummary();
    const view = {
      mode: mode === "plan" ? ("plan" as const) : ("api" as const),
      usingCcusage: mode !== "plan" && !!block,
      ringPct,
      centerLabel,
      centerSub,
      level,
      fiveHour,
      sevenDay,
      sevenDaySonnet: usage?.sevenDaySonnet ?? null,
      sevenDayOpus: usage?.sevenDayOpus ?? null,
      extraUsage: usage?.extraUsage?.enabled ? usage.extraUsage : null,
      ctxPct,
      cost,
      costCap,
      isSub,
      block,
      state: s,
      alert: alertOut,
      alertEnabled: alertOn,
      advice,
      projPct,
      etaMin,
      tokenCap,
      fiveHourResetMs,
      sevenDayResetMs,
      daily: lastDaily,
      modelName,
      today: summary.today,
      monthToDate: summary.monthToDate,
      monthProjected: summary.monthProjected,
      monthlyBudgetUsd: monthlyBudget,
      stats: lastStats,
      tips: lastStats
        ? suppressCoveredTips(anomalyList, computeTips(lastStats, tipThresholds()))
        : [],
      anomalies: anomalyList.map((a) => ({ level: a.level, text: anomalyText(a) })),
      costWindow: costWindowValue,
    };
    item.tooltip = buildTooltip(view);
    writeExport(view);

    const panelData = buildPanelData(view);
    const barStyle = c.get<BarStyle>("barStyle") ?? "ring";
    viewProvider.update(panelData, barStyle);
    // Atualiza o dashboard de analytics (aba do editor), quando aberto.
    if (DashboardPanel.current) {
      DashboardPanel.current.update(buildDashboardData());
    }
  };

  type View = {
    mode: "plan" | "api";
    usingCcusage: boolean;
    ringPct: number | null;
    centerLabel: string;
    centerSub: string;
    level: "ok" | "warn" | "err";
    fiveHour: number | null;
    sevenDay: number | null;
    /** Janelas 7d dedicadas por modelo (oauth) — null quando o plano não tem. */
    sevenDaySonnet: { utilization: number; resetsAt: number | null } | null;
    sevenDayOpus: { utilization: number; resetsAt: number | null } | null;
    /** Créditos extras (oauth) — null quando desabilitado/ausente. */
    extraUsage: {
      enabled: boolean;
      utilization: number;
      usedCredits: number;
      monthlyLimit: number;
      currency: string;
    } | null;
    ctxPct: number | null;
    cost: number;
    costCap: number;
    isSub: boolean;
    block: CcusageData | null;
    state: UsageState | null;
    alert: AlertResult;
    alertEnabled: boolean;
    advice: Advice[];
    projPct: number | null;
    etaMin: number | null;
    tokenCap: number;
    fiveHourResetMs: number | null;
    sevenDayResetMs: number | null;
    daily: CcusageDaily[];
    modelName: string | null;
    today: number;
    monthToDate: number;
    monthProjected: number;
    monthlyBudgetUsd: number;
    stats: TranscriptStats | null;
    tips: Tip[];
    anomalies: { level: "crit" | "warn" | "info"; text: string }[];
    costWindow: "5h" | "today" | "7d" | "30d";
  };

  // Card de hover: rate limits + uso/tokens/modelos da janela ativa + link.
  // Setting tooltipDetail="compact" volta ao tooltip enxuto (só rate limits).
  const buildTooltip = (v: View): vscode.MarkdownString => {
    const bar = (x: number | null) => {
      if (x == null) {
        return "";
      }
      const filled = Math.round((Math.min(100, x) / 100) * 10);
      return " `" + "█".repeat(filled) + "░".repeat(10 - filled) + "`";
    };

    // Modo compacto (setting): volta ao tooltip enxuto (só rate limits + link).
    const compact =
      (cfg().get<string>("tooltipDetail") ?? "full") === "compact";
    // Rótulo da janela ativa (espelha panel.ts windowSelector): today→"Hoje",
    // senão o token cru (5h/7d/30d).
    const winLabel = (w: View["costWindow"]) =>
      w === "today" ? tr("Hoje") : w;

    const lines: string[] = [];

    // ── A. Rate limits (sempre) ───────────────────────────────────────────
    if (v.mode === "plan") {
      const pct = v.fiveHour != null ? `${Math.round(v.fiveHour)}%` : "—";
      // Reset: prefere o oauth (MESMA fonte do anel) e só cai pra statusline se
      // não houver. Sem isso, com a statusline velha o tooltip mostrava
      // "reseta em 0m" enquanto o painel mostrava o reset real do oauth.
      const resetSec =
        v.fiveHourResetMs != null
          ? Math.floor(v.fiveHourResetMs / 1000)
          : v.state?.five_hour?.resets_at ?? null;
      const reset = resetSec
        ? " · " + tr("reseta {0}", fmtResetsAt(resetSec))
        : "";
      lines.push(
        tr("**Sessão 5h:** {0}", `${pct}${bar(v.fiveHour)}${reset}`)
      );
      if (v.sevenDay != null) {
        const reset7 = v.sevenDayResetMs
          ? " · " +
            tr("reseta em {0}", fmtDuration(v.sevenDayResetMs - Date.now()))
          : "";
        lines.push(
          tr(
            "**Semana 7d:** {0}",
            `${Math.round(v.sevenDay)}%${bar(v.sevenDay)}${reset7}`
          )
        );
      }
      // Janelas 7d dedicadas por modelo (oauth). Nome de modelo não traduz.
      const modelWin = (label: string, w: View["sevenDaySonnet"]) => {
        if (!w) {
          return;
        }
        const reset = w.resetsAt
          ? " · " + tr("reseta em {0}", fmtDuration(w.resetsAt - Date.now()))
          : "";
        lines.push(
          `**${label} (7d):** ${Math.round(w.utilization)}%${bar(
            w.utilization
          )}${reset}`
        );
      };
      modelWin("Sonnet", v.sevenDaySonnet);
      modelWin("Opus", v.sevenDayOpus);
    } else if (v.block) {
      const b = v.block;
      lines.push(
        tr(
          "**Sessão 5h:** {0}% do tempo{1} · reseta em {2}",
          Math.round(b.timePct),
          bar(b.timePct),
          fmtDuration(b.remainingMinutes * 60000)
        )
      );
    } else {
      lines.push(tr("Sem dados da sessão ainda."));
    }

    // Alerta / projeção — só quando ativo (linha curta).
    if (v.alert.active) {
      const eta =
        v.etaMin != null
          ? tr(" · estoura em ~{0}", fmtDuration(v.etaMin * 60000))
          : "";
      lines.push(`$(warning) **${v.alert.message}**${eta}`);
    } else if (v.projPct != null && v.projPct >= 60) {
      const eta =
        v.etaMin != null
          ? ` · ~${fmtDuration(v.etaMin * 60000)}`
          : "";
      lines.push(
        tr("↗ ritmo projeta ~{0}%{1}", Math.round(v.projPct), eta)
      );
    }

    if (!compact) {
      const s = v.stats;

      // ── B. Uso (janela ativa) ───────────────────────────────────────────
      lines.push("**" + tr("Uso") + " (" + winLabel(v.costWindow) + ")**");
      const usoLines: string[] = [];
      if (s) {
        usoLines.push(
          tr("Custo") + ": " + fmtUsd(s.totalCostUSD) +
            " · " + tr("Mensagens") + ": " + s.turns +
            " · " + tr("Tokens") + ": " + fmtTokens(s.totalTokens)
        );
      }
      usoLines.push(
        tr("Hoje") + ": " + fmtUsd(v.today) +
          " · " + tr("Mês") + ": " + fmtUsd(v.monthToDate)
      );
      lines.push(usoLines.join("\n\n"));

      // ── C. Quebra de tokens (tabela GFM) ────────────────────────────────
      if (s && s.totalTokens > 0) {
        const tb = tokenBreakdown(s.tokenTotals);
        const head =
          "| " + tr("Tipo") + " | " + tr("Tokens") + " | % |  |\n" +
          "|:--|--:|--:|:--|";
        const rows = tb.rows
          .map(
            (r) =>
              "| " + r.label + " | " + fmtTokens(r.count) + " | " +
              Math.round(r.pct) + "% |" + bar(r.pct) + " |"
          )
          .join("\n");
        lines.push("**" + tr("Tokens") + "**\n\n" + head + "\n" + rows);
        lines.push(tr("Cache hit") + ": " + Math.round(tb.cacheHitPct) + "%");
      }

      // ── D. Por modelo (top 3) ───────────────────────────────────────────
      if (s && s.byModel.length) {
        const top = s.byModel.slice(0, 3);
        const head =
          "| " + tr("Modelos") + " | " + tr("Custo") + " | Msgs |  |\n" +
          "|:--|--:|--:|:--|";
        const rows = top
          .map((m) => {
            const share =
              s.totalCostUSD > 0 ? (m.costUSD / s.totalCostUSD) * 100 : 0;
            return (
              "| " + m.model + " | " + fmtUsd(m.costUSD) + " | " +
              m.messages + " |" + bar(share) + " |"
            );
          })
          .join("\n");
        lines.push(head + "\n" + rows);
        if (s.byModel.length > 3) {
          lines.push(tr("+{0} mais", s.byModel.length - 3));
        }
      }

      // Insights off: sem stats locais — dica pra ativar.
      if (!s) {
        lines.push(tr("Ative a análise local p/ ver tokens e modelos"));
      }
    }

    // Footer — link clicável para o painel completo.
    lines.push(
      tr(
        "[$(graph) Abrir painel](command:claudeUsageBar.openPanel) · _detalhes completos_"
      )
    );

    const md = new vscode.MarkdownString(lines.join("\n\n"));
    md.isTrusted = true;
    md.supportThemeIcons = true;
    return md;
  };

  const buildPanelData = (v: View): PanelData => {
    const rows: PanelData["rows"] = [];
    if (v.mode === "plan") {
      const s = v.state;
      // Reset real (oauth) tem prioridade sobre o da statusline (só p/ a 7d aqui;
      // o reset da 5h já aparece no grifo).
      const reset7 = v.sevenDayResetMs
        ? " · " +
          tr(
            "reseta em {0}",
            fmtDuration(v.sevenDayResetMs - Date.now())
          )
        : s?.seven_day?.resets_at
        ? " · " + tr("reseta {0}", fmtResetsAt(s.seven_day.resets_at))
        : "";
      // Barra "de uso" = COTA real (mesmo % do anel/grifo). Mostra % + tokens.
      // O reset não vai aqui — já aparece no grifo acima.
      const usoPct = v.fiveHour != null ? `${Math.round(v.fiveHour)}%` : "—";
      const usoTok = v.block
        ? " · " + tr("{0} tokens", fmtTokens(v.block.totalTokens))
        : "";
      rows.push({
        label: tr("Uso de tokens da sessão"),
        value: `${usoPct}${usoTok}`,
        pct: v.fiveHour, // barra colore pela cota
      });
      // Barra de TEMPO da sessão: calculada pela janela REAL (reset do oauth),
      // não pelo bloco fixo do ccusage — senão diverge logo após o reset.
      const timePct = sessionTimePct(v.fiveHourResetMs, v.block);
      if (timePct != null) {
        rows.push({
          label: tr("Tempo da sessão 5h"),
          value: tr("{0}% do tempo", Math.round(timePct)),
          pct: timePct,
        });
      }
      rows.push({
        label: `${tr("Semana (7d)")}${reset7}`,
        value: v.sevenDay != null ? `${Math.round(v.sevenDay)}%` : "—",
        pct: v.sevenDay,
      });
      // Cotas 7d dedicadas por modelo (oauth). Só aparecem quando o plano as
      // tem (ex.: Opus é null no Pro). Nome de modelo não traduz.
      const modelRow = (
        label: string,
        w: { utilization: number; resetsAt: number | null } | null
      ) => {
        if (!w) {
          return;
        }
        const reset = w.resetsAt
          ? " · " + tr("reseta em {0}", fmtDuration(w.resetsAt - Date.now()))
          : "";
        rows.push({
          label: `${label} (7d)${reset}`,
          value: `${Math.round(w.utilization)}%`,
          pct: w.utilization,
        });
      };
      modelRow("Sonnet", v.sevenDaySonnet);
      modelRow("Opus", v.sevenDayOpus);
    } else if (v.block) {
      const b = v.block;
      rows.push({
        label: tr(
          "Sessão 5h · reseta em {0}",
          fmtDuration(b.remainingMinutes * 60000)
        ),
        value: tr("{0}% do tempo", Math.round(b.timePct)),
        pct: b.timePct,
      });
      if (v.isSub) {
        // Assinatura: $ é só referência; sem teto/barra/cor.
        rows.push({
          label: tr("Equivalente API (sua assinatura cobre)"),
          value: `~${fmtUsd(b.costUSD)}`,
          pct: null,
        });
      } else {
        const capPct =
          v.costCap > 0 ? Math.min(100, (b.costUSD / v.costCap) * 100) : null;
        rows.push({
          label:
            v.costCap > 0
              ? tr("Custo / teto {0}", fmtUsd(v.costCap))
              : tr("Custo"),
          value: fmtUsd(b.costUSD),
          pct: capPct,
        });
        if (b.burnCostPerHour != null) {
          rows.push({
            label: tr("Ritmo (projeção do bloco)"),
            value: `${fmtUsd(b.burnCostPerHour)}/h → ${fmtUsd(
              b.projectedCost ?? undefined
            )}`,
            pct: null,
          });
        }
      }
      rows.push({
        label: tr("Tokens no bloco"),
        value: fmtTokens(b.totalTokens),
        pct: null,
      });
    }

    if (v.ctxPct != null) {
      rows.push({
        label: tr("Contexto"),
        value: `${Math.round(v.ctxPct)}%`,
        pct: v.ctxPct,
      });
    }
    // Metas de token (ROADMAP #16): barras de progresso opt-in (0 = sem meta).
    const goalRow5h = cfg().get<number>("tokenGoalFiveHour") ?? 0;
    if (goalRow5h > 0 && v.block) {
      rows.push({
        label: tr("Meta de tokens (5h)"),
        value: `${fmtTokens(v.block.totalTokens)} / ${fmtTokens(goalRow5h)}`,
        pct: Math.min(100, (v.block.totalTokens / goalRow5h) * 100),
      });
    }
    const goalRowDaily = cfg().get<number>("tokenGoalDaily") ?? 0;
    if (goalRowDaily > 0) {
      const todayDaily = v.daily.find((d) => d.date === todayKey());
      if (todayDaily) {
        rows.push({
          label: tr("Meta de tokens (hoje)"),
          value: `${fmtTokens(todayDaily.totalTokens)} / ${fmtTokens(
            goalRowDaily
          )}`,
          pct: Math.min(100, (todayDaily.totalTokens / goalRowDaily) * 100),
        });
      }
    }
    const model = prettyModel(v.modelName);
    if (model) {
      rows.push({ label: tr("Modelo"), value: model, pct: null });
    }

    // Fonte ativa, em ordem de prioridade: oauth/usage (cota real) >
    // statusline (plano, cota real) > ccusage (aproximado, % de tempo) > nada.
    const usageNow = oa();
    const slRate = stateIsFresh(v.state) && stateHasRate(v.state);
    const sourceKind: "oauth" | "statusline" | "ccusage" | "none" = usageNow
      ? "oauth"
      : slRate
      ? "statusline"
      : v.block
      ? "ccusage"
      : "none";
    const src = {
      oauth: "oauth/usage",
      statusline: tr("statusline (plano)"),
      ccusage: tr("ccusage (≈ tempo)"),
      none: "—",
    }[sourceKind];
    const sourceActiveLabel = {
      oauth: tr("oauth/usage — cota real"),
      statusline: tr("statusline (plano) — cota real"),
      ccusage: tr("ccusage — aproximado (% de tempo, sem cota real)"),
      none: tr("sem dados"),
    }[sourceKind];
    // Enquanto o oauth em cache ainda é a fonte EXIBIDA (usageNow != null), o
    // diagnóstico mostra "ok ✓" — um 429 transitório de revalidação em segundo
    // plano (que o cache absorve) não deve piscar "indisponível" e assustar.
    // Só mostra o motivo quando o oauth realmente deixou de ser a fonte ativa.
    const sourceOAuthLine =
      lastOAuthStatus.ok || usageNow != null
        ? tr("oauth/usage: ok ✓ (cota real)")
        : tr(
            "oauth/usage: indisponível — {0}",
            localizeOAuthReason(lastOAuthStatus.reason) ?? "—"
          );
    const sourceStatuslineLine = slRate
      ? tr("statusline: dados frescos ✓")
      : tr("statusline: sem dados frescos");
    // Últimos ~7 dias pro sparkline: só o que o gráfico precisa (data + tokens).
    const daily = v.daily.slice(-7).map((d) => ({
      date: d.date,
      tokens: d.totalTokens,
      costUSD: d.costUSD,
    }));
    return {
      mode: v.mode,
      ringPct: v.ringPct,
      centerLabel: v.centerLabel,
      centerSub: v.centerSub,
      level: v.level,
      // Cor do tema do anel/barras (claude/mono/custom); null = semáforo normal.
      ringColorOverride: resolveRingColorOverride(),
      rows,
      // Créditos extras (oauth) — card na aba Sessão quando habilitado na conta.
      extraUsage: v.extraUsage,
      // Conselhos do copiloto (sem o flag notify — o webview só exibe).
      advice: v.advice.map((a) => ({
        key: a.key,
        severity: a.severity,
        title: a.title,
        detail: a.detail,
      })),
      alert: v.alert.active
        ? {
            message: v.alert.message,
            reasons: v.alert.reasons,
            // Projeção = warning (amarelo); estouro já consumado = erro (vermelho).
            severity: (
              Math.max(v.fiveHour ?? 0, v.sevenDay ?? 0) >=
              (cfg().get<number>("errorThreshold") ?? 85)
            )
              ? ("err" as const)
              : ("warn" as const),
          }
        : null,
      alertEnabled: v.alertEnabled,
      source: {
        kind: sourceKind,
        approximate: sourceKind === "ccusage",
        activeLabel: sourceActiveLabel,
        oauthLine: sourceOAuthLine,
        statuslineLine: sourceStatuslineLine,
      },
      daily,
      // Custos (≈ aproximado): hoje/mês do ccusage + quebras da tabela local.
      cost: {
        isSub: v.isSub,
        today: v.today,
        monthToDate: v.monthToDate,
        monthProjected: v.monthProjected,
        budgetUsd: v.monthlyBudgetUsd,
        overBudget:
          v.monthlyBudgetUsd > 0 && v.monthToDate >= v.monthlyBudgetUsd,
        byModel: v.stats
          ? v.stats.byModel.map((m) => ({
              model: m.model,
              tokens: m.tokens,
              costUSD: m.costUSD,
            }))
          : [],
        byProject: v.stats
          ? v.stats.byProject.map((p) => ({
              project: p.project,
              tokens: p.tokens,
              costUSD: p.costUSD,
            }))
          : [],
        byContextBucket: v.stats
          ? v.stats.byContextBucket.map((b) => ({
              bucket: b.bucket,
              tokens: b.tokens,
              costUSD: b.costUSD,
              turns: b.turns,
            }))
          : [],
        byMcpServer: v.stats ? v.stats.byMcpServer : [],
        bySubagent: v.stats ? v.stats.bySubagent : [],
        tips: v.tips,
        anomalies: v.anomalies,
        tableVersion: v.stats ? v.stats.tableVersion : null,
        window: v.costWindow,
        insightsEnabled: cfg().get<boolean>("insightsEnabled") ?? true,
      },
      settings: collectSettings(),
      // Estado do consentimento do token OAuth (globalState, não é setting).
      oauthConsent: oauthConsent() ?? "unset",
      // Idioma atual (globalState) — p/ marcar a bandeira ativa no card de Idioma.
      lang: context.globalState.get<string>("language") || "auto",
      // Caminho/comando efetivo p/ exibir como placeholder quando o campo está
      // vazio — deixa claro o que será usado por padrão (vazio = "auto").
      placeholders: {
        stateFilePath: resolveStatePath(),
        exportStatePath: resolveExportPath(),
        ccusageCommand: "npx -y ccusage@latest blocks --active --json",
      },
      // Créditos discretos no rodapé da aba Sessão (versão + link do repo).
      credits: {
        version:
          (context.extension &&
            context.extension.packageJSON &&
            context.extension.packageJSON.version) ||
          "",
      },
      status: (() => {
        const s = st();
        if (!s) {
          return null;
        }
        return {
          indicator: s.indicator,
          description: s.description,
          components: s.components,
          incidents: s.incidents.map((i) => ({
            name: i.name,
            impact: i.impact,
            status: i.status,
            createdAt: i.createdAt,
            updatedAt: i.updatedAt,
            shortlink: i.shortlink,
            lastUpdate: i.lastUpdate,
          })),
          recent: s.recent,
        };
      })(),
      updatedAtMs: lastUpdateMs || null,
      footer:
        tr("fonte: {0}", src) +
        (v.state?.ts
          ? " · " + tr("statusline {0}", fmtAgo(v.state.ts))
          : ""),
    };
  };

  // Defaults de boas práticas — usados quando o setting ainda não está
  // registrado (ex.: logo após instalar a extensão, antes de recarregar a
  // janela, o `get()` volta undefined e o campo apareceria vazio). Mantém a aba
  // Config sempre preenchida com os valores recomendados.
  const SETTING_DEFAULTS: Record<string, unknown> = {
    ringTheme: "semaforo", ringColor: "#4caf78", barStyle: "ring",
    statusBarValue: "quota", alignment: "right", priority: 100,
    useOAuthUsage: true, oauthRefreshSeconds: 60, ccusageRefreshSeconds: 60,
    staleAfterSeconds: 900, accountType: "auto", mode: "auto", costCapUsd: 5,
    monthlyBudgetUsd: 0, monthlyBudgetAlertEnabled: true, insightsEnabled: true,
    language: "auto", costWindow: "5h", tipsContextBigPct: 25, tipsCacheReadPct: 70,
    tipsOpusPct: 70, tipsMcpCalls: 40, tipsSubagentPct: 40,
    anomalyDetectionEnabled: true, anomalyNotifyEnabled: false,
    anomalyCacheHitMinPct: 50, anomalyMcpCallsMax: 60,
    anomalyCtxInflatedTurns: 3, anomalyToolLoopK: 5, sessionTokenCap: 0,
    intenseTokensPerMin: 50000, burnRateAlertEnabled: true, burnRateMaxPerHour: 20,
    alertCooldownMinutes: 15, colorByProjection: true, resetWarningMinutes: 10,
    blockSummaryEnabled: true, warnThreshold: 60, errorThreshold: 85,
    lowQuotaThreshold: 15, statusCheckEnabled: true, statusBadgeEnabled: true,
    statusNotifyEnabled: true, statusRefreshSeconds: 300, exportStateEnabled: true,
    tooltipDetail: "full",
    advisorEnabled: true, advisorNotifyEnabled: false, advisorCooldownHours: 6,
    tokenGoalFiveHour: 0, tokenGoalDaily: 0,
    historyEnabled: true, historyRetentionDays: 365, weeklySummaryEnabled: false,
  };

  // Coleta os valores atuais dos settings p/ preencher a aba Config.
  const collectSettings = (): Record<string, unknown> => {
    const keys = [
      "ringTheme", "ringColor", "barStyle", "statusBarValue", "alignment",
      "priority", "useOAuthUsage", "oauthRefreshSeconds", "ccusageCommand",
      "ccusageRefreshSeconds", "stateFilePath", "staleAfterSeconds",
      "accountType", "mode", "costCapUsd", "monthlyBudgetUsd",
      "monthlyBudgetAlertEnabled", "insightsEnabled", "costWindow",
      "tipsContextBigPct", "tipsCacheReadPct", "tipsOpusPct", "tipsMcpCalls",
      "tipsSubagentPct",
      "anomalyDetectionEnabled", "anomalyNotifyEnabled", "anomalyCacheHitMinPct",
      "anomalyMcpCallsMax", "anomalyCtxInflatedTurns", "anomalyToolLoopK",
      "sessionTokenCap",
      "intenseTokensPerMin", "burnRateAlertEnabled", "burnRateMaxPerHour",
      "alertCooldownMinutes", "colorByProjection", "resetWarningMinutes",
      "blockSummaryEnabled", "warnThreshold", "errorThreshold",
      "lowQuotaThreshold",
      "statusCheckEnabled", "statusBadgeEnabled", "statusNotifyEnabled",
      "statusRefreshSeconds", "exportStateEnabled", "exportStatePath",
      "advisorEnabled", "advisorNotifyEnabled", "advisorCooldownHours",
      "tokenGoalFiveHour", "tokenGoalDaily",
      "historyEnabled", "historyRetentionDays", "weeklySummaryEnabled",
    ];
    const c = cfg();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = c.get(k);
      // Setting ainda não registrado (logo após instalar) → cai no default de
      // boas práticas em vez de exibir vazio na aba Config.
      out[k] = v === undefined || v === null ? SETTING_DEFAULTS[k] : v;
    }
    return out;
  };

  const startWatch = () => {
    if (watcher) {
      watcher.close();
      watcher = undefined;
    }
    const p = resolveStatePath();
    const dir = path.dirname(p);
    const base = path.basename(p);
    try {
      watcher = fs.watch(dir, (_event, filename) => {
        if (!filename || filename === base || filename === base + ".tmp") {
          if (debounce) {
            clearTimeout(debounce);
          }
          debounce = setTimeout(readState, 150);
        }
      });
      context.subscriptions.push({ dispose: () => watcher?.close() });
    } catch {
      // diretório pode não existir; ticks cobrem
    }
  };

  // Comandos
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeUsageBar.refresh", () => {
      refreshAll();
    }),
    vscode.commands.registerCommand("claudeUsageBar.toggleAlert", async () => {
      const cur = cfg().get<boolean>("burnRateAlertEnabled") ?? true;
      const next = !cur;
      await cfg().update(
        "burnRateAlertEnabled",
        next,
        vscode.ConfigurationTarget.Global
      );
      render();
      // Feedback claro e visível (não só a mensagem fugaz da status bar).
      vscode.window.showInformationMessage(
        next
          ? tr("Claude Usage: alerta de burn rate LIGADO 🔔.")
          : tr("Claude Usage: alerta de burn rate DESLIGADO 🔕.")
      );
    }),
    vscode.commands.registerCommand("claudeUsageBar.openState", async () => {
      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(resolveStatePath())
        );
        await vscode.window.showTextDocument(doc);
      } catch {
        vscode.window.showInformationMessage(
          tr(
            "Arquivo de estado da statusline ainda não existe (só é gravado ao usar o Claude Code no terminal)."
          )
        );
      }
    }),
    vscode.commands.registerCommand("claudeUsageBar.cycleStyle", async () => {
      const order: BarStyle[] = ["ring", "bar", "number", "icon"];
      const cur = (cfg().get<BarStyle>("barStyle") ?? "ring") as BarStyle;
      const next = order[(order.indexOf(cur) + 1) % order.length];
      await cfg().update("barStyle", next, vscode.ConfigurationTarget.Global);
      render();
    }),
    vscode.commands.registerCommand("claudeUsageBar.setStyle", async (style?: string) => {
      const valid: BarStyle[] = ["ring", "bar", "number", "icon"];
      if (style && (valid as string[]).includes(style)) {
        await cfg().update(
          "barStyle",
          style,
          vscode.ConfigurationTarget.Global
        );
        render();
      }
    }),
    // Janela das quebras de custo (botões da aba Custos). Atualiza o valor de
    // runtime AUTORITATIVO na hora (recalcula + renderiza) e SÓ então persiste no
    // setting — assim a troca vale mesmo se config.update falhar/atrasar (foi o
    // que quebrou o idioma). Sem isto, as quebras ficavam presas em "5h".
    vscode.commands.registerCommand(
      "claudeUsageBar.setCostWindow",
      async (win?: string) => {
        const valid: CostWindow[] = ["5h", "today", "7d", "30d"];
        const v = (valid as string[]).includes(win as string)
          ? (win as CostWindow)
          : "5h";
        costWindowValue = v;
        refreshStats(); // re-walk na nova janela + render (não espera o setting)
        // Persiste pra refletir nas Settings e sobreviver ao reload (best-effort).
        try {
          await cfg().update("costWindow", v, vscode.ConfigurationTarget.Global);
        } catch {
          // setting pode não estar registrado (vsix instalado sobre janela viva);
          // o valor de runtime já garante o comportamento nesta sessão.
        }
      }
    ),
    vscode.commands.registerCommand("claudeUsageBar.openPanel", () => {
      viewProvider.reveal();
      render();
      refreshAll();
    }),
    // Abre (ou revela) o dashboard numa aba do editor: todas as seções num grid.
    vscode.commands.registerCommand("claudeUsageBar.openDashboard", () => {
      const dash = DashboardPanel.createOrShow();
      dash.onReady = refreshAll;
      render();
      refreshAll();
    }),
    // Troca a janela do dashboard (Hoje/Semana/Mês/Tudo) e re-renderiza.
    vscode.commands.registerCommand(
      "claudeUsageBar.setDashboardWindow",
      (value?: string) => {
        const valid = ["today", "week", "month", "all"];
        const v = (valid.includes(value as string) ? value : "today") as DashWindow;
        dashboardWindowValue = v;
        cfg().update("dashboardWindow", v, vscode.ConfigurationTarget.Global);
        DashboardPanel.current?.update(buildDashboardData());
      }
    ),
    // Exporta o dashboard como .html autocontido (snapshot dos dados atuais).
    vscode.commands.registerCommand(
      "claudeUsageBar.exportDashboardHtml",
      async () => {
        const data = buildDashboardData();
        const html = exportDashboardHtml(data, new Date().toLocaleString());
        const defaultUri = vscode.Uri.file(
          path.join(os.homedir(), "claude-usage-dashboard.html")
        );
        const uri = await vscode.window.showSaveDialog({
          defaultUri,
          saveLabel: tr("Exportar HTML"),
          filters: { HTML: ["html"] },
        });
        if (!uri) {
          return;
        }
        try {
          fs.writeFileSync(uri.fsPath, html, "utf8");
        } catch (e) {
          vscode.window.showErrorMessage(
            tr("Falha ao exportar: {0}", String((e as Error)?.message ?? e))
          );
          return;
        }
        const open = await vscode.window.showInformationMessage(
          tr("Dashboard exportado."),
          tr("Abrir no navegador")
        );
        if (open) {
          vscode.env.openExternal(uri);
        }
      }
    ),
    // Exporta um breakdown da janela do dashboard em CSV (dados locais, já
    // agregados pelo transcriptStats — nenhuma chamada externa).
    vscode.commands.registerCommand("claudeUsageBar.exportCsv", async () => {
      const w = dashboardWindowValue;
      const s = readTranscriptStats(dashWindowStart(w));
      const usd = (n: number) => n.toFixed(4);
      const cell = (v: string | number): string => {
        const t = String(v);
        return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      const toCsv = (
        header: string[],
        rows: (string | number)[][]
      ): string =>
        [header, ...rows]
          .map((r) => r.map(cell).join(","))
          .join("\n") + "\n";
      const dims: { label: string; id: string; csv: () => string }[] = [
        {
          id: "by-model",
          label: tr("Por modelo"),
          csv: () =>
            toCsv(
              ["model", "tokens", "input", "output", "cache_read",
                "cache_write", "messages", "cost_usd_approx"],
              s.byModel.map((m) => [m.model, m.tokens, m.input, m.output,
                m.cacheRead, m.cacheWrite, m.messages, usd(m.costUSD)])
            ),
        },
        {
          id: "by-project",
          label: tr("Por projeto"),
          csv: () =>
            toCsv(
              ["project", "tokens", "cost_usd_approx"],
              s.byProject.map((p) => [p.project, p.tokens, usd(p.costUSD)])
            ),
        },
        {
          id: "by-day",
          label: tr("Por dia"),
          csv: () =>
            toCsv(
              ["date", "tokens", "input", "output", "cache_read",
                "cache_write", "messages", "cost_usd_approx"],
              s.byDay.map((d) => [d.date, d.tokens, d.input, d.output,
                d.cacheRead, d.cacheWrite, d.messages, usd(d.costUSD)])
            ),
        },
        {
          id: "by-session",
          label: tr("Por sessão"),
          csv: () =>
            toCsv(
              ["session", "project", "tokens", "messages",
                "duration_minutes", "cost_usd_approx"],
              s.bySession.map((x) => [x.session, x.project, x.tokens,
                x.messages,
                Math.max(0, Math.round((x.lastTs - x.firstTs) / 60000)),
                usd(x.costUSD)])
            ),
        },
        {
          id: "by-context",
          label: tr("Por tamanho de contexto"),
          csv: () =>
            toCsv(
              ["bucket", "tokens", "turns", "cost_usd_approx"],
              s.byContextBucket.map((b) => [b.bucket, b.tokens, b.turns,
                usd(b.costUSD)])
            ),
        },
      ];
      if (s.totalTokens <= 0 && s.turns <= 0) {
        vscode.window.showInformationMessage(tr("Sem dados de custo ainda."));
        return;
      }
      const pick = await vscode.window.showQuickPick(
        dims.map((d) => ({ label: d.label, id: d.id })),
        { placeHolder: tr("O que exportar?") }
      );
      if (!pick) {
        return;
      }
      const dim = dims.find((d) => d.id === (pick as { id: string }).id)!;
      const defaultUri = vscode.Uri.file(
        path.join(os.homedir(), `claude-usage-${dim.id}-${w}.csv`)
      );
      const uri = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: tr("Exportar CSV"),
        filters: { CSV: ["csv"] },
      });
      if (!uri) {
        return;
      }
      try {
        fs.writeFileSync(uri.fsPath, dim.csv(), "utf8");
      } catch (e) {
        vscode.window.showErrorMessage(
          tr("Falha ao exportar: {0}", String((e as Error)?.message ?? e))
        );
        return;
      }
      const open = await vscode.window.showInformationMessage(
        tr("CSV exportado."),
        tr("Abrir")
      );
      if (open) {
        vscode.env.openExternal(uri);
      }
    }),
    // AI advice (LLM, BYO key) — relatório de coaching em Markdown.
    vscode.commands.registerCommand("claudeUsageBar.aiAdvice", () =>
      runAiAdvice(context, buildDashboardData())
    ),
    vscode.commands.registerCommand("claudeUsageBar.setAiAdviceKey", () =>
      setAiAdviceKey(context)
    ),
    // Reabre o diálogo de consentimento do token OAuth (conceder/revogar).
    vscode.commands.registerCommand("claudeUsageBar.oauthConsent", () =>
      requestOauthConsent(true)
    ),
    // Troca o idioma do plugin (acionado pelas bandeiras no painel). Persiste no
    // globalState (sempre gravável), re-renderiza e remonta o webview (o
    // dicionário traduzido `L` é injetado no HTML).
    vscode.commands.registerCommand(
      "claudeUsageBar.setLanguage",
      async (lang?: string) => {
        const valid = ["auto", "pt", "en", "es", "fr", "de"];
        const v = valid.includes(lang as string) ? (lang as string) : "auto";
        await context.globalState.update("language", v);
        setLang(v);
        render();
        viewProvider.rebuild();
        DashboardPanel.current?.rebuild();
      }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudeUsageBar")) {
        // alignment/priority não podem ser mutados após a criação → recria o item.
        const newAlign = readAlignment();
        const newPrio = cfg().get<number>("priority") ?? 100;
        if (newAlign !== curAlignment || newPrio !== curPriority) {
          curAlignment = newAlign;
          curPriority = newPrio;
          item.dispose();
          item = makeStatusItem();
        }
        startWatch();
        // Mudou a janela das quebras ou o gate de insights → recalcula as stats
        // (re-walk com a nova janela). Os limiares das dicas são reaplicados no
        // próximo render (computeTips lê os settings), então readState basta.
        // Editar o setting direto nas Settings também vale: re-sincroniza o valor
        // de runtime autoritativo a partir do setting antes de recalcular.
        if (e.affectsConfiguration("claudeUsageBar.costWindow")) {
          const w = cfg().get<string>("costWindow");
          costWindowValue =
            w === "today" || w === "7d" || w === "30d" ? w : "5h";
        }
        if (
          e.affectsConfiguration("claudeUsageBar.costWindow") ||
          e.affectsConfiguration("claudeUsageBar.insightsEnabled")
        ) {
          refreshStats();
        }
        readState();
      }
    })
  );

  // Ticks: statusline a cada 30s (resets frescos); ccusage no intervalo configurado.
  tick = setInterval(readState, 30_000);
  context.subscriptions.push({ dispose: () => tick && clearInterval(tick) });

  const ccInterval = Math.max(
    15,
    cfg().get<number>("ccusageRefreshSeconds") ?? 60
  );
  ccTick = setInterval(refreshCcusage, ccInterval * 1000);
  context.subscriptions.push({ dispose: () => ccTick && clearInterval(ccTick) });

  // Histórico diário: muda pouco ao longo do dia, então 5 min basta.
  dailyTick = setInterval(refreshDaily, 5 * 60 * 1000);
  context.subscriptions.push({
    dispose: () => dailyTick && clearInterval(dailyTick),
  });

  // oauth/usage: cota real do plano (fonte primária).
  const oauthInterval = Math.max(
    20,
    cfg().get<number>("oauthRefreshSeconds") ?? 60
  );
  oauthTick = setInterval(refreshOAuth, oauthInterval * 1000);
  context.subscriptions.push({
    dispose: () => oauthTick && clearInterval(oauthTick),
  });

  // Status da Anthropic: muda pouco, então intervalo bem folgado (default 5min).
  const statusInterval = Math.max(
    30,
    cfg().get<number>("statusRefreshSeconds") ?? 300
  );
  statusTick = setInterval(refreshStatus, statusInterval * 1000);
  context.subscriptions.push({
    dispose: () => statusTick && clearInterval(statusTick),
  });

  // Histórico persistente: tick de 15 min (janela curta de 2 dias — barata) +
  // backfill único ~15s após ativar (não compete com o burst de startup).
  historyTick = setInterval(() => recordHistory(2), 15 * 60 * 1000);
  context.subscriptions.push({
    dispose: () => historyTick && clearInterval(historyTick),
  });
  const backfillTimer = setTimeout(() => {
    recordHistory(90, true);
    recordHistory(2);
    maybeWeeklySummary();
  }, 15_000);
  context.subscriptions.push({ dispose: () => clearTimeout(backfillTimer) });

  startWatch();
  readState();
  refreshCcusage();
  refreshDaily();
  refreshOAuth();
  refreshStatus();

  // Consentimento do token OAuth: pergunta UMA vez (decisão ainda não tomada
  // e fonte oauth habilitada). Async — os refreshes acima já rodaram e o gate
  // em refreshOAuth garante que nada foi lido sem permissão.
  if (
    (cfg().get<boolean>("useOAuthUsage") ?? true) &&
    oauthConsent() === undefined
  ) {
    void requestOauthConsent(false);
  }
}

export function deactivate() {
  // disposables cuidam da limpeza
}
