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
  /**
   * Cor (hex) a usar no anel/barras quando o nível NÃO for crítico (err),
   * vinda do tema configurado (claude/mono/custom). `null` = usar o semáforo
   * normal (cor por nível). No nível `err` esta cor é ignorada e usa-se sempre
   * o vermelho (`--err`), para não perder o sinal de estouro.
   */
  ringColorOverride: string | null;
  rows: { label: string; value: string; pct: number | null }[];
  /** Faixa de alerta de burn rate (null = sem alerta). */
  alert: {
    message: string;
    reasons: string[];
    severity: "warn" | "err";
  } | null;
  /** Estado do alerta de burn rate (para o toggle do painel). */
  alertEnabled: boolean;
  /** Diagnóstico da fonte de dados ativa (oauth/statusline/ccusage) — strings já localizadas. */
  source: {
    kind: "oauth" | "statusline" | "ccusage" | "none";
    approximate: boolean;
    activeLabel: string;
    oauthLine: string;
    statuslineLine: string;
  };
  /** Epoch ms da última atualização efetiva (para "atualizado há Xs"). */
  updatedAtMs: number | null;
  /** Histórico de uso dos últimos dias para o sparkline (pode ser vazio). */
  daily: { date: string; tokens: number }[];
  /** Breakdown por projeto do bloco de 5h atual (#4). */
  projects: { project: string; tokens: number }[];
  /** Valores atuais dos settings (key → valor) para a aba Config. */
  settings: Record<string, unknown>;
  /** Status da Anthropic (status.claude.com). null = desabilitado/indisponível. */
  status: {
    indicator: string;
    description: string;
    components: { name: string; status: string }[];
    incidents: {
      name: string;
      impact: string;
      status: string;
      shortlink: string | null;
      lastUpdate: string | null;
    }[];
    recent: { name: string; impact: string; resolvedAt: string | null }[];
  } | null;
  footer: string;
}

/**
 * Dicionário de strings do painel, já traduzidas para o idioma ativo do VS Code
 * (via `vscode.l10n.t`). É montado no host e injetado no webview como `const L`,
 * já que o webview roda num contexto separado e não tem acesso ao `l10n`.
 * Português é o idioma-base; adicionar um idioma = um arquivo `l10n/bundle.l10n.<lang>.json`.
 */
