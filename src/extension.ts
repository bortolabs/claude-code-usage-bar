import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UsagePanel, PanelData } from "./panel";
import { runCcusage, CcusageResult, CcusageData } from "./ccusage";
import { evaluateAlerts, AlertResult } from "./alerts";

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
  let watcher: fs.FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let tick: NodeJS.Timeout | undefined;
  let ccTick: NodeJS.Timeout | undefined;
  // Alerta: controle de cooldown da notificação.
  let lastAlertKey = "";
  let lastAlertAtMs = 0;

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
    render();
  };

  const refreshCcusage = async () => {
    const cmd =
      (cfg().get<string>("ccusageCommand") || "").trim() ||
      "npx -y ccusage@latest blocks --active --json";
    lastCcusage = await runCcusage(cmd);
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

    const mode = effectiveMode(hasRate);
    const fiveHour = s?.five_hour?.used_percentage ?? null;
    const sevenDay = s?.seven_day?.used_percentage ?? null;
    const ctxPct = ctxPctOf(s);
    // Custo: prefere o do bloco ccusage (real do bloco de 5h); senão statusline.
    const cost = block?.costUSD ?? s?.cost_usd ?? 0;

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
      effective = Math.max(fiveHour ?? 0, sevenDay ?? 0);
    } else if (block) {
      // App/IDE: ccusage. Herói = % de TEMPO da sessão de 5h + tempo restante.
      ringPct = block.timePct;
      primary = `${Math.round(block.timePct)}%`;
      const resetShort = fmtDuration(block.remainingMinutes * 60000);
      suffix = ` · ${resetShort}`;
      centerLabel = primary;
      centerSub = `sessão 5h · reseta ${resetShort}`;
      // Cor: tempo decorrido OU custo vs teto, o que estiver pior.
      const costPct = costCap > 0 ? Math.min(100, (cost / costCap) * 100) : 0;
      effective = Math.max(block.timePct, costPct);
    } else {
      // Só statusline fresca sem rate (raro): cai pra custo/contexto.
      ringPct = ctxPct;
      primary = fmtUsd(cost);
      suffix = "";
      centerLabel = fmtUsd(cost);
      centerSub = "custo da sessão";
      const costPct = costCap > 0 ? Math.min(100, (cost / costCap) * 100) : 0;
      effective = Math.max(ctxPct ?? 0, costPct);
    }

    // Avalia alerta de burn rate (projeção de estouro).
    const alertOn = c.get<boolean>("burnRateAlertEnabled") ?? true;
    const alert: AlertResult = alertOn
      ? evaluateAlerts({
          block,
          costCap,
          maxPerHour: c.get<number>("burnRateMaxPerHour") ?? 20,
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
        vscode.window
          .showWarningMessage(
            `Claude Usage — ${alert.message}`,
            "Abrir painel",
            "Silenciar 1h"
          )
          .then((choice) => {
            if (choice === "Abrir painel") {
              vscode.commands.executeCommand("claudeUsageBar.openPanel");
            } else if (choice === "Silenciar 1h") {
              // empurra o cooldown 1h pra frente
              lastAlertAtMs = Date.now() + 60 * 60_000 - cooldownMs;
            }
          });
      }
    } else {
      lastAlertKey = "";
    }

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
      block,
      state: s,
      alert,
    };
    item.tooltip = buildTooltip(view);

    if (UsagePanel.current) {
      UsagePanel.current.update(buildPanelData(view));
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
    ctxPct: number | null;
    cost: number;
    costCap: number;
    block: CcusageData | null;
    state: UsageState | null;
    alert: AlertResult;
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
      lines.push(`**Custo da sessão:** ${fmtUsd(b.costUSD)}`);
      if (b.burnCostPerHour != null) {
        lines.push(
          `**Ritmo:** ${fmtUsd(b.burnCostPerHour)}/h · projeção ${fmtUsd(
            b.projectedCost ?? undefined
          )}`
        );
      }
      lines.push(`**Tokens no bloco:** ${fmtTokens(b.totalTokens)}`);
    }
    lines.push("");

    if (v.ctxPct != null) {
      lines.push(`**Contexto:** ${pctStr(v.ctxPct)}${bar(v.ctxPct)}`);
    }

    const model = v.block?.model || v.state?.model;
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
    const model = v.block?.model || v.state?.model;
    if (model) {
      rows.push({ label: "Modelo", value: model, pct: null });
    }

    const src = v.usingCcusage
      ? "ccusage"
      : v.mode === "plan"
      ? "statusline (plano)"
      : "statusline";
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
      UsagePanel.createOrShow(
        context,
        {
          mode: "api",
          ringPct: null,
          centerLabel: "—",
          centerSub: "",
          level: "ok",
          rows: [],
          alert: null,
          footer: "Aguardando dados…",
        },
        cfg().get<BarStyle>("barStyle") ?? "ring"
      );
      render();
      refreshCcusage();
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

  startWatch();
  readState();
  refreshCcusage();
}

export function deactivate() {
  // disposables cuidam da limpeza
}
