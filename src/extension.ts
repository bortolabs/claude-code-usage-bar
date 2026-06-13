import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

/**
 * Dois modos, escolhidos automaticamente pelo que o JSON entrega:
 *  - "plan": conta com assinatura (Pro/Max). rate_limits presente. Anel = 5h, número = 7d.
 *  - "api":  conta API/pay-as-you-go. Sem rate_limits. Anel = contexto, número = custo $.
 * "subscriber" força sempre o modo plano; "cost" força sempre o modo API; "auto" decide.
 */
type Mode = "auto" | "subscriber" | "cost";

// Anel de progresso em texto: 9 níveis de 0% a 100%.
const RING_GLYPHS = ["○", "◔", "◔", "◑", "◑", "◕", "◕", "●", "●"];

function ringFor(pct: number): string {
  const idx = Math.min(
    RING_GLYPHS.length - 1,
    Math.max(0, Math.round((pct / 100) * (RING_GLYPHS.length - 1)))
  );
  return RING_GLYPHS[idx];
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
  const deltaMs = epochSeconds * 1000 - Date.now();
  if (deltaMs <= 0) {
    return "agora";
  }
  const totalMin = Math.round(deltaMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `em ${d}d${rh}h` : `em ${d}d`;
  }
  if (h > 0) {
    return `em ${h}h${String(m).padStart(2, "0")}`;
  }
  return `em ${m}min`;
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
  item.command = "claudeUsageBar.openState";
  item.show();
  context.subscriptions.push(item);

  let lastState: UsageState | null = null;
  let watcher: fs.FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  let tick: NodeJS.Timeout | undefined;

  const resolveStatePath = (): string => {
    const custom = (cfg().get<string>("stateFilePath") || "").trim();
    if (custom) {
      return custom.startsWith("~")
        ? path.join(os.homedir(), custom.slice(1))
        : custom;
    }
    return path.join(os.homedir(), ".claude", "usage-state.json");
  };

  const readState = () => {
    const p = resolveStatePath();
    try {
      const raw = fs.readFileSync(p, "utf8");
      lastState = JSON.parse(raw) as UsageState;
    } catch {
      // arquivo ainda não existe ou leitura no meio de um mv — mantém o último estado
    }
    render();
  };

  /** Decide o modo efetivo a partir da config e do que o estado entrega. */
  const effectiveMode = (s: UsageState): "plan" | "api" => {
    const wanted = (cfg().get<Mode>("mode") ?? "auto") as Mode;
    const hasRate =
      s.five_hour?.used_percentage != null ||
      s.seven_day?.used_percentage != null;
    if (wanted === "subscriber") {
      return "plan";
    }
    if (wanted === "cost") {
      return "api";
    }
    return hasRate ? "plan" : "api";
  };

  const ctxPctOf = (s: UsageState): number | null =>
    s.context?.used_pct ??
    (s.context?.size && s.context.size > 0
      ? (((s.context.input ?? 0) + (s.context.output ?? 0)) / s.context.size) *
        100
      : null);

  const render = () => {
    const c = cfg();
    const warn = c.get<number>("warnThreshold") ?? 60;
    const err = c.get<number>("errorThreshold") ?? 85;
    const staleAfter = c.get<number>("staleAfterSeconds") ?? 900;
    const costCap = c.get<number>("costCapUsd") ?? 5;

    if (!lastState) {
      item.text = "$(circle-outline) Claude —";
      const md = new vscode.MarkdownString(
        "**Claude Code Usage**\n\nNenhum dado ainda. Inicie ou continue uma sessão do Claude Code — o indicador aparece após a primeira resposta.\n\n_(Os dados vêm de `~/.claude/usage-state.json`, gravado pela statusline.)_"
      );
      md.isTrusted = true;
      item.tooltip = md;
      item.color = new vscode.ThemeColor("disabledForeground");
      item.backgroundColor = undefined;
      return;
    }

    const s = lastState;
    const mode = effectiveMode(s);
    const fiveHour = s.five_hour?.used_percentage ?? null;
    const sevenDay = s.seven_day?.used_percentage ?? null;
    const ctxPct = ctxPctOf(s);
    const cost = s.cost_usd ?? 0;

    // "effective" = o % que rege as cores do indicador.
    let effective = 0;

    if (mode === "plan") {
      // Anel = 5h; número secundário = 7d.
      const ringPct = fiveHour ?? 0;
      const ring = ringFor(ringPct);
      const sevenStr = sevenDay != null ? ` · 7d ${Math.round(sevenDay)}%` : "";
      item.text =
        fiveHour != null
          ? `${ring} ${Math.round(fiveHour)}%${sevenStr}`
          : `${ring} —${sevenStr}`;
      // cor pelo limite mais crítico das duas janelas
      effective = Math.max(fiveHour ?? 0, sevenDay ?? 0);
    } else {
      // Modo API: anel = contexto; número = custo $.
      const ringPct = ctxPct ?? 0;
      const ring = ringFor(ringPct);
      item.text = `${ring} ${fmtUsd(cost)}`;
      // cor: mistura — usa o pior entre %contexto e %do teto de custo
      const costPct = costCap > 0 ? Math.min(100, (cost / costCap) * 100) : 0;
      effective = Math.max(ctxPct ?? 0, costPct);
    }

    // Cores por threshold.
    if (effective >= err) {
      item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else if (effective >= warn) {
      item.color = undefined;
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    } else {
      item.color = undefined;
      item.backgroundColor = undefined;
    }

    // "Parado" se não atualiza há muito tempo.
    const stale = s.ts ? Date.now() / 1000 - s.ts > staleAfter : false;
    if (stale) {
      item.color = new vscode.ThemeColor("disabledForeground");
      item.backgroundColor = undefined;
    }

    item.tooltip = buildTooltip(s, {
      mode,
      fiveHour,
      sevenDay,
      ctxPct,
      cost,
      costCap,
      stale,
    });
  };

  const buildTooltip = (
    s: UsageState,
    info: {
      mode: "plan" | "api";
      fiveHour: number | null;
      sevenDay: number | null;
      ctxPct: number | null;
      cost: number;
      costCap: number;
      stale: boolean;
    }
  ): vscode.MarkdownString => {
    const lines: string[] = [];
    lines.push("**Claude Code — uso da sessão**");
    lines.push("");

    const pctStr = (v: number | null) =>
      v == null ? "—" : `${Math.round(v)}%`;
    const bar = (v: number | null) => {
      if (v == null) {
        return "";
      }
      const filled = Math.round((Math.min(100, v) / 100) * 10);
      return " " + "█".repeat(filled) + "░".repeat(10 - filled);
    };

    if (info.mode === "plan") {
      lines.push(
        `**Sessão (5h):** ${pctStr(info.fiveHour)}${bar(info.fiveHour)}` +
          (s.five_hour?.resets_at
            ? ` · reseta ${fmtResetsAt(s.five_hour.resets_at)}`
            : "")
      );
      lines.push(
        `**Semana (7d):** ${pctStr(info.sevenDay)}${bar(info.sevenDay)}` +
          (s.seven_day?.resets_at
            ? ` · reseta ${fmtResetsAt(s.seven_day.resets_at)}`
            : "")
      );
    } else {
      const capPct =
        info.costCap > 0
          ? Math.min(100, (info.cost / info.costCap) * 100)
          : null;
      lines.push(
        `**Custo da sessão:** ${fmtUsd(info.cost)}` +
          (info.costCap > 0
            ? ` / ${fmtUsd(info.costCap)}${bar(capPct)}`
            : "")
      );
      lines.push("_Conta API/pay-as-you-go: sem limite de plano — anel reflete o contexto._");
    }
    lines.push("");

    const ctxIn = s.context?.input ?? 0;
    const ctxOut = s.context?.output ?? 0;
    const ctxSize = s.context?.size ?? 0;
    lines.push(
      `**Contexto:** ${fmtTokens(ctxIn + ctxOut)} / ${fmtTokens(
        ctxSize
      )} (${pctStr(info.ctxPct)})`
    );

    if (s.last_call) {
      const lc = s.last_call;
      lines.push(
        `**Última chamada:** in ${fmtTokens(lc.input_tokens)} · out ${fmtTokens(
          lc.output_tokens
        )} · cache r ${fmtTokens(
          lc.cache_read_input_tokens
        )} · cache w ${fmtTokens(lc.cache_creation_input_tokens)}`
      );
    }

    lines.push("");
    if (info.mode === "plan" && typeof s.cost_usd === "number") {
      lines.push(`**Custo estimado:** ${fmtUsd(s.cost_usd)}`);
    }
    if (s.model) {
      lines.push(`**Modelo:** ${s.model}`);
    }
    const sessName =
      s.session_name || (s.session_id ? s.session_id.slice(0, 8) : "");
    const proj = s.cwd ? path.basename(s.cwd) : "";
    if (sessName || proj) {
      lines.push(`**Sessão:** ${sessName}${proj ? ` · ${proj}` : ""}`);
    }

    lines.push("");
    lines.push(
      `_${info.stale ? "⚠ parado · " : ""}atualizado ${fmtAgo(
        s.ts
      )} · clique p/ abrir o estado_`
    );

    const md = new vscode.MarkdownString(lines.join("\n\n"));
    md.isTrusted = true;
    return md;
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
      // diretório pode não existir ainda; o tick periódico cobre esse caso
    }
  };

  // Comandos
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeUsageBar.refresh", readState),
    vscode.commands.registerCommand("claudeUsageBar.openState", async () => {
      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(resolveStatePath())
        );
        await vscode.window.showTextDocument(doc);
      } catch {
        vscode.window.showInformationMessage(
          "Arquivo de estado ainda não existe. Rode um turno no Claude Code com a bridge da statusline configurada."
        );
      }
    })
  );

  // Reage a mudanças de configuração relevantes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudeUsageBar")) {
        startWatch();
        readState();
      }
    })
  );

  // Tick periódico: cobre criação tardia do arquivo e mantém os "reseta em" frescos.
  tick = setInterval(readState, 30_000);
  context.subscriptions.push({ dispose: () => tick && clearInterval(tick) });

  startWatch();
  readState();
}

export function deactivate() {
  // disposables cuidam da limpeza
}