function panelStrings() {
  return {
    waiting: vscode.l10n.t("Aguardando dados do Claude Code…"),
    title: vscode.l10n.t("Claude Usage"),
    refresh: vscode.l10n.t("Atualizar"),
    updating: vscode.l10n.t("atualizando…"),
    updated: vscode.l10n.t("atualizado {0}"),
    agoS: vscode.l10n.t("há {0}s"),
    agoMin: vscode.l10n.t("há {0}min"),
    agoH: vscode.l10n.t("há {0}h"),
    tabs: {
      sessao: vscode.l10n.t("Sessão"),
      historico: vscode.l10n.t("Histórico"),
      status: vscode.l10n.t("Status"),
      config: vscode.l10n.t("Config"),
    },
    stylesTitle: vscode.l10n.t("Estilo na status bar"),
    styles: {
      ring: vscode.l10n.t("◕ anel"),
      bar: vscode.l10n.t("▰ barra"),
      number: vscode.l10n.t("% número"),
      icon: vscode.l10n.t("⚡ ícone"),
    },
    lastDays: vscode.l10n.t("Últimos dias"),
    tokens: vscode.l10n.t("{0} tokens"),
    projectsTitle: vscode.l10n.t("Projetos nesta sessão (5h)"),
    noHistory: vscode.l10n.t("Sem histórico ainda."),
    sec: {
      appearance: vscode.l10n.t("Aparência"),
      source: vscode.l10n.t("Fonte e atualização"),
      account: vscode.l10n.t("Conta e limites"),
      alerts: vscode.l10n.t("Alertas e cores"),
      status: vscode.l10n.t("Status da Anthropic"),
      export: vscode.l10n.t("Exportar uso (p/ agentes/scripts)"),
    },
    cfg: {
      ringTheme: vscode.l10n.t("Tema do anel"),
      ringColor: vscode.l10n.t("Cor do anel (mono/custom)"),
      barStyle: vscode.l10n.t("Estilo na status bar"),
      alignment: vscode.l10n.t("Lado da status bar"),
      priority: vscode.l10n.t("Prioridade na status bar"),
      useOAuthUsage: vscode.l10n.t("Usar cota real (oauth/usage)"),
      oauthRefreshSeconds: vscode.l10n.t("Atualizar oauth (s)"),
      ccusageCommand: vscode.l10n.t("Comando ccusage"),
      ccusageRefreshSeconds: vscode.l10n.t("Atualizar ccusage (s)"),
      stateFilePath: vscode.l10n.t("Arquivo de estado (statusline)"),
      staleAfterSeconds: vscode.l10n.t("Statusline fresca por (s)"),
      accountType: vscode.l10n.t("Tipo de conta"),
      mode: vscode.l10n.t("Modo de exibição"),
      costCapUsd: vscode.l10n.t("Teto de custo (USD)"),
      sessionTokenCap: vscode.l10n.t("Teto de tokens/sessão"),
      intenseTokensPerMin: vscode.l10n.t("Ritmo intenso (tok/min)"),
      burnRateAlertEnabled: vscode.l10n.t("Alerta de burn rate"),
      burnRateMaxPerHour: vscode.l10n.t("Limite de ritmo ($/h)"),
      alertCooldownMinutes: vscode.l10n.t("Cooldown do alerta (min)"),
      colorByProjection: vscode.l10n.t("Colorir por projeção"),
      resetWarningMinutes: vscode.l10n.t("Aviso de fim de janela (min)"),
      lowQuotaThreshold: vscode.l10n.t("Avisar cota baixa (% restante)"),
      blockSummaryEnabled: vscode.l10n.t("Resumo ao fechar o bloco"),
      warnThreshold: vscode.l10n.t("Limiar amarelo (%)"),
      errorThreshold: vscode.l10n.t("Limiar vermelho (%)"),
      statusCheckEnabled: vscode.l10n.t("Monitorar status"),
      statusBadgeEnabled: vscode.l10n.t("Badge na status bar"),
      statusNotifyEnabled: vscode.l10n.t("Notificar incidentes"),
      statusRefreshSeconds: vscode.l10n.t("Atualizar status (s)"),
      exportStateEnabled: vscode.l10n.t("Exportar uso (arquivo)"),
      exportStatePath: vscode.l10n.t("Caminho do arquivo (vazio = padrão)"),
    },
    srcTitle: vscode.l10n.t("Fonte de dados"),
    srcActive: vscode.l10n.t("Fonte ativa"),
    cmdsTitle: vscode.l10n.t("Comandos"),
    cmd: {
      refresh: vscode.l10n.t("↻ Atualizar"),
      state: vscode.l10n.t("Arquivo de estado"),
      cycle: vscode.l10n.t("Alternar estilo"),
      toggle: vscode.l10n.t("Liga/desliga alerta"),
    },
    openSettings: vscode.l10n.t("Abrir settings.json (claudeUsageBar) →"),
    alertLabel: vscode.l10n.t("Alerta de burn rate"),
    alertOn: vscode.l10n.t("🔔 Ligado"),
    alertOff: vscode.l10n.t("🔕 Desligado"),
    st: {
      disabled: vscode.l10n.t("Verificação de status desligada ou indisponível."),
      openPage: vscode.l10n.t("Abrir status.claude.com →"),
      incidents: vscode.l10n.t("Incidentes ativos"),
      components: vscode.l10n.t("Componentes"),
      recent: vscode.l10n.t("Resolvidos recentemente"),
    },
    comp: {
      operational: vscode.l10n.t("operacional"),
      degraded_performance: vscode.l10n.t("degradado"),
      partial_outage: vscode.l10n.t("instável"),
      major_outage: vscode.l10n.t("fora do ar"),
      under_maintenance: vscode.l10n.t("manutenção"),
    },
    indicator: {
      none: vscode.l10n.t("Todos os sistemas operacionais"),
      minor: vscode.l10n.t("Interrupção menor"),
      major: vscode.l10n.t("Interrupção significativa"),
      critical: vscode.l10n.t("Interrupção crítica"),
      maintenance: vscode.l10n.t("Em manutenção"),
    },
    impact: {
      none: vscode.l10n.t("sem impacto"),
      minor: vscode.l10n.t("impacto menor"),
      major: vscode.l10n.t("impacto alto"),
      critical: vscode.l10n.t("crítico"),
      maintenance: vscode.l10n.t("manutenção"),
    },
    incStatus: {
      investigating: vscode.l10n.t("investigando"),
      identified: vscode.l10n.t("identificado"),
      monitoring: vscode.l10n.t("monitorando"),
      resolved: vscode.l10n.t("resolvido"),
      scheduled: vscode.l10n.t("agendado"),
      in_progress: vscode.l10n.t("em andamento"),
      verifying: vscode.l10n.t("verificando"),
      completed: vscode.l10n.t("concluído"),
    },
  };
}

