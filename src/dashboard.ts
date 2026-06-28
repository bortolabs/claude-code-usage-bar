import * as vscode from "vscode";
import { tr } from "./i18n";

/**
 * Dashboard de analytics (aba do editor) — renderer dedicado, separado da sidebar.
 * KPIs + composição de custo + gráfico temporal + insights + breakdowns + tabelas.
 * Reusa o data layer (transcriptStats) via um payload `DashboardData` montado no
 * extension.ts. Sem libs externas: gráficos em SVG inline (CSP com nonce).
 *
 * CUIDADO ao editar o template gigante abaixo: dentro do <script> NÃO use crases
 * nem a sequência "${" (o template externo é uma crase) — todo o JS é montado por
 * concatenação de strings com aspas simples.
 */

export type DashWindow = "today" | "week" | "month" | "all";

export interface DashSeriesPoint {
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  costUSD: number;
  messages: number;
}

export interface DashboardData {
  window: DashWindow;
  kpis: {
    costUSD: number;
    messages: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheHitRate: number; // 0–100
    totalTokens: number;
  };
  costByType: { input: number; output: number; cacheRead: number; cacheWrite: number };
  series: { unit: "hour" | "day"; points: DashSeriesPoint[] };
  insights: { level: string; text: string }[];
  byModel: {
    model: string;
    costUSD: number;
    tokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    messages: number;
  }[];
  byProject: { project: string; costUSD: number; tokens: number }[];
  bySession: {
    session: string;
    project: string;
    costUSD: number;
    tokens: number;
    messages: number;
    durationMs: number;
  }[];
  byContext: { bucket: string; costUSD: number; tokens: number; turns: number }[];
  bySkill: { name: string; calls: number }[];
  byPlugin: { name: string; calls: number }[];
  byMcp: { name: string; calls: number }[];
  bySubagent: { name: string; calls: number }[];
  isSub: boolean;
  tableVersion: string;
  /** Rótulo de "gerado em" (só no export estático). */
  generatedLabel?: string;
}

/** Strings da UI do dashboard (traduzidas via tr, injetadas como `L`). */
function dashboardStrings() {
  return {
    title: tr("Dashboard de uso do Claude"),
    generatedAt: tr("Gerado em {0}"),
    waiting: tr("Aguardando dados do Claude Code…"),
    refresh: tr("Atualizar"),
    aiAdvice: tr("AI advice"),
    exportHtml: tr("Exportar HTML"),
    openInBrowser: tr("Abrir no navegador"),
    windows: {
      today: tr("Hoje"),
      week: tr("Semana"),
      month: tr("Mês"),
      all: tr("Tudo"),
    },
    kpi: {
      cost: tr("Custo"),
      messages: tr("Mensagens"),
      input: tr("Input"),
      output: tr("Output"),
      cacheMiss: tr("Cache (miss)"),
      cacheHit: tr("Cache (hit)"),
      hitRate: tr("Cache hit rate"),
      tokens: tr("Tokens"),
    },
    composition: tr("Composição de custo"),
    chartTitle: tr("Uso ao longo do tempo"),
    metric: {
      tokens: tr("Tokens (composição)"),
      cost: tr("Custo"),
      messages: tr("Mensagens"),
    },
    insightsTitle: tr("Insights"),
    bd: {
      model: tr("Por modelo"),
      project: tr("Por projeto"),
      session: tr("Por sessão"),
      context: tr("Por tamanho de contexto"),
      skills: tr("Skills"),
      plugins: tr("Plugins"),
      mcp: tr("Servidores MCP"),
      subagents: tr("Subagentes"),
    },
    tableModel: tr("Detalhe por modelo"),
    tableTime: tr("Detalhe por período"),
    col: {
      model: tr("Modelo"),
      period: tr("Período"),
      cost: tr("Custo"),
      input: tr("Input"),
      output: tr("Output"),
      cacheMiss: tr("Cache miss"),
      cacheHit: tr("Cache hit"),
      messages: tr("Msgs"),
    },
    calls: tr("{0}×"),
    equiv: tr("equiv."),
    approxNote: tr("≈ aproximado · local, sem chamada externa · tabela v{0}"),
    subNote: tr("sua assinatura cobre — equivalente de API (≈ aproximado)"),
    empty: tr("Sem dados nesta janela ainda."),
    footerRepo: "bortolabs/claude-code-usage-bar",
  };
}

