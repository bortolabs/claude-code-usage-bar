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
  footer: string;
}

/** Painel webview com o anel SVG real, estilo app do Claude. */
export class UsagePanel {
  public static current: UsagePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  static createOrShow(
    ctx: vscode.ExtensionContext,
    data: PanelData,
    barStyle: string
  ) {
    const column = vscode.ViewColumn.Beside;
    if (UsagePanel.current) {
      UsagePanel.current.panel.reveal(column, true);
      UsagePanel.current.update(data, barStyle);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "claudeUsagePanel",
      "Claude Usage",
      { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    UsagePanel.current = new UsagePanel(panel);
    UsagePanel.current.update(data, barStyle);
    ctx.subscriptions.push(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "setStyle" && typeof msg.style === "string") {
        vscode.commands.executeCommand("claudeUsageBar.setStyle", msg.style);
      } else if (msg?.type === "refresh") {
        vscode.commands.executeCommand("claudeUsageBar.refresh");
      }
    });
    this.panel.onDidDispose(() => {
      this.disposed = true;
      UsagePanel.current = undefined;
    });
  }

  update(data: PanelData, barStyle?: string) {
    if (this.disposed) {
      return;
    }
    this.panel.webview.postMessage({ type: "data", data, barStyle });
  }

  private html(): string {
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
    padding: 18px 16px;
    margin: 0;
  }
  .ring-wrap { display: flex; justify-content: center; margin: 4px 0 16px; }
  .center-num { font-size: 30px; font-weight: 700; }
  .center-sub { font-size: 12px; fill: var(--vscode-descriptionForeground); }
  .row { margin: 10px 0; }
  .row-head { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 4px; }
  .row-label { color: var(--vscode-descriptionForeground); }
  .row-val { font-variant-numeric: tabular-nums; }
  .track { height: 7px; border-radius: 4px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 4px; transition: width .35s ease; }
  .footer { margin-top: 16px; font-size: 11.5px; color: var(--vscode-descriptionForeground); text-align: center; }
  .empty { text-align: center; color: var(--vscode-descriptionForeground); margin-top: 40px; }
  .bg-ok { background: var(--ok); } .bg-warn { background: var(--warn); } .bg-err { background: var(--err); }
  .styles { margin: 8px 0 18px; }
  .styles-title { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  .style-btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .sbtn {
    font-family: var(--vscode-font-family); font-size: 12px;
    padding: 4px 10px; border-radius: 6px; cursor: pointer;
    background: var(--vscode-button-secondaryBackground, #313131);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: 1px solid transparent;
  }
  .sbtn:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
  .sbtn.active { border-color: var(--ok); color: var(--vscode-foreground); }
  hr { border: none; border-top: 1px solid var(--track); margin: 14px 0; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .title { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); }
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
    <svg width="180" height="180" viewBox="0 0 180 180">
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
    document.getElementById('app').innerHTML =
      header +
      '<div class="ring-wrap">' + ringSvg(d.ringPct, d.level, d.centerLabel, d.centerSub) + '</div>' +
      rows + '<hr>' + styleButtons() +
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
        // garante que o giro seja visível mesmo se o refresh for instantâneo
        setTimeout(function(){ rb.classList.remove('spinning'); }, 600);
        vscode.postMessage({ type: 'refresh' });
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
</script>
</body>
</html>`;
  }
}