/** HTML compartilhado entre a view da sidebar e (se usado) um painel. */
function panelHtml(): string {
  const nonce = String(Date.now()) + "x";
  const loc = panelStrings();
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
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px; }
  .header-right { display: flex; align-items: center; gap: 8px; }
  .title { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); }
  .last-upd { font-size: 10.5px; color: var(--vscode-descriptionForeground); white-space: nowrap; opacity: .8; }
  .last-upd.flash { color: var(--ok); opacity: 1; }
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
  .alert.warn { background: color-mix(in srgb, var(--warn) 16%, transparent); border-color: var(--warn); }
  .alert-title { font-size: 12.5px; font-weight: 600; color: var(--err); margin-bottom: 2px; }
  .alert.warn .alert-title { color: var(--warn); }
  .alert-reason { font-size: 11.5px; color: var(--vscode-foreground); opacity: .85; }
  /* Cards de separação por seção. */
  .card {
    background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03));
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.07));
    border-radius: 10px;
    padding: 12px 12px 6px;
    margin-bottom: 12px;
  }
  .card.controls { padding-bottom: 12px; }
  .card .row:first-child { margin-top: 0; }
  .card .spark { margin: 2px 0; }
  .card .styles { margin: 0; }
  .card.controls .toggle-row { margin: 0; }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 2px; }
  .toggle-label { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .help { cursor: help; opacity: .6; font-size: 11px; }
  .help:hover { opacity: 1; }
  .toggle {
    font-family: var(--vscode-font-family); font-size: 12px;
    padding: 4px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent;
    background: var(--vscode-button-secondaryBackground, #313131);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }
  .toggle:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
  .toggle.on { border-color: var(--ok); color: var(--vscode-foreground); }
  .toggle.off { opacity: .7; }
  /* Abas */
  .tabs { display: flex; gap: 4px; margin: 4px 0 12px; border-bottom: 1px solid var(--track); }
  .tab {
    font-family: var(--vscode-font-family); font-size: 12px;
    padding: 6px 10px; cursor: pointer; border: none; background: none;
    color: var(--vscode-descriptionForeground); border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover { color: var(--vscode-foreground); }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--ok); }
  /* Form de configurações */
  .cfg-section-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); margin: 14px 0 6px; }
  /* Título da seção quando é o 1º item do próprio card (1 card por seção). */
  .card > .cfg-section-title:first-child { margin-top: 2px; }
  .cfg-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 7px 0; }
  .cfg-label { font-size: 12px; color: var(--vscode-foreground); flex: 1 1 auto; }
  .cfg-ctrl { flex: 0 0 auto; }
  .cfg-ctrl input[type=number], .cfg-ctrl input[type=text], .cfg-ctrl select {
    font-family: var(--vscode-font-family); font-size: 12px;
    background: var(--vscode-input-background, #2a2a2a);
    color: var(--vscode-input-foreground, #ddd);
    border: 1px solid var(--vscode-input-border, #444); border-radius: 5px;
    padding: 3px 6px; max-width: 150px;
  }
  .cfg-ctrl input[type=number] { width: 80px; }
  .cfg-ctrl input[type=color] { width: 34px; height: 24px; padding: 0; border: none; background: none; cursor: pointer; }
  .cfg-ctrl input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; }
  .cmd-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .link-btn { background: none; border: none; color: var(--vscode-textLink-foreground, #4daafc); cursor: pointer; font-size: 12px; padding: 6px 0; text-align: left; }
  .link-btn:hover { text-decoration: underline; }
  /* Aba Status */
  .st-overall { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .st-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
  .st-comp { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; margin: 5px 0; }
  .st-comp-status { font-size: 11px; opacity: .85; }
  .st-inc { border-left: 3px solid var(--warn); padding: 4px 0 4px 9px; margin: 8px 0; }
  .st-inc.major, .st-inc.critical { border-left-color: var(--err); }
  .st-inc-name { font-size: 12.5px; font-weight: 600; }
  .st-inc-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .st-recent { font-size: 11.5px; color: var(--vscode-descriptionForeground); margin: 3px 0; }
  /* cores por estado */
  .stc-ok { color: var(--ok); } .stc-warn { color: var(--warn); } .stc-err { color: var(--err); }
  .bgc-ok { background: var(--ok); } .bgc-warn { background: var(--warn); } .bgc-err { background: var(--err); }
</style>
</head>
<body>
  <div id="app"><div class="empty">${loc.waiting}</div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  // Strings já traduzidas (idioma ativo do VS Code), injetadas pelo host.
  const L = ${JSON.stringify(loc)};
  const colorVar = { ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)' };
  let curStyle = 'ring';
  let updatedAtMs = null; // última atualização efetiva (epoch ms)
  let lastData = null;    // último PanelData recebido (p/ re-render ao trocar de aba)
  // Aba ativa persistida entre recriações da view.
  const persisted = (vscode.getState && vscode.getState()) || {};
  let activeTab = persisted.activeTab || 'sessao';

  // Schema dos settings para a aba Config (key, label, tipo, opções).
  const SETTINGS_SCHEMA = [
    { section: L.sec.appearance, items: [
      { key: 'ringTheme', label: L.cfg.ringTheme, type: 'enum', options: ['semaforo','claude','mono','custom'] },
      { key: 'ringColor', label: L.cfg.ringColor, type: 'color' },
      { key: 'barStyle', label: L.cfg.barStyle, type: 'enum', options: ['ring','bar','number','icon'] },
      { key: 'alignment', label: L.cfg.alignment, type: 'enum', options: ['right','left'] },
      { key: 'priority', label: L.cfg.priority, type: 'number' },
    ]},
    { section: L.sec.source, items: [
      { key: 'useOAuthUsage', label: L.cfg.useOAuthUsage, type: 'bool' },
      { key: 'oauthRefreshSeconds', label: L.cfg.oauthRefreshSeconds, type: 'number' },
      { key: 'ccusageCommand', label: L.cfg.ccusageCommand, type: 'string' },
      { key: 'ccusageRefreshSeconds', label: L.cfg.ccusageRefreshSeconds, type: 'number' },
      { key: 'stateFilePath', label: L.cfg.stateFilePath, type: 'string' },
      { key: 'staleAfterSeconds', label: L.cfg.staleAfterSeconds, type: 'number' },
    ]},
    { section: L.sec.account, items: [
      { key: 'accountType', label: L.cfg.accountType, type: 'enum', options: ['auto','subscription','api'] },
      { key: 'mode', label: L.cfg.mode, type: 'enum', options: ['auto','subscriber','cost'] },
      { key: 'costCapUsd', label: L.cfg.costCapUsd, type: 'number' },
      { key: 'sessionTokenCap', label: L.cfg.sessionTokenCap, type: 'number' },
      { key: 'intenseTokensPerMin', label: L.cfg.intenseTokensPerMin, type: 'number' },
    ]},
    { section: L.sec.alerts, items: [
      { key: 'burnRateAlertEnabled', label: L.cfg.burnRateAlertEnabled, type: 'bool' },
      { key: 'burnRateMaxPerHour', label: L.cfg.burnRateMaxPerHour, type: 'number' },
      { key: 'alertCooldownMinutes', label: L.cfg.alertCooldownMinutes, type: 'number' },
      { key: 'colorByProjection', label: L.cfg.colorByProjection, type: 'bool' },
      { key: 'resetWarningMinutes', label: L.cfg.resetWarningMinutes, type: 'number' },
      { key: 'lowQuotaThreshold', label: L.cfg.lowQuotaThreshold, type: 'number' },
      { key: 'blockSummaryEnabled', label: L.cfg.blockSummaryEnabled, type: 'bool' },
      { key: 'warnThreshold', label: L.cfg.warnThreshold, type: 'number' },
      { key: 'errorThreshold', label: L.cfg.errorThreshold, type: 'number' },
    ]},
    { section: L.sec.status, items: [
      { key: 'statusCheckEnabled', label: L.cfg.statusCheckEnabled, type: 'bool' },
      { key: 'statusBadgeEnabled', label: L.cfg.statusBadgeEnabled, type: 'bool' },
      { key: 'statusNotifyEnabled', label: L.cfg.statusNotifyEnabled, type: 'bool' },
      { key: 'statusRefreshSeconds', label: L.cfg.statusRefreshSeconds, type: 'number' },
    ]},
    { section: L.sec.export, items: [
      { key: 'exportStateEnabled', label: L.cfg.exportStateEnabled, type: 'bool' },
      { key: 'exportStatePath', label: L.cfg.exportStatePath, type: 'string' },
    ]},
  ];

  // Substitui {0} numa string-template (mesmo formato do vscode.l10n.t).
  function fmt(tpl, v) { return String(tpl).replace('{0}', v); }
  // "há Xs / Xmin / Xh" a partir de um epoch ms.
  function fmtSince(ms) {
    if (!ms) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return fmt(L.agoS, s);
    var m = Math.round(s / 60);
    if (m < 60) return fmt(L.agoMin, m);
    var h = Math.round(m / 60);
    return fmt(L.agoH, h);
  }
  // Atualiza só o texto do "atualizado há Xs" (chamado a cada 1s).
  function tickLastUpd() {
    var el = document.getElementById('lastUpd');
    if (el) el.textContent = updatedAtMs ? fmt(L.updated, fmtSince(updatedAtMs)) : '';
  }
  setInterval(tickLastUpd, 1000);

  function ringSvg(pct, level, centerLabel, centerSub, colorOverride) {
    const r = 70, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
    const off = c * (1 - p / 100);
    // Tema do anel: se há cor de override E o nível não é crítico, usa-a; senão
    // mantém o semáforo (cor por nível). No 'err' sempre fica vermelho.
    const col = (colorOverride && level !== 'err')
      ? colorOverride
      : (colorVar[level] || colorVar.ok);
    // Quebra o subtítulo no "·" em até 2 linhas pra não estourar sobre o anel.
    const subParts = String(centerSub || '').split('·').map(function(s){ return s.trim(); }).filter(Boolean);
    const subLines = subParts.length <= 1
      ? '<text x="90" y="106" text-anchor="middle" class="center-sub">' + (subParts[0] || '') + '</text>'
      : '<text x="90" y="104" text-anchor="middle" class="center-sub">' + subParts[0] +
        '</text><text x="90" y="118" text-anchor="middle" class="center-sub">' + subParts.slice(1).join(' · ') + '</text>';
    // Com 2 linhas, sobe um pouco o número pra centralizar o conjunto.
    const numY = subParts.length <= 1 ? 86 : 82;
    return \`
    <svg viewBox="0 0 180 180" style="width:min(180px,70%);height:auto">
      <circle cx="90" cy="90" r="\${r}" fill="none" stroke="var(--track)" stroke-width="14"/>
      <circle cx="90" cy="90" r="\${r}" fill="none" stroke="\${col}" stroke-width="14"
        stroke-linecap="round" stroke-dasharray="\${c}" stroke-dashoffset="\${off}"
        transform="rotate(-90 90 90)" style="transition: stroke-dashoffset .4s ease"/>
      <text x="90" y="\${numY}" text-anchor="middle" class="center-num" fill="var(--vscode-foreground)">\${centerLabel}</text>
      \${subLines}
    </svg>\`;
  }
  function styleButtons() {
    const opts = [['ring',L.styles.ring],['bar',L.styles.bar],['number',L.styles.number],['icon',L.styles.icon]];
    return '<div class="styles"><div class="styles-title">' + esc(L.stylesTitle) + '</div><div class="style-btns">' +
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
      const tip = (d.date || '') + ' · ' + fmt(L.tokens, fmtTok(d.tokens));
      return '<div class="spark-bar' + today + '" style="height:' + h + '%" title="' + tip + '"></div>';
    }).join('');
    // rótulos só nas pontas (primeiro e último dia), pra não poluir.
    const first = days[0].date || '';
    const last = days[days.length - 1].date || '';
    const labels = '<div class="spark-labels"><span>' + first.slice(5) +
      '</span><span>' + last.slice(5) + '</span></div>';
    return '<div class="spark"><div class="styles-title">' + esc(L.lastDays) + '</div>' +
      '<div class="spark-bars">' + bars + '</div>' + labels + '</div>';
  }
  const card = (inner, cls) =>
    '<div class="card' + (cls ? ' ' + cls : '') + '">' + inner + '</div>';
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  // Barra de uso (track + fill) com a regra de tema/semáforo.
  function bar(pct, ringOverride) {
    if (pct == null) return '';
    pct = Math.max(0, Math.min(100, pct));
    const lvl = pct >= 85 ? 'err' : pct >= 60 ? 'warn' : 'ok';
    const useOverride = ringOverride && lvl !== 'err';
    const fillCls = useOverride ? '' : ' bg-' + lvl;
    const fillStyle = 'width:' + pct + '%' + (useOverride ? ';background:' + ringOverride : '');
    return '<div class="track"><div class="fill' + fillCls + '" style="' + fillStyle + '"></div></div>';
  }

  // Card "Projetos nesta sessão" (#4): barras por projeto no bloco de 5h.
  function projectsCard(projects) {
    const list = (projects || []).filter(function(p){ return p && p.tokens > 0; });
    if (!list.length) return '';
    const max = Math.max.apply(null, list.map(function(p){ return p.tokens; }).concat([1]));
    const rows = list.map(function(p){
      const pct = (p.tokens / max) * 100;
      return '<div class="row"><div class="row-head"><span class="row-label">' + esc(p.project) +
        '</span><span class="row-val">' + fmtTok(p.tokens) + '</span></div>' + bar(pct, null) + '</div>';
    }).join('');
    return card('<div class="styles-title">' + esc(L.projectsTitle) + '</div>' + rows);
  }

  // Card "Fonte de dados": mostra a fonte ativa (oauth/statusline/ccusage) e,
  // no fallback, o motivo do oauth não entrar — fim do fallback silencioso.
  function sourceCard(src) {
    if (!src) return '';
    const cls = (src.kind === 'ccusage' || src.kind === 'none') ? 'stc-warn' : 'stc-ok';
    return card(
      '<div class="styles-title">' + esc(L.srcTitle) + '</div>' +
      '<div class="st-recent"><b>' + esc(L.srcActive) + ':</b> <span class="' + cls + '">' + esc(src.activeLabel) + '</span></div>' +
      '<div class="st-recent">' + esc(src.oauthLine) + '</div>' +
      '<div class="st-recent">' + esc(src.statuslineLine) + '</div>'
    );
  }

  // Aba Config: form de settings + comandos + link.
  function configTab(settings) {
    settings = settings || {};
    var html = '';
    SETTINGS_SCHEMA.forEach(function(sec){
      var inner = '<div class="cfg-section-title">' + sec.section + '</div>';
      sec.items.forEach(function(it){
        const val = settings[it.key];
        var ctrl = '';
        if (it.type === 'bool') {
          ctrl = '<input type="checkbox" data-key="' + it.key + '"' + (val ? ' checked' : '') + '>';
        } else if (it.type === 'number') {
          ctrl = '<input type="number" data-key="' + it.key + '" value="' + esc(val) + '">';
        } else if (it.type === 'enum') {
          ctrl = '<select data-key="' + it.key + '">' + it.options.map(function(o){
            return '<option value="' + o + '"' + (o === val ? ' selected' : '') + '>' + o + '</option>';
          }).join('') + '</select>';
        } else if (it.type === 'color') {
          const hex = (typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val)) ? val : '#4caf78';
          ctrl = '<input type="color" data-key="' + it.key + '" value="' + hex + '">';
        } else { // string
          ctrl = '<input type="text" data-key="' + it.key + '" value="' + esc(val) + '">';
        }
        inner += '<div class="cfg-row"><span class="cfg-label">' + it.label + '</span><span class="cfg-ctrl">' + ctrl + '</span></div>';
      });
      // Um card por seção (APARÊNCIA, FONTE E ATUALIZAÇÃO, …) — menos poluído.
      html += card(inner, 'controls');
    });
    // Comandos + link
    const cmds = '<div class="cfg-section-title">' + esc(L.cmdsTitle) + '</div><div class="cmd-btns">' +
      '<button class="sbtn" data-cmd="claudeUsageBar.refresh">' + esc(L.cmd.refresh) + '</button>' +
      '<button class="sbtn" data-cmd="claudeUsageBar.openState">' + esc(L.cmd.state) + '</button>' +
      '<button class="sbtn" data-cmd="claudeUsageBar.cycleStyle">' + esc(L.cmd.cycle) + '</button>' +
      '<button class="sbtn" data-cmd="claudeUsageBar.toggleAlert">' + esc(L.cmd.toggle) + '</button>' +
      '</div>' +
      '<button class="link-btn" id="openSettings">' + esc(L.openSettings) + '</button>';
    return html + card(cmds, 'controls');
  }

  // Mapeia status de componente Statuspage para cor (ok/warn/err).
  function stColor(status) {
    if (status === 'operational') return 'ok';
    if (status === 'major_outage' || status === 'critical') return 'err';
    return 'warn'; // degraded_performance, partial_outage, under_maintenance...
  }
  function stLabel(status) {
    return L.comp[status] || status;
  }
  function indicatorColor(ind) {
    if (ind === 'none') return 'ok';
    if (ind === 'major' || ind === 'critical') return 'err';
    return 'warn';
  }
  // Traduções dos rótulos vindos da API (status.claude.com em inglês).
  function indicatorLabel(ind) {
    return L.indicator[ind] || ind;
  }
  function impactLabel(imp) {
    return L.impact[imp] || imp;
  }
  function incStatusLabel(st) {
    return L.incStatus[st] || st;
  }

  // Aba Status: status geral + componentes + incidentes + histórico.
  function statusTab(s) {
    if (!s) {
      return '<div class="empty">' + esc(L.st.disabled) + '</div>' +
        card('<button class="link-btn" id="openStatusPage">' + esc(L.st.openPage) + '</button>', 'controls');
    }
    const ic = indicatorColor(s.indicator);
    const dot = '<span class="st-dot bgc-' + ic + '"></span>';
    // Usa o rótulo traduzido pelo indicador (a description vem em inglês da API).
    let html = card(
      '<div class="st-overall">' + dot + '<span class="stc-' + ic + '">' + esc(indicatorLabel(s.indicator)) + '</span></div>'
    );
    // Incidentes ativos. O NOME e o corpo da atualização são texto livre da
    // Anthropic (ficam em inglês); impacto e status são traduzidos.
    if (s.incidents && s.incidents.length) {
      const inc = s.incidents.map(function(i){
        const cls = (i.impact === 'major' || i.impact === 'critical') ? ' major' : '';
        const upd = i.lastUpdate ? '<div class="st-inc-meta">' + esc(i.lastUpdate.slice(0,160)) + '</div>' : '';
        return '<div class="st-inc' + cls + '"><div class="st-inc-name">' + esc(i.name) + '</div>' +
          '<div class="st-inc-meta">' + esc(impactLabel(i.impact)) + ' · ' + esc(incStatusLabel(i.status)) + '</div>' + upd + '</div>';
      }).join('');
      html += card('<div class="styles-title">' + esc(L.st.incidents) + '</div>' + inc);
    }
    // Componentes
    if (s.components && s.components.length) {
      const comps = s.components.map(function(c){
        const col = stColor(c.status);
        return '<div class="st-comp"><span>' + esc(c.name) + '</span>' +
          '<span class="st-comp-status stc-' + col + '">' + esc(stLabel(c.status)) + '</span></div>';
      }).join('');
      html += card('<div class="styles-title">' + esc(L.st.components) + '</div>' + comps);
    }
    // Histórico recente (resolvidos)
    if (s.recent && s.recent.length) {
      const rec = s.recent.map(function(r){
        const d = r.resolvedAt ? r.resolvedAt.slice(0,10) : '';
        return '<div class="st-recent">✓ ' + esc(r.name) + (d ? ' · ' + d : '') + '</div>';
      }).join('');
      html += card('<div class="styles-title">' + esc(L.st.recent) + '</div>' + rec);
    }
    html += card('<button class="link-btn" id="openStatusPage">' + esc(L.st.openPage) + '</button>', 'controls');
    return html;
  }

  function tabsBar(statusIssue) {
    const tabs = [['sessao',L.tabs.sessao],['historico',L.tabs.historico],['status',L.tabs.status],['config',L.tabs.config]];
    return '<div class="tabs">' + tabs.map(function(t){
      const badge = (t[0]==='status' && statusIssue) ? ' ⚠' : '';
      return '<button class="tab' + (t[0]===activeTab?' active':'') + '" data-tab="' + t[0] + '">' + t[1] + badge + '</button>';
    }).join('') + '</div>';
  }

  function render(d, force) {
    if (!d) { d = lastData; if (!d) return; }
    lastData = d;
    // Na aba Config NÃO reconstruímos o conteúdo a cada atualização de dados
    // vinda da extensão (ticks de ccusage/oauth/status ou o "eco" do próprio
    // setConfig que acabou de salvar). Recriar o formulário apagaria o que o
    // usuário está digitando/marcando e tiraria o foco do campo — dando a falsa
    // impressão de que as configurações "não salvam". O form é (re)montado só
    // ao ENTRAR na aba (force=true, vindo do clique na aba); enquanto ela está
    // aberta apenas guardamos os dados novos em lastData (já feito acima) e os
    // reaplicamos quando o usuário troca de aba e volta. Se o form ainda não
    // está na tela (1ª montagem), deixamos renderizar normalmente.
    if (activeTab === 'config' && !force && document.querySelector('[data-key]')) {
      return;
    }
    if (d.barStyle) curStyle = d.barStyle;
    if (d.updatedAtMs) updatedAtMs = d.updatedAtMs;
    const ringOverride = d.ringColorOverride || null;

    const header =
      '<div class="header"><span class="title">' + esc(L.title) + '</span>' +
      '<div class="header-right">' +
      '<span id="lastUpd" class="last-upd"></span>' +
      '<button id="refreshBtn" class="refresh" title="' + esc(L.refresh) + '" aria-label="' + esc(L.refresh) + '"><span class="ic">↻</span></button>' +
      '</div></div>';

    // Alerta sempre visível (qualquer aba), pois é importante.
    let alertHtml = '';
    if (d.alert) {
      const extra = (d.alert.reasons || []).slice(1)
        .map(function(r){ return '<div class="alert-reason">· ' + esc(r) + '</div>'; }).join('');
      const sev = d.alert.severity === 'err' ? '' : ' warn';
      alertHtml = '<div class="alert' + sev + '"><div class="alert-title">⚠ ' + esc(d.alert.message) + '</div>' + extra + '</div>';
    }

    let body = '';
    if (activeTab === 'sessao') {
      const rows = (d.rows || []).map(function(row) {
        const pct = row.pct == null ? null : Math.max(0, Math.min(100, row.pct));
        return '<div class="row"><div class="row-head"><span class="row-label">' + esc(row.label) +
          '</span><span class="row-val">' + esc(row.value) + '</span></div>' + bar(pct, ringOverride) + '</div>';
      }).join('');
      body = card('<div class="ring-wrap">' +
        ringSvg(d.ringPct, d.level, d.centerLabel, d.centerSub, ringOverride) +
        '</div>' + rows) + sourceCard(d.source);
    } else if (activeTab === 'historico') {
      const sparkHtml = sparkline(d.daily);
      body = (sparkHtml ? card(sparkHtml) : '') + projectsCard(d.projects);
      if (!body) body = '<div class="empty">' + esc(L.noHistory) + '</div>';
    } else if (activeTab === 'status') {
      body = statusTab(d.status);
    } else if (activeTab === 'config') {
      const alertEnabled = d.alertEnabled !== false;
      const styleCard = card(styleButtons());
      const toggle = card(
        '<div class="toggle-row"><span class="toggle-label">' + esc(L.alertLabel) + '</span>' +
        '<button id="alertToggle" class="toggle ' + (alertEnabled ? 'on' : 'off') + '">' +
        (alertEnabled ? L.alertOn : L.alertOff) + '</button></div>', 'controls');
      body = styleCard + toggle + configTab(d.settings);
    }

    // Badge ⚠ na aba Status quando há incidente/degradação.
    const statusIssue = !!(d.status && (d.status.indicator !== 'none' ||
      (d.status.incidents && d.status.incidents.length)));
    document.getElementById('app').innerHTML =
      header + alertHtml + tabsBar(statusIssue) + body +
      '<div class="footer">' + esc(d.footer || '') + '</div>';
    tickLastUpd();
    wireEvents();
  }

  // (Re)liga todos os event listeners após cada render.
  function wireEvents() {
    document.querySelectorAll('.tab').forEach(function(t){
      t.addEventListener('click', function(){
        activeTab = t.getAttribute('data-tab');
        if (vscode.setState) vscode.setState({ activeTab: activeTab });
        // force=true: trocar de aba SEMPRE (re)monta o conteúdo, inclusive o
        // formulário da Config com os valores já salvos/atualizados.
        render(lastData, true);
      });
    });
    document.querySelectorAll('.sbtn[data-style]').forEach(function(b){
      b.addEventListener('click', function(){
        curStyle = b.getAttribute('data-style');
        vscode.postMessage({ type: 'setStyle', style: curStyle });
        document.querySelectorAll('.sbtn[data-style]').forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active');
      });
    });
    document.querySelectorAll('.sbtn[data-cmd]').forEach(function(b){
      b.addEventListener('click', function(){
        vscode.postMessage({ type: 'runCommand', command: b.getAttribute('data-cmd') });
      });
    });
    const os = document.getElementById('openSettings');
    if (os) os.addEventListener('click', function(){ vscode.postMessage({ type: 'openSettings' }); });
    const sp = document.getElementById('openStatusPage');
    if (sp) sp.addEventListener('click', function(){ vscode.postMessage({ type: 'openStatusPage' }); });
    // controles de config
    document.querySelectorAll('[data-key]').forEach(function(el){
      const ev = (el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color') ? 'change' : 'change';
      el.addEventListener(ev, function(){
        const key = el.getAttribute('data-key');
        let value;
        if (el.type === 'checkbox') value = el.checked;
        else if (el.type === 'number') value = el.value === '' ? 0 : Number(el.value);
        else value = el.value;
        vscode.postMessage({ type: 'setConfig', key: key, value: value });
      });
    });
    const rb = document.getElementById('refreshBtn');
    if (rb) rb.addEventListener('click', function(){
      rb.classList.add('spinning');
      setTimeout(function(){ rb.classList.remove('spinning'); }, 600);
      var lu = document.getElementById('lastUpd');
      if (lu) { lu.textContent = L.updating; lu.classList.add('flash');
        setTimeout(function(){ lu.classList.remove('flash'); }, 1200); }
      vscode.postMessage({ type: 'refresh' });
    });
    const at = document.getElementById('alertToggle');
    if (at) at.addEventListener('click', function(){
      var on = at.classList.contains('on');
      at.classList.toggle('on', !on); at.classList.toggle('off', on);
      at.textContent = on ? L.alertOff : L.alertOn;
      vscode.postMessage({ type: 'toggleAlert' });
    });
  }

  window.addEventListener('message', function(e) {
    const m = e.data;
    if (m && m.type === 'data') {
      if (m.barStyle) m.data.barStyle = m.barStyle;
      render(m.data);
    }
  });
  // pede um render inicial assim que a view monta
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

function wireMessages(
  webview: vscode.Webview,
  onReady: () => void
): vscode.Disposable {
  const ALLOWED_CMDS = new Set([
    "claudeUsageBar.refresh",
    "claudeUsageBar.openState",
    "claudeUsageBar.cycleStyle",
    "claudeUsageBar.toggleAlert",
  ]);
  return webview.onDidReceiveMessage((msg) => {
    if (msg?.type === "setStyle" && typeof msg.style === "string") {
      vscode.commands.executeCommand("claudeUsageBar.setStyle", msg.style);
    } else if (msg?.type === "refresh") {
      vscode.commands.executeCommand("claudeUsageBar.refresh");
    } else if (msg?.type === "toggleAlert") {
      vscode.commands.executeCommand("claudeUsageBar.toggleAlert");
    } else if (msg?.type === "runCommand" && ALLOWED_CMDS.has(msg.command)) {
      vscode.commands.executeCommand(msg.command);
    } else if (msg?.type === "setConfig" && typeof msg.key === "string") {
      // Grava o setting alterado pela aba Config.
      vscode.workspace
        .getConfiguration("claudeUsageBar")
        .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    } else if (msg?.type === "openSettings") {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "claudeUsageBar"
      );
    } else if (msg?.type === "openStatusPage") {
      vscode.env.openExternal(vscode.Uri.parse("https://status.claude.com"));
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
  private msgDisposable?: vscode.Disposable;
  /** Chamado quando a webview sinaliza que montou e quer dados. */
  public onReady?: () => void;
  /** Chamado quando a view fica visível (revelada/reaberta) — p/ refazer fetch. */
  public onVisible?: () => void;

  constructor() {
    UsageViewProvider.current = this;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    // Quando a view volta a ficar visível (reabrir o painel, trocar de aba na
    // Activity Bar e voltar), refaz o fetch p/ não mostrar dado velho.
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.onVisible?.();
      }
    });
    // Descarta listener anterior se a view for recriada (troca de aba na
    // Activity Bar destrói e recria a webview) — evita handlers órfãos.
    this.msgDisposable?.dispose();
    this.msgDisposable = wireMessages(view.webview, () => {
      // Webview montou e pediu dados: envia o último estado conhecido.
      if (this.last) {
        view.webview.postMessage({
          type: "data",
          data: this.last.data,
          barStyle: this.last.barStyle,
        });
      }
      this.onReady?.();
    });
    // NÃO postar data aqui — o webview ainda não montou o listener; ele pede
    // via {type:'ready'} e respondemos acima. Postar antes se perde.
    view.webview.html = panelHtml();
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
