import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UsageViewProvider, PanelData } from "./panel";
import {
  runCcusage,
  runCcusageDaily,
  CcusageResult,
  CcusageData,
  CcusageDaily,
} from "./ccusage";
import { evaluateAlerts, AlertResult } from "./alerts";
import { readCurrentModel, prettyModel } from "./transcript";

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
  return "em " + fmtDuration(epochSeconds * 1000 - Date.now());
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
 * Projeta a % de um limite (5h/7d) no momento do reset, assumindo ritmo linear
 * desde o início da janela. Retorna null se cedo demais pra estimar.
 */
function projectLimitPct(
  usedPct: number | null,
  resetsAtSec: number | null,
  windowSeconds: number
): number | null {
  if (usedPct == null || !resetsAtSec) {
    return null;
  }
  const remainingMs = resetsAtSec * 1000 - Date.now();
  if (remainingMs <= 0) {
    return usedPct;
  }
  const remainingSec = remainingMs / 1000;
  const elapsedSec = windowSeconds - remainingSec;
  // Exige >= 25% da janela decorrida: cedo demais, o ritmo é ruidoso e a
  // projeção linear vira alarmista (ex: 20% em 1h projetaria 100%).
  if (elapsedSec < windowSeconds * 0.25) {
    return null;
  }
  return usedPct + (usedPct / elapsedSec) * remainingSec;
}

/**
 * ETA (em minutos) até um limite percentual atingir 100%, no ritmo atual.
 * Retorna null se não dá pra estimar ou se NÃO estoura antes do reset.
 */
function etaToLimitMin(
  usedPct: number | null,
  resetsAtSec: number | null,
  windowSeconds: number
): number | null {
  if (usedPct == null || !resetsAtSec || usedPct >= 100) {
    return usedPct != null && usedPct >= 100 ? 0 : null;
  }
  const remainingMs = resetsAtSec * 1000 - Date.now();
  if (remainingMs <= 0) {
    return null;
  }
  const remainingSec = remainingMs / 1000;
  const elapsedSec = windowSeconds - remainingSec;
  if (elapsedSec < windowSeconds * 0.25) {
    return null; // cedo demais p/ taxa confiável
  }
  const ratePerSec = usedPct / elapsedSec; // %/s
  if (ratePerSec <= 0) {
    return null;
  }
  const secsToFull = (100 - usedPct) / ratePerSec;
  // Só interessa se estoura ANTES do reset.
  if (secsToFull >= remainingSec) {
    return null;
  }
  return Math.max(0, Math.round(secsToFull / 60));
}

function fmtAgo(ts: number | undefined): string {
  if (!ts) {
    return "—";
  }
  const sec = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (sec < 60) {
    return `há ${sec}s`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `há ${min}min`;
  }
  const h = Math.round(min / 60);
  return `há ${h}h`;
}