const THEME_FALLBACK = `:root {
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
  --vscode-foreground: #cccccc;
  --vscode-descriptionForeground: #9d9d9d;
  --vscode-editorWidget-border: #3a3a3a;
  --vscode-editorWidget-background: #252526;
  --vscode-button-secondaryBackground: #313131;
  --vscode-button-secondaryForeground: #cccccc;
  --vscode-button-secondaryHoverBackground: #3c3c3c;
  --vscode-focusBorder: #007fd4;
  --vscode-editorHoverWidget-background: #252526;
  --vscode-editorHoverWidget-foreground: #cccccc;
  --vscode-editorHoverWidget-border: #454545;
  --vscode-textLink-foreground: #4daafc;
  --vscode-input-background: #2a2a2a;
}
body { background: #1e1e1e; }`;

/**
 * HTML completo do dashboard. `opts.staticData` gera a variante autocontida
 * (export .html): dados embutidos, sem `acquireVsCodeApi`, sem botões de host,
 * com fallback de tema p/ abrir no navegador.
 */
export function dashboardHtml(
  data: DashboardData | null,
  opts?: { staticData?: DashboardData; generatedAt?: string }
): string {
  const nonce = String(Date.now()) + "x";
  const L = dashboardStrings();
  const staticData = opts?.staticData ?? null;
  const isExport = !!staticData;
  const payload = staticData ?? data;
  const themeFallback = isExport ? THEME_FALLBACK : "";

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  ${themeFallback}
  :root { --ok:#4caf78; --warn:#e0a52b; --err:#e05a4b;
    --c-input:#4daafc; --c-output:#e0a52b; --c-hit:#4caf78; --c-miss:#9b6dff;
    --track: var(--vscode-editorWidget-border, #3a3a3a); }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 18px 24px; }
  .wrap { max-width: 1500px; margin: 0 auto; }
  .header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
  .title { font-size:15px; font-weight:600; }
  .header-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .gen { font-size:11px; color:var(--vscode-descriptionForeground); }
  .btn { font-family:var(--vscode-font-family); font-size:12px; padding:4px 10px; border-radius:6px; cursor:pointer;
    border:1px solid transparent; background:var(--vscode-button-secondaryBackground,#313131); color:var(--vscode-button-secondaryForeground,#ccc); }
  .btn:hover { background:var(--vscode-button-secondaryHoverBackground,#3c3c3c); }
  .btn.active { border-color: var(--ok); color: var(--vscode-foreground); }
  .seg { display:inline-flex; gap:4px; }
  .sec-title { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--vscode-descriptionForeground); margin:18px 0 8px; font-weight:600; }
  /* KPIs */
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .kpi { background:var(--vscode-editorWidget-background,rgba(255,255,255,.03)); border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,.07)); border-radius:10px; padding:12px 14px; }
  .kpi-label { font-size:11px; color:var(--vscode-descriptionForeground); }
  .kpi-val { font-size:22px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:4px; }
  .kpi-val.cost { color: var(--ok); }
  .kpi-sub { font-size:10.5px; color:var(--vscode-descriptionForeground); margin-top:2px; }
  /* card */
  .card { background:var(--vscode-editorWidget-background,rgba(255,255,255,.03)); border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,.07)); border-radius:10px; padding:12px 14px; margin-bottom:12px; }
  /* composition */
  .comp-bar { display:flex; height:18px; border-radius:5px; overflow:hidden; background:var(--track); }
  .comp-bar > div { height:100%; }
  .comp-leg { display:flex; flex-wrap:wrap; gap:10px 16px; margin-top:8px; font-size:11.5px; color:var(--vscode-descriptionForeground); }
  .leg i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:baseline; }
  /* grid 2-col for breakdowns/tables */
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:12px; }
  /* breakdown bars */
  .bd-row { display:grid; grid-template-columns:140px 1fr auto auto; align-items:center; gap:8px; margin:5px 0; font-size:12px; }
  .bd-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--vscode-foreground); }
  .bd-track { height:8px; border-radius:4px; background:var(--track); overflow:hidden; }
  .bd-fill { height:100%; border-radius:4px; }
  .bd-val { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .bd-pct { font-variant-numeric:tabular-nums; color:var(--vscode-descriptionForeground); width:38px; text-align:right; }
  /* insights */
  .ins { border-left:3px solid var(--warn); padding:7px 11px; margin:8px 0; font-size:12.5px; border-radius:0 6px 6px 0; background:color-mix(in srgb, var(--warn) 10%, transparent); }
  .ins.info { border-left-color: var(--c-input); background:color-mix(in srgb, var(--c-input) 9%, transparent); }
  .ins.good { border-left-color: var(--ok); background:color-mix(in srgb, var(--ok) 10%, transparent); }
  /* chart */
  .chart { width:100%; height:auto; }
  .chart rect { transition: opacity .15s; }
  .chart .bar-hit:hover { opacity:.8; cursor:default; }
  .axis { font-size:9.5px; fill:var(--vscode-descriptionForeground); }
  /* table */
  table { width:100%; border-collapse:collapse; font-size:11.5px; }
  th, td { text-align:right; padding:4px 8px; border-bottom:1px solid var(--track); white-space:nowrap; }
  th:first-child, td:first-child { text-align:left; }
  th { color:var(--vscode-descriptionForeground); font-weight:600; font-size:10.5px; text-transform:uppercase; letter-spacing:.3px; }
  td.cost { color: var(--ok); }
  .scroll { overflow-x:auto; }
  .footer { margin-top:18px; font-size:11px; color:var(--vscode-descriptionForeground); text-align:center; }
  .footer a { color:inherit; }
  .empty { text-align:center; color:var(--vscode-descriptionForeground); margin:40px 0; }
  .tip { position:fixed; z-index:1000; pointer-events:none; display:none; background:var(--vscode-editorHoverWidget-background,#252526);
    color:var(--vscode-editorHoverWidget-foreground,#ccc); border:1px solid var(--vscode-editorHoverWidget-border,#454545);
    border-radius:4px; padding:4px 8px; font-size:11px; white-space:pre; box-shadow:0 2px 8px rgba(0,0,0,.35); }
  .is-export .needs-host { display:none !important; }
</style>
</head>
<body class="${isExport ? "is-export" : ""}">
  <div class="wrap"><div id="app"><div class="empty">${L.waiting}</div></div></div>
<script nonce="${nonce}">
  var vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi()
    : { getState:function(){return null;}, setState:function(){}, postMessage:function(){} };
  var STATIC_DATA = ${payload ? JSON.stringify(payload) : "null"};
  var STATIC_GENERATED_AT = ${JSON.stringify(opts?.generatedAt ?? "")};
  var IS_EXPORT = !!STATIC_DATA && ${isExport ? "true" : "false"};
  var L = ${JSON.stringify(L)};
  var data = STATIC_DATA;
  var metric = 'tokens';
  var COL = { input:'var(--c-input)', output:'var(--c-output)', cacheRead:'var(--c-hit)', cacheWrite:'var(--c-miss)' };

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];}); }
  function fmt(t,a){ return String(t).replace('{0}',a).replace('{1}',arguments[2]); }
  function usd(n){ n=n||0; return '$'+(n<0.01&&n>0?n.toFixed(3):n.toFixed(2)); }
  function intc(n){ return String(Math.round(n||0)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,','); }
  function tok(n){ n=n||0; if(n>=1e9)return (n/1e9).toFixed(1)+'B'; if(n>=1e6)return (n/1e6).toFixed(1)+'M'; if(n>=1e3)return (n/1e3).toFixed(1)+'k'; return String(Math.round(n)); }
  function dur(ms){ var h=Math.floor(ms/3600000), m=Math.round((ms%3600000)/60000); return h>0?(h+'h'+(m?(' '+m+'m'):'')):(m+'m'); }

  function kpi(label,val,cls,sub){ return '<div class="kpi"><div class="kpi-label">'+esc(label)+'</div><div class="kpi-val'+(cls?' '+cls:'')+'">'+esc(val)+'</div>'+(sub?'<div class="kpi-sub">'+esc(sub)+'</div>':'')+'</div>'; }

  function compositionBar(c){
    var parts=[[c.input,'var(--c-input)',L.kpi.input],[c.output,'var(--c-output)',L.kpi.output],[c.cacheRead,'var(--c-hit)',L.kpi.cacheHit],[c.cacheWrite,'var(--c-miss)',L.kpi.cacheMiss]];
    var tot=parts.reduce(function(a,p){return a+p[0];},0)||1;
    var seg=parts.map(function(p){var w=p[0]/tot*100; return w>0?('<div style="width:'+w+'%;background:'+p[1]+'" title="'+esc(p[2])+'"></div>'):'';}).join('');
    var leg=parts.map(function(p){var pc=Math.round(p[0]/tot*100); return '<span class="leg"><i style="background:'+p[1]+'"></i>'+esc(p[2])+' '+usd(p[0])+' ('+pc+'%)</span>';}).join('');
    return '<div class="card"><div class="comp-bar">'+seg+'</div><div class="comp-leg">'+leg+'</div></div>';
  }

  // Barras horizontais de breakdown. items: [{label, value}]. fmtVal(value)->str.
  function bdSection(title, items, fmtVal, accent){
    if(!items || !items.length) return '';
    var max=items.reduce(function(m,it){return Math.max(m,it.value);},0)||1;
    var tot=items.reduce(function(a,it){return a+it.value;},0)||1;
    var rows=items.map(function(it){
      var w=Math.max(2,Math.round(it.value/max*100));
      var pc=Math.round(it.value/tot*100);
      return '<div class="bd-row"><div class="bd-label" title="'+esc(it.label)+'">'+esc(it.label)+'</div>'
        +'<div class="bd-track"><div class="bd-fill" style="width:'+w+'%;background:'+accent+'"></div></div>'
        +'<div class="bd-val">'+esc(fmtVal(it.value))+'</div><div class="bd-pct">'+pc+'%</div></div>';
    }).join('');
    return '<div class="card"><div class="sec-title">'+esc(title)+'</div>'+rows+'</div>';
  }

  // Gráfico de barras (SVG). metric 'tokens' = empilhado por tipo; 'cost'/'messages' = barra única.
  function chartSvg(points){
    if(!points || !points.length) return '<div class="empty">'+esc(L.empty)+'</div>';
    var W=900, H=180, padB=22, padT=10, padL=4, n=points.length;
    var gap = n>40?1:2;
    var bw=(W-padL)/n - gap;
    if(bw<1) bw=1;
    function valOf(p){ return metric==='cost'?p.costUSD : metric==='messages'?p.messages : (p.input+p.output+p.cacheRead+p.cacheWrite); }
    var max=points.reduce(function(m,p){return Math.max(m,valOf(p));},0)||1;
    var bars='';
    for(var i=0;i<n;i++){
      var p=points[i]; var x=padL+i*(bw+gap); var v=valOf(p);
      var fullH=(H-padB-padT)*(v/max);
      var tipTxt=p.label+'\\n'+usd(p.costUSD)+' · '+tok(p.input+p.output+p.cacheRead+p.cacheWrite)+' tok · '+intc(p.messages)+' '+L.kpi.messages.toLowerCase();
      if(metric==='tokens'){
        var segs=[['cacheRead',COL.cacheRead],['input',COL.input],['output',COL.output],['cacheWrite',COL.cacheWrite]];
        var y=H-padB;
        for(var s=0;s<segs.length;s++){
          var sv=p[segs[s][0]]||0; var sh=(H-padB-padT)*(sv/max);
          if(sh>0){ y-=sh; bars+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+sh.toFixed(1)+'" fill="'+segs[s][1]+'"/>'; }
        }
        bars+='<rect class="bar-hit" x="'+x.toFixed(1)+'" y="'+padT+'" width="'+bw.toFixed(1)+'" height="'+(H-padB-padT)+'" fill="transparent" data-tip="'+esc(tipTxt)+'"/>';
      } else {
        var col = metric==='cost'?'var(--ok)':'var(--c-input)';
        bars+='<rect class="bar-hit" x="'+x.toFixed(1)+'" y="'+(H-padB-fullH).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+fullH.toFixed(1)+'" fill="'+col+'" data-tip="'+esc(tipTxt)+'"/>';
      }
    }
    // rótulos do eixo X: ~8 marcas
    var step=Math.max(1,Math.ceil(n/8)); var labels='';
    for(var j=0;j<n;j++){ if(j%step===0){ var lx=padL+j*(bw+gap)+bw/2; labels+='<text class="axis" x="'+lx.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+esc(points[j].label)+'</text>'; } }
    var maxLabel = metric==='cost'?usd(max):metric==='messages'?intc(max):tok(max);
    return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
      +'<text class="axis" x="2" y="'+(padT+8)+'">'+esc(maxLabel)+'</text>'+bars+labels+'</svg>';
  }

  function chartCard(){
    var toggle='<div class="seg needs-host">'
      +'<button class="btn'+(metric==='tokens'?' active':'')+'" data-metric="tokens">'+esc(L.metric.tokens)+'</button>'
      +'<button class="btn'+(metric==='cost'?' active':'')+'" data-metric="cost">'+esc(L.metric.cost)+'</button>'
      +'<button class="btn'+(metric==='messages'?' active':'')+'" data-metric="messages">'+esc(L.metric.messages)+'</button></div>';
    return '<div class="card"><div class="header" style="margin-bottom:8px"><span class="sec-title" style="margin:0">'+esc(L.chartTitle)+'</span>'+toggle+'</div>'+chartSvg(data.series.points)+'</div>';
  }

  function modelTable(rows){
    if(!rows||!rows.length) return '';
    var head='<tr><th>'+esc(L.col.model)+'</th><th>'+esc(L.col.cost)+'</th><th>'+esc(L.col.input)+'</th><th>'+esc(L.col.output)+'</th><th>'+esc(L.col.cacheMiss)+'</th><th>'+esc(L.col.cacheHit)+'</th><th>'+esc(L.col.messages)+'</th></tr>';
    var body=rows.map(function(m){ return '<tr><td>'+esc(m.model)+'</td><td class="cost">'+usd(m.costUSD)+'</td><td>'+tok(m.input)+'</td><td>'+tok(m.output)+'</td><td>'+tok(m.cacheWrite)+'</td><td>'+tok(m.cacheRead)+'</td><td>'+intc(m.messages)+'</td></tr>'; }).join('');
    return '<div class="card"><div class="sec-title">'+esc(L.tableModel)+'</div><div class="scroll"><table>'+head+body+'</table></div></div>';
  }

  function timeTable(){
    var pts=data.series.points; if(!pts.length) return '';
    var rows=pts.slice().reverse().slice(0,24);
    var head='<tr><th>'+esc(L.col.period)+'</th><th>'+esc(L.col.cost)+'</th><th>'+esc(L.col.input)+'</th><th>'+esc(L.col.output)+'</th><th>'+esc(L.col.cacheMiss)+'</th><th>'+esc(L.col.cacheHit)+'</th><th>'+esc(L.col.messages)+'</th></tr>';
    var body=rows.map(function(p){ return '<tr><td>'+esc(p.label)+'</td><td class="cost">'+usd(p.costUSD)+'</td><td>'+tok(p.input)+'</td><td>'+tok(p.output)+'</td><td>'+tok(p.cacheWrite)+'</td><td>'+tok(p.cacheRead)+'</td><td>'+intc(p.messages)+'</td></tr>'; }).join('');
    return '<div class="card"><div class="sec-title">'+esc(L.tableTime)+'</div><div class="scroll"><table>'+head+body+'</table></div></div>';
  }

  function render(d){
    if(d) data=d; if(!data) return;
    var k=data.kpis;
    var wins=['today','week','month','all'];
    var winSel='<div class="seg needs-host">'+wins.map(function(w){return '<button class="btn'+(data.window===w?' active':'')+'" data-win="'+w+'">'+esc(L.windows[w])+'</button>';}).join('')+'</div>';
    var genTxt = IS_EXPORT ? ('<span class="gen">'+esc(fmt(L.generatedAt, STATIC_GENERATED_AT||data.generatedLabel||''))+'</span>') : '';
    var actions='<button class="btn needs-host" data-act="aiAdvice">✦ '+esc(L.aiAdvice)+'</button>'
      +'<button class="btn needs-host" data-act="export">⬇ '+esc(L.exportHtml)+'</button>'
      +'<button class="btn needs-host" data-act="refresh">↻</button>';
    var header='<div class="header"><span class="title">'+esc(L.title)+'</span><div class="header-right">'+genTxt+winSel+actions+'</div></div>';

    if(!k || (k.costUSD<=0 && k.totalTokens<=0)){
      document.getElementById('app').innerHTML=header+'<div class="empty">'+esc(L.empty)+'</div>'+footer();
      wire(); return;
    }

    var kpis='<div class="kpis">'
      +kpi(L.kpi.cost, usd(k.costUSD), 'cost', data.isSub?L.equiv:'')
      +kpi(L.kpi.messages, intc(k.messages))
      +kpi(L.kpi.input, tok(k.input))
      +kpi(L.kpi.output, tok(k.output))
      +kpi(L.kpi.cacheMiss, tok(k.cacheWrite))
      +kpi(L.kpi.cacheHit, tok(k.cacheRead))
      +kpi(L.kpi.hitRate, Math.round(k.cacheHitRate)+'%')
      +'</div>';

    var insights = (data.insights&&data.insights.length)
      ? '<div>'+data.insights.map(function(i){return '<div class="ins '+esc(i.level)+'">'+esc(i.text)+'</div>';}).join('')+'</div>' : '';

    // breakdowns
    var mdl=(data.byModel||[]).map(function(m){return {label:m.model,value:m.costUSD};});
    var prj=(data.byProject||[]).map(function(p){return {label:p.project,value:p.costUSD};});
    var ses=(data.bySession||[]).map(function(s){return {label:(s.project?s.project+' · ':'')+String(s.session).slice(0,8)+' ('+dur(s.durationMs)+')',value:s.costUSD};});
    var ctx=(data.byContext||[]).map(function(b){return {label:b.bucket,value:b.costUSD};});
    var skl=(data.bySkill||[]).map(function(x){return {label:x.name,value:x.calls};});
    var plg=(data.byPlugin||[]).map(function(x){return {label:x.name,value:x.calls};});
    var mcp=(data.byMcp||[]).map(function(x){return {label:x.name,value:x.calls};});
    var sub=(data.bySubagent||[]).map(function(x){return {label:x.name,value:x.calls};});
    var callFmt=function(v){return fmt(L.calls,intc(v));};
    var costFmt=function(v){return usd(v);};
    var breakdowns='<div class="grid2">'
      +bdSection(L.bd.model,mdl,costFmt,'var(--c-input)')
      +bdSection(L.bd.project,prj,costFmt,'var(--c-hit)')
      +bdSection(L.bd.session,ses,costFmt,'var(--c-output)')
      +bdSection(L.bd.context,ctx,costFmt,'var(--c-miss)')
      +bdSection(L.bd.skills,skl,callFmt,'var(--c-input)')
      +bdSection(L.bd.plugins,plg,callFmt,'var(--c-miss)')
      +bdSection(L.bd.mcp,mcp,callFmt,'var(--c-hit)')
      +bdSection(L.bd.subagents,sub,callFmt,'var(--c-output)')
      +'</div>';

    var tables='<div class="grid2">'+modelTable(data.byModel)+timeTable()+'</div>';

    document.getElementById('app').innerHTML = header
      + kpis
      + '<div class="sec-title">'+esc(L.composition)+'</div>' + compositionBar(data.costByType)
      + chartCard()
      + (insights?('<div class="sec-title">'+esc(L.insightsTitle)+'</div>'+insights):'')
      + tables
      + breakdowns
      + footer();
    wire();
  }

  function footer(){
    var note = data && data.isSub ? L.subNote : fmt(L.approxNote, (data&&data.tableVersion)||'');
    return '<div class="footer">'+esc(note)+' · <a href="#" data-act="repo">'+esc(L.footerRepo)+'</a></div>';
  }

  function wire(){
    document.querySelectorAll('[data-win]').forEach(function(b){ b.addEventListener('click',function(){ vscode.postMessage({type:'setDashboardWindow',value:b.getAttribute('data-win')}); }); });
    document.querySelectorAll('[data-metric]').forEach(function(b){ b.addEventListener('click',function(){ metric=b.getAttribute('data-metric'); render(); }); });
    document.querySelectorAll('[data-act]').forEach(function(b){ b.addEventListener('click',function(e){
      var a=b.getAttribute('data-act');
      if(a==='refresh') vscode.postMessage({type:'refresh'});
      else if(a==='aiAdvice') vscode.postMessage({type:'aiAdvice'});
      else if(a==='export') vscode.postMessage({type:'exportDashboardHtml'});
      else if(a==='repo'){ e.preventDefault(); vscode.postMessage({type:'openRepo'}); }
    }); });
  }

  // tooltip flutuante das barras
  (function(){
    var tip=document.createElement('div'); tip.className='tip'; document.body.appendChild(tip);
    function hide(){ tip.style.display='none'; }
    document.addEventListener('mousemove',function(e){
      var t=e.target; var bar=t&&t.getAttribute&&t.getAttribute('data-tip')?t:null;
      if(bar){ tip.textContent=bar.getAttribute('data-tip'); tip.style.display='block';
        var w=tip.offsetWidth,h=tip.offsetHeight,left=e.clientX+12,top=e.clientY-h-12;
        if(left+w>window.innerWidth-4) left=e.clientX-w-12; if(left<4) left=4; if(top<4) top=e.clientY+12;
        tip.style.left=left+'px'; tip.style.top=top+'px';
      } else hide();
    });
    window.addEventListener('blur',hide);
  })();

  window.addEventListener('message',function(e){ var m=e.data; if(m&&m.type==='data'){ render(m.data); } });
  if(STATIC_DATA){ render(STATIC_DATA); } else { vscode.postMessage({type:'ready'}); }
