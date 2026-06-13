import * as vscode from "vscode";

/** Dados que o painel precisa para desenhar. Calculados em extension.ts. */
export interface PanelData {
  mode: "plan" | "api";
  /** Percentual que o anel principal mostra (0-100). */
  ringPct: number | null;
  /** Texto grande no centro do anel (ex: "38%" ou "$2.47"). */
  centerLabel: string;
  /** Rótulo abaixo do número central (ex: "sessão · 5h"). */
  centerSub: string;
  /** Cor do anel: "ok" | "warn" | "err". */
  level: "ok" | "warn" | "err";
  rows: { label: string; value: string; pct: number | null }[];
  /** Faixa de alerta de burn rate (null = sem alerta). */
  alert: { message: string; reasons: string[] } | null;
  /** Estado do alerta de burn rate (para o toggle do painel). */
  alertEnabled: boolean;
  /** Histórico de uso dos últimos dias para o sparkline (pode ser vazio). */
  daily: { date: string; tokens: number }[];
  footer: string;
}

/** HTML compartilhado entre a view da sidebar e (se usado) um painel. */
function panelHtml(): string {
  const nonce = String(Date.now()) + "x";
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root {
    --ok: #4caf78;
    --warn: #e0a52b;
    --err: #e05a4b;
    --track: var(--vscode-editorWidget-border, #3a3a3a);
  }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 14px 14px;
    margin: 0;
  }
  .ring-wrap { display: flex; justify-content: center; margin: 4px 0 16px; }
  .center-num { font-size: 30px; font-weight: 700; }
  .center-sub { font-size: 11px; fill: var(--vscode-descriptionForeground); }
  .row { margin: 10px 0; }
  .row-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; gap: 8px; }
  .row-label { color: var(--vscode-descriptionForeground); }
  .row-val { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .track { height: 7px; border-radius: 4px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 4px; transition: width .35s ease; }
  .footer { margin-top: 16px; font-size: 11px; color: var(--vscode-descriptionForeground); text-align: center; }
  .empty { text-align: center; color: var(--vscode-descriptionForeground); margin-top: 40px; }
  .bg-ok { background: var(--ok); } .bg-warn { background: var(--warn); } .bg-err { background: var(--err); }
  .styles { margin: 8px 0 14px; }
  .styles-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  /* Sparkline de histórico (últimos dias). */
  .spark { margin: 12px 0 4px; }
  .spark-bars { display: flex; align-items: flex-end; gap: 3px; height: 40px; }
  .spark-bar {
    flex: 1 1 0; min-width: 0; border-radius: 2px 2px 0 0;
    background: var(--ok); opacity: .55; min-height: 2px;
  }
  .spark-bar.today { opacity: 1; }
  .spark-labels { display: flex; justify-content: space-between; font-size: 9.5px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
  .style-btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .sbtn {
    font-family: var(--vscode-font-family); font-size: 12px;
    padding: 4px 9px; border-radius: 6px; cursor: pointer;
    background: var(--vscode-button-secondaryBackground, #313131);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: 1px solid transparent;
  }
  .sbtn:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
  .sbtn.active { border-color: var(--ok); color: var(--vscode-foreground); }
  hr { border: none; border-top: 1px solid var(--track); margin: 14px 0; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .title { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); }
  .refresh {
    display: inline-flex; align-items: center; gap: 5px;
    font-family: var(--vscode-font-family); font-size: 12px;
    padding: 4px 9px; border-radius: 6px; cursor: pointer; border: 1px solid transparent;
    background: var(--vscode-button-secondaryBackground, #313131);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }
  .refresh:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
  .refresh .ic { display: inline-block; }
  .refresh.spinning .ic { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .alert {
    background: color-mix(in srgb, var(--err) 18%, transparent);
    border: 1px solid var(--err);
    border-radius: 8px; padding: 9px 11px; margin-bottom: 14px;
  }
  .alert-title { font-size: 12.5px; font-weight: 600; color: var(--err); margin-bottom: 2px; }
  .alert-reason { font-size: 11.5px; color: var(--vscode-foreground); opacity: .85; }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 2px; }
  .toggle-label { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .toggle {
    font-family: var(--vscode-font-family); font-size: 12px;
    padding: 4px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent;
    background: var(--vscode-button-secondaryBackground, #313131);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }
  .toggle:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
  .toggle.on { border-color: var(--ok); color: var(--vscode-foreground); }
  .toggle.off { opacity: .7; }
</style>
</head>
<body>
  <div id="app"><div class="empty">Aguardando dados do Claude Code…</div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const colorVar = { ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)' };
  let curStyle = 'ring';

  function ringSvg(pct, level, centerLabel, centerSub) {
    const r = 70, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
    const off = c * (1 - p / 100);
    const col = colorVar[level] || colorVar.ok;
    return \`
    <svg viewBox="0 0 180 180" style="width:min(180px,70%);height:auto">
      <circle cx="90" cy="90" r="\${r}" fill="none" stroke="var(--track)" stroke-width="14"/>
      <circle cx="90" cy="90" r="\${r}" fill="none" stroke="\${col}" stroke-width="14"
        stroke-linecap="round" stroke-dasharray="\${c}" stroke-dashoffset="\${off}"
        transform="rotate(-90 90 90)" style="transition: stroke-dashoffset .4s ease"/>
      <text x="90" y="88" text-anchor="middle" class="center-num" fill="var(--vscode-foreground)">\${centerLabel}</text>
      <text x="90" y="108" text-anchor="middle" class="center-sub">\${centerSub}</text>
    </svg>\`;
  }
  function styleButtons() {
    const opts = [['ring','◕ anel'],['bar','▰ barra'],['number','% número'],['icon','⚡ ícone']];
    return '<div class="styles"><div class="styles-title">Estilo na status bar</div><div class="style-btns">' +
      opts.map(function(o){
        return '<button class="sbtn' + (o[0]===curStyle?' active':'') + '" data-style="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div></div>';
  }
  // Formata tokens curto pro tooltip da barra (ex: 12.3M, 84k).
  function fmtTok(n) {
    if (!n || n <= 0) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\\.0$/, '') + 'k';
    return String(n);
  }
  // Sparkline: fileira de barras verticais proporcionais aos tokens/dia.
  // O último item (hoje) fica destacado. Sem itens, não renderiza nada.
  function sparkline(daily) {
    const days = (daily || []).filter(function(d){ return d && d.tokens != null; });
    if (!days.length) return '';
    const max = Math.max.apply(null, days.map(function(d){ return d.tokens; }).concat([1]));
    const bars = days.map(function(d, i) {
      const h = Math.max(2, Math.round((d.tokens / max) * 100));
      const today = i === days.length - 1 ? ' today' : '';
      const tip = (d.date || '') + ' · ' + fmtTok(d.tokens) + ' tokens';
      return '<div class="spark-bar' + today + '" style="height:' + h + '%" title="' + tip + '"></div>';
    }).join('');
    // rótulos só nas pontas (primeiro e último dia), pra não poluir.
    const first = days[0].date || '';
    const last = days[days.length - 1].date || '';
    const labels = '<div class="spark-labels"><span>' + first.slice(5) +
      '</span><span>' + last.slice(5) + '</span></div>';
    return '<div class="spark"><div class="styles-title">Últimos dias</div>' +
      '<div class="spark-bars">' + bars + '</div>' + labels + '</div>';
  }
  function render(d) {
    if (!d) return;
    const rows = (d.rows || []).map(function(row) {
      const pct = row.pct == null ? null : Math.max(0, Math.min(100, row.pct));
      const lvl = pct == null ? 'ok' : pct >= 85 ? 'err' : pct >= 60 ? 'warn' : 'ok';
      const bar = pct == null ? '' :
        '<div class="track"><div class="fill bg-' + lvl + '" style="width:' + pct + '%"></div></div>';
      return '<div class="row"><div class="row-head"><span class="row-label">' + row.label +
        '</span><span class="row-val">' + row.value + '</span></div>' + bar + '</div>';
    }).join('');
    const header =
      '<div class="header"><span class="title">Claude Usage</span>' +
      '<button id="refreshBtn" class="refresh" title="Atualizar"><span class="ic">↻</span> Atualizar</button></div>';
    let alertHtml = '';
    if (d.alert) {
      const extra = (d.alert.reasons || []).slice(1)
        .map(function(r){ return '<div class="alert-reason">· ' + r + '</div>'; }).join('');
      alertHtml = '<div class="alert"><div class="alert-title">⚠ ' + d.alert.message + '</div>' + extra + '</div>';
    }
    const alertEnabled = d.alertEnabled !== false;
    const toggleHtml =
      '<div class="toggle-row"><span class="toggle-label">Alerta de burn rate</span>' +
      '<button id="alertToggle" class="toggle ' + (alertEnabled ? 'on' : 'off') + '">' +
      (alertEnabled ? '🔔 Ligado' : '🔕 Desligado') + '</button></div>';
    document.getElementById('app').innerHTML =
      header + alertHtml +
      '<div class="ring-wrap">' + ringSvg(d.ringPct, d.level, d.centerLabel, d.centerSub) + '</div>' +
      rows + sparkline(d.daily) + '<hr>' + styleButtons() + toggleHtml +
      '<div class="footer">' + (d.footer || '') + '</div>';
    document.querySelectorAll('.sbtn').forEach(function(b){
      b.addEventListener('click', function(){
        curStyle = b.getAttribute('data-style');
        vscode.postMessage({ type: 'setStyle', style: curStyle });
        document.querySelectorAll('.sbtn').forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active');
      });
    });
    const rb = document.getElementById('refreshBtn');
    if (rb) {
      rb.addEventListener('click', function(){
        rb.classList.add('spinning');
        setTimeout(function(){ rb.classList.remove('spinning'); }, 600);
        vscode.postMessage({ type: 'refresh' });
      });
    }
    const at = document.getElementById('alertToggle');
    if (at) {
      at.addEventListener('click', function(){
        vscode.postMessage({ type: 'toggleAlert' });
      });
    }
  }
  window.addEventListener('message', function(e) {
    const m = e.data;
    if (m && m.type === 'data') {
      if (m.barStyle) curStyle = m.barStyle;
      render(m.data);
    }
  });
  // pede um render inicial assim que a view monta
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

function wireMessages(webview: vscode.Webview, onReady: () => void) {
  webview.onDidReceiveMessage((msg) => {
    if (msg?.type === "setStyle" && typeof msg.style === "string") {
      vscode.commands.executeCommand("claudeUsageBar.setStyle", msg.style);
    } else if (msg?.type === "refresh") {
      vscode.commands.executeCommand("claudeUsageBar.refresh");
    } else if (msg?.type === "toggleAlert") {
      vscode.commands.executeCommand("claudeUsageBar.toggleAlert");
    } else if (msg?.type === "ready") {
      onReady();
    }
  });
}

/**
 * Provider da view ancorada na Activity Bar (sidebar esquerda).
 * Persiste enquanto a view existe; recebe updates via postMessage.
 */
export class UsageViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claudeUsageView";
  public static current: UsageViewProvider | undefined;
  private view?: vscode.WebviewView;
  private last?: { data: PanelData; barStyle: string };
  /** Chamado quando a webview sinaliza que montou e quer dados. */
  public onReady?: () => void;

  constructor() {
    UsageViewProvider.current = this;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = panelHtml();
    wireMessages(view.webview, () => {
      if (this.last) {
        view.webview.postMessage({
          type: "data",
          data: this.last.data,
          barStyle: this.last.barStyle,
        });
      }
      this.onReady?.();
    });
    if (this.last) {
      view.webview.postMessage({
        type: "data",
        data: this.last.data,
        barStyle: this.last.barStyle,
      });
    }
  }

  update(data: PanelData, barStyle: string) {
    this.last = { data, barStyle };
    this.view?.webview.postMessage({ type: "data", data, barStyle });
  }

  /** Revela a view na sidebar (usado pelo comando/clique). */
  reveal() {
    if (this.view) {
      this.view.show?.(true);
    } else {
      vscode.commands.executeCommand("claudeUsageView.focus");
    }
  }
}