export function activate(context: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("claudeUsageBar");

  const alignment =
    cfg().get<string>("alignment") === "left"
      ? vscode.StatusBarAlignment.Left
      : vscode.StatusBarAlignment.Right;
  const priority = cfg().get<number>("priority") ?? 100;

  const item = vscode.window.createStatusBarItem(alignment, priority);
  item.command = "claudeUsageBar.openPanel";
  item.show();
  context.subscriptions.push(item);

  let lastState: UsageState | null = null;
  let lastCcusage: CcusageResult | null = null;
  // Modelo atual em uso (lido do transcript; o ccusage mistura modelos do bloco).
  let currentModel: string | null = null;
  // Histórico diário (sparkline). Atualizado num intervalo mais folgado.
  let lastDaily: CcusageDaily[] = [];
  let watcher: fs.FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let tick: NodeJS.Timeout | undefined;
  let ccTick: NodeJS.Timeout | undefined;
  let dailyTick: NodeJS.Timeout | undefined;
  // Alerta: controle de cooldown da notificação.
  let lastAlertKey = "";
  let lastAlertAtMs = 0;
  // Aviso de fim de janela (#8): endMs do bloco já avisado (1x por janela).
  let resetWarnedEndMs = 0;

  // View ancorada na Activity Bar (sidebar esquerda).
  const viewProvider = new UsageViewProvider();
  viewProvider.onReady = () => {
    readState();
    refreshCcusage();
    refreshDaily();
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      UsageViewProvider.viewType,
      viewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
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

  /** Considera a statusline "fresca" só se atualizada nos últimos N segundos. */
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
    // Modelo atual vem do transcript (o ccusage mistura modelos do bloco).
    const m = readCurrentModel();
    if (m) {
      currentModel = m;
    }
    render();
  };

  const refreshCcusage = async () => {
    const cmd =
      (cfg().get<string>("ccusageCommand") || "").trim() ||
      "npx -y ccusage@latest blocks --active --json";
    lastCcusage = await runCcusage(cmd);
    render();
  };

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

  const ctxPctOf = (s: UsageState | null): number | null => {
    if (!s) {
      return null;
    }
    return (
      s.context?.used_pct ??
      (s.context?.size && s.context.size > 0
        ? (((s.context.input ?? 0) + (s.context.output ?? 0)) /
            s.context.size) *
          100
        : null)
    );
  };

  const cc = (): CcusageData | null =>
    lastCcusage && lastCcusage.available ? lastCcusage : null;

  const render = () => {
    const c = cfg();
    const warn = c.get<number>("warnThreshold") ?? 60;
    const err = c.get<number>("errorThreshold") ?? 85;
    const staleAfter = c.get<number>("staleAfterSeconds") ?? 900;
    const costCap = c.get<number>("costCapUsd") ?? 5;
    const style = (c.get<BarStyle>("barStyle") ?? "ring") as BarStyle;

    const s = lastState;
    const block = cc();
    const fresh = stateIsFresh(s);
    const hasRate = fresh && stateHasRate(s);

    // Sem nenhuma fonte: placeholder.
    if (!hasRate && !block && !fresh) {
      item.text = "$(circle-outline) Claude —";
      const md = new vscode.MarkdownString(
        "**Claude Code Usage**\n\nSem dados ainda. A extensão usa o **ccusage** (uso da sessão de 5h, calculado dos transcripts) e, quando você roda o Claude Code no terminal, os limites **5h/7d** da statusline.\n\n_Rode `npx ccusage blocks --active` no terminal para testar a fonte._"
      );
      md.isTrusted = true;
      item.tooltip = md;
      item.color = new vscode.ThemeColor("disabledForeground");
      item.backgroundColor = undefined;
      return;
    }

    // Aviso de fim de janela (#8): notifica 1x quando faltar pouco pro reset 5h.
    const resetWarnMin = c.get<number>("resetWarningMinutes") ?? 10;
    if (resetWarnMin > 0 && block && block.remainingMinutes > 0) {
      const within = block.remainingMinutes <= resetWarnMin;
      if (within && resetWarnedEndMs !== block.endMs) {
        resetWarnedEndMs = block.endMs; // só uma vez por janela
        vscode.window.showInformationMessage(
          `Claude Usage — sua sessão de 5h reseta em ~${fmtDuration(
            block.remainingMinutes * 60000
          )}.`
        );
      }
    }

    const mode = effectiveMode(hasRate);
    const isSub = resolveAccountType() === "subscription";
    const fiveHour = s?.five_hour?.used_percentage ?? null;
    const sevenDay = s?.seven_day?.used_percentage ?? null;
    const ctxPct = ctxPctOf(s);
    // Custo: prefere o do bloco ccusage (real do bloco de 5h); senão statusline.
    const cost = block?.costUSD ?? s?.cost_usd ?? 0;
    // Em assinatura, o custo NÃO entra na cor (não é cobrança).
    const costPctForColor =
      !isSub && costCap > 0 ? Math.min(100, (cost / costCap) * 100) : 0;

    // Cor por projeção (pior dos dois): calcula a % projetada conforme o modo.
    const colorByProj = c.get<boolean>("colorByProjection") ?? true;
    const intenseTpm = c.get<number>("intenseTokensPerMin") ?? 50000;
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
        projPct = planProj;
      } else if (block) {
        // app: custo projetado (api) e/ou ritmo de tokens (assinatura).
        const costProjPct =
          !isSub && costCap > 0 && block.projectedCost != null
            ? (block.projectedCost / costCap) * 100
            : 0;
        const tokenIntensityPct =
          isSub && block.tokensPerMinute != null && intenseTpm > 0
            ? (block.tokensPerMinute / intenseTpm) * 100
            : 0;
        projPct = Math.max(costProjPct, tokenIntensityPct, planProj);
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

    let ringPct: number | null;
    let primary: string;
    let suffix: string;
    let centerLabel: string;
    let centerSub: string;
    let effective: number;

    if (mode === "plan") {
      // Assinante via statusline (terminal): % real do limite 5h + reset.
      ringPct = fiveHour;
      primary = fiveHour != null ? `${Math.round(fiveHour)}%` : "—";
      const resetShort = fmtResetsShort(s?.five_hour?.resets_at);
      suffix = resetShort ? ` · ${resetShort}` : "";
      centerLabel = primary;
      centerSub = resetShort
        ? `sessão 5h · reseta ${resetShort}`
        : "sessão · 5h";
      effective = Math.max(fiveHour ?? 0, sevenDay ?? 0, projForColor);
    } else if (block) {
      // App/IDE: ccusage. Herói = % de TEMPO da sessão de 5h + tempo restante.
      ringPct = block.timePct;
      primary = `${Math.round(block.timePct)}%`;
      const resetShort = fmtDuration(block.remainingMinutes * 60000);
      suffix = ` · ${resetShort}`;
      centerLabel = primary;
      centerSub = `sessão 5h · reseta ${resetShort}`;
      effective = Math.max(block.timePct, costPctForColor, projForColor);
    } else {
      // Só statusline fresca sem rate (raro).
      if (isSub) {
        // Assinatura sem rate/ccusage: mostra contexto (custo não é cobrança).
        ringPct = ctxPct;
        primary = ctxPct != null ? `${Math.round(ctxPct)}%` : "—";
        suffix = "";
        centerLabel = primary;
        centerSub = "contexto";
        effective = ctxPct ?? 0;
      } else {
        ringPct = ctxPct;
        primary = fmtUsd(cost);
        suffix = "";
        centerLabel = fmtUsd(cost);
        centerSub = "custo da sessão";
        effective = Math.max(ctxPct ?? 0, costPctForColor);
      }
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
          fiveHour,
          sevenDay,
          fiveHourResetsAt: s?.five_hour?.resets_at ?? null,
          sevenDayResetsAt: s?.seven_day?.resets_at ?? null,
        })
      : { active: false, message: "", reasons: [], key: "" };

    // Ícone de alerta antecede o texto quando ativo.
    item.text = (alert.active ? "$(warning) " : "") +
      styleText(style, ringPct, primary, suffix);

    let level: "ok" | "warn" | "err" =
      effective >= err ? "err" : effective >= warn ? "warn" : "ok";
    if (alert.active) {
      level = "err"; // alerta sempre pinta de vermelho
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

    // Notificação com cooldown (e re-dispara se o tipo de alerta mudar).
    if (alert.active) {
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
            ? ` — estoura em ~${fmtDuration(etaMin * 60000)}`
            : "";
        vscode.window
          .showWarningMessage(
            `Claude Usage — ${alert.message}${etaSuffix}`,
            "Abrir painel",
            "Silenciar 1h",
            "Desligar alertas"
          )
          .then((choice) => {
            if (choice === "Abrir painel") {
              vscode.commands.executeCommand("claudeUsageBar.openPanel");
            } else if (choice === "Silenciar 1h") {
              // empurra o cooldown 1h pra frente
              lastAlertAtMs = Date.now() + 60 * 60_000 - cooldownMs;
            } else if (choice === "Desligar alertas") {
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

    // Modelo atual: statusline fresca > transcript > ccusage (último do bloco).
    const modelName =
      (fresh && s?.model) || currentModel || block?.model || null;

    const view = {
      mode: mode === "plan" ? ("plan" as const) : ("api" as const),
      usingCcusage: mode !== "plan" && !!block,
      ringPct,
      centerLabel,
      centerSub,
      level,
      fiveHour,
      sevenDay,
      ctxPct,
      cost,
      costCap,
      isSub,
      block,
      state: s,
      alert,
      alertEnabled: alertOn,
      projPct,
      etaMin,
      daily: lastDaily,
      modelName,
    };
    item.tooltip = buildTooltip(view);

    viewProvider.update(
      buildPanelData(view),
      c.get<BarStyle>("barStyle") ?? "ring"
    );
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
    ctxPct: number | null;
    cost: number;
    costCap: number;
    isSub: boolean;
    block: CcusageData | null;
    state: UsageState | null;
    alert: AlertResult;
    alertEnabled: boolean;
    projPct: number | null;
    etaMin: number | null;
    daily: CcusageDaily[];
    modelName: string | null;
  };

  const buildTooltip = (v: View): vscode.MarkdownString => {
    const lines: string[] = ["**Claude Code — uso da sessão**", ""];
    if (v.alert.active) {
      lines.push(`$(warning) **${v.alert.message}**`);
      v.alert.reasons.slice(1).forEach((r) => lines.push(`· ${r}`));
      lines.push("");
    }
    const pctStr = (x: number | null) => (x == null ? "—" : `${Math.round(x)}%`);
    const bar = (x: number | null) => {
      if (x == null) {
        return "";
      }
      const filled = Math.round((Math.min(100, x) / 100) * 10);
      return " " + "█".repeat(filled) + "░".repeat(10 - filled);
    };

    if (v.mode === "plan") {
      const s = v.state;
      lines.push(
        `**Sessão (5h):** ${pctStr(v.fiveHour)}${bar(v.fiveHour)}` +
          (s?.five_hour?.resets_at
            ? ` · reseta ${fmtResetsAt(s.five_hour.resets_at)}`
            : "")
      );
      lines.push(
        `**Semana (7d):** ${pctStr(v.sevenDay)}${bar(v.sevenDay)}` +
          (s?.seven_day?.resets_at
            ? ` · reseta ${fmtResetsAt(s.seven_day.resets_at)}`
            : "")
      );
    } else if (v.block) {
      const b = v.block;
      lines.push(
        `**Sessão (5h):** ${Math.round(b.timePct)}% do tempo${bar(b.timePct)}`
      );
      lines.push(`reseta em ${fmtDuration(b.remainingMinutes * 60000)}`);
      if (v.isSub) {
        lines.push(
          `**Equivalente API:** ~${fmtUsd(b.costUSD)} _(referência; sua assinatura cobre)_`
        );
      } else {
        lines.push(`**Custo da sessão:** ${fmtUsd(b.costUSD)}`);
        if (b.burnCostPerHour != null) {
          lines.push(
            `**Ritmo:** ${fmtUsd(b.burnCostPerHour)}/h · projeção ${fmtUsd(
              b.projectedCost ?? undefined
            )}`
          );
        }
      }
      lines.push(`**Tokens no bloco:** ${fmtTokens(b.totalTokens)}`);
    }

    // Projeção (quando colore por projeção e ela é o fator relevante).
    if (v.projPct != null && v.projPct >= 60) {
      const arrow = v.projPct >= 100 ? "⚠" : "↗";
      const label = v.isSub
        ? "Ritmo projetado"
        : v.mode === "plan"
        ? "Limite projetado no reset"
        : "Custo projetado vs teto";
      const eta =
        v.etaMin != null
          ? ` · estoura em ~${fmtDuration(v.etaMin * 60000)}`
          : "";
      lines.push(`${arrow} **${label}:** ~${Math.round(v.projPct)}%${eta}`);
    }
    lines.push("");

    if (v.ctxPct != null) {
      lines.push(`**Contexto:** ${pctStr(v.ctxPct)}${bar(v.ctxPct)}`);
    }

    const model = prettyModel(v.modelName);
    if (model) {
      lines.push(`**Modelo:** ${model}`);
    }

    lines.push("");
    const src = v.usingCcusage
      ? "fonte: ccusage (transcripts)"
      : v.mode === "plan"
      ? "fonte: statusline (limites do plano)"
      : "fonte: statusline";
    const agoStr = v.state?.ts ? ` · statusline ${fmtAgo(v.state.ts)}` : "";
    lines.push(`_${src}${agoStr} · clique abre o painel_`);

    const md = new vscode.MarkdownString(lines.join("\n\n"));
    md.isTrusted = true;
    return md;
  };

  const buildPanelData = (v: View): PanelData => {
    const rows: PanelData["rows"] = [];
    if (v.mode === "plan") {
      const s = v.state;
      rows.push({
        label: `Sessão (5h)${
          s?.five_hour?.resets_at
            ? " · reseta " + fmtResetsAt(s.five_hour.resets_at)
            : ""
        }`,
        value: v.fiveHour != null ? `${Math.round(v.fiveHour)}%` : "—",
        pct: v.fiveHour,
      });
      rows.push({
        label: `Semana (7d)${
          s?.seven_day?.resets_at
            ? " · reseta " + fmtResetsAt(s.seven_day.resets_at)
            : ""
        }`,
        value: v.sevenDay != null ? `${Math.round(v.sevenDay)}%` : "—",
        pct: v.sevenDay,
      });
    } else if (v.block) {
      const b = v.block;
      rows.push({
        label: `Sessão 5h · reseta em ${fmtDuration(
          b.remainingMinutes * 60000
        )}`,
        value: `${Math.round(b.timePct)}% do tempo`,
        pct: b.timePct,
      });
      if (v.isSub) {
        // Assinatura: $ é só referência; sem teto/barra/cor.
        rows.push({
          label: "Equivalente API (sua assinatura cobre)",
          value: `~${fmtUsd(b.costUSD)}`,
          pct: null,
        });
      } else {
        const capPct =
          v.costCap > 0 ? Math.min(100, (b.costUSD / v.costCap) * 100) : null;
        rows.push({
          label: v.costCap > 0 ? `Custo / teto ${fmtUsd(v.costCap)}` : "Custo",
          value: fmtUsd(b.costUSD),
          pct: capPct,
        });
        if (b.burnCostPerHour != null) {
          rows.push({
            label: "Ritmo (projeção do bloco)",
            value: `${fmtUsd(b.burnCostPerHour)}/h → ${fmtUsd(
              b.projectedCost ?? undefined
            )}`,
            pct: null,
          });
        }
      }
      rows.push({
        label: "Tokens no bloco",
        value: fmtTokens(b.totalTokens),
        pct: null,
      });
    }

    if (v.ctxPct != null) {
      rows.push({
        label: "Contexto",
        value: `${Math.round(v.ctxPct)}%`,
        pct: v.ctxPct,
      });
    }
    const model = prettyModel(v.modelName);
    if (model) {
      rows.push({ label: "Modelo", value: model, pct: null });
    }

    const src = v.usingCcusage
      ? "ccusage"
      : v.mode === "plan"
      ? "statusline (plano)"
      : "statusline";
    // Últimos ~7 dias pro sparkline: só o que o gráfico precisa (data + tokens).
    const daily = v.daily.slice(-7).map((d) => ({
      date: d.date,
      tokens: d.totalTokens,
    }));
    return {
      mode: v.mode,
      ringPct: v.ringPct,
      centerLabel: v.centerLabel,
      centerSub: v.centerSub,
      level: v.level,
      rows,
      alert: v.alert.active
        ? { message: v.alert.message, reasons: v.alert.reasons }
        : null,
      alertEnabled: v.alertEnabled,
      daily,
      footer: `fonte: ${src}${
        v.state?.ts ? " · statusline " + fmtAgo(v.state.ts) : ""
      }`,
    };
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
      readState();
      refreshCcusage();
      refreshDaily();
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
        `Claude Usage: alerta de burn rate ${next ? "LIGADO 🔔" : "DESLIGADO 🔕"}.`
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
          "Arquivo de estado da statusline ainda não existe (só é gravado ao usar o Claude Code no terminal)."
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
    vscode.commands.registerCommand("claudeUsageBar.openPanel", () => {
      viewProvider.reveal();
      render();
      refreshCcusage();
      refreshDaily();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudeUsageBar")) {
        startWatch();
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

  startWatch();
  readState();
  refreshCcusage();
  refreshDaily();
}

export function deactivate() {
  // disposables cuidam da limpeza
}