</script>
</body>
</html>`;
}

/**
 * Painel do dashboard (aba do editor). Espelha o padrão do UsageViewProvider:
 * recebe `update(data)` via postMessage e remonta no `rebuild()` (troca de idioma).
 */
export class DashboardPanel {
  public static current: DashboardPanel | undefined;
  private panel: vscode.WebviewPanel;
  private last?: DashboardData;
  private msgDisposable?: vscode.Disposable;
  public onReady?: () => void;

  private constructor() {
    this.panel = vscode.window.createWebviewPanel(
      "claudeUsageDashboard",
      tr("Dashboard de uso do Claude"),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.msgDisposable = this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready") {
        if (this.last) {
          this.panel.webview.postMessage({ type: "data", data: this.last });
        }
        this.onReady?.();
      } else if (msg?.type === "refresh") {
        vscode.commands.executeCommand("claudeUsageBar.refresh");
      } else if (msg?.type === "setDashboardWindow" && typeof msg.value === "string") {
        vscode.commands.executeCommand("claudeUsageBar.setDashboardWindow", msg.value);
      } else if (msg?.type === "aiAdvice") {
        vscode.commands.executeCommand("claudeUsageBar.aiAdvice");
      } else if (msg?.type === "exportDashboardHtml") {
        vscode.commands.executeCommand("claudeUsageBar.exportDashboardHtml");
      } else if (msg?.type === "openRepo") {
        vscode.env.openExternal(
          vscode.Uri.parse("https://github.com/bortolabs/claude-code-usage-bar")
        );
      }
    });
    this.panel.onDidDispose(() => {
      this.msgDisposable?.dispose();
      DashboardPanel.current = undefined;
    });
    this.panel.webview.html = dashboardHtml(null);
  }

  static createOrShow(): DashboardPanel {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return DashboardPanel.current;
    }
    DashboardPanel.current = new DashboardPanel();
    return DashboardPanel.current;
  }

  update(data: DashboardData) {
    this.last = data;
    this.panel.webview.postMessage({ type: "data", data });
  }

  rebuild() {
    this.panel.title = tr("Dashboard de uso do Claude");
    this.panel.webview.html = dashboardHtml(null);
  }

  lastData(): DashboardData | undefined {
    return this.last;
  }
}

/** HTML autocontido (.html) do dashboard com os dados embutidos (snapshot). */
export function exportDashboardHtml(data: DashboardData, generatedAt?: string): string {
  return dashboardHtml(data, { staticData: data, generatedAt });
}
