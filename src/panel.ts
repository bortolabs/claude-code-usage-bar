import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { tr } from "./i18n";

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
  /** Histórico de uso dos últimos dias para os sparklines (pode ser vazio). */
  daily: { date: string; tokens: number; costUSD: number }[];
  /**
   * Custos (≈ aproximado): hoje/mês vêm do ccusage (números oficiais); a quebra
   * por modelo vem da tabela de preços local (atribuição, sempre aproximada).
   */
  cost?: {
    isSub: boolean;
    today: number;
    monthToDate: number;
    monthProjected: number;
    budgetUsd: number;
    overBudget: boolean;
    byModel: { model: string; tokens: number; costUSD: number }[];
    byProject: { project: string; tokens: number; costUSD: number }[];
    byContextBucket: { bucket: string; tokens: number; costUSD: number; turns: number }[];
    byMcpServer: { name: string; calls: number }[];
    bySubagent: { name: string; calls: number }[];
    tips: { id: string; level: "warn" | "info"; values: Record<string, string | number> }[];
    tableVersion: string | null;
    /** Janela ativa das quebras (p/ destacar o seletor e rotular os cards). */
    window: "5h" | "today" | "7d" | "30d";
    /** Se a análise de transcripts (custos) está ligada na Config. */
    insightsEnabled: boolean;
  };
  /** Valores atuais dos settings (key → valor) para a aba Config. */
  settings: Record<string, unknown>;
  /** Idioma ativo do plugin (globalState): auto/pt/en/es/fr/de. */
  lang?: string;
  /** Placeholders (caminho/comando efetivo) p/ campos vazios na Config. */
  placeholders?: Record<string, string>;
  /** Créditos discretos no rodapé da aba Sessão (versão + repo). */
  credits?: { version: string };
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
    waiting: tr("Aguardando dados do Claude Code…"),
    title: tr("Claude Usage"),
    refresh: tr("Atualizar"),
    openDashboard: tr("Abrir dashboard"),
    exportHtml: tr("Exportar HTML"),
    dashboardTitle: tr("Dashboard de uso do Claude"),
    exportedAt: tr("Gerado em {0}"),
    updating: tr("atualizando…"),
    updated: tr("atualizado {0}"),
    agoS: tr("há {0}s"),
    agoMin: tr("há {0}min"),
    agoH: tr("há {0}h"),
    tabs: {
      sessao: tr("Sessão"),
      historico: tr("Histórico"),
      custos: tr("Custos"),
      status: tr("Status"),
      config: tr("Config"),
    },
    stylesTitle: tr("Estilo na status bar"),
    styles: {
      ring: tr("◕ anel"),
      bar: tr("▰ barra"),
      number: tr("% número"),
      icon: tr("⚡ ícone"),
    },
    lastDays: tr("Últimos dias"),
    tokens: tr("{0} tokens"),
    projectsTitle: tr("Projetos nesta sessão (5h)"),
    noHistory: tr("Sem histórico ainda."),
    cost: {
      title: tr("Custos"),
      daily: tr("Por dia"),
      perDay: tr("Custo por dia"),
      perDayTokens: tr("Tokens por dia"),
      window: tr("Janela das quebras"),
      today: tr("Hoje"),
      month: tr("Mês até agora"),
      projected: tr("Projeção do mês"),
      budget: tr("Orçamento"),
      byModel: tr("Por modelo"),
      byProject: tr("Por projeto"),
      byContext: tr("Por tamanho de contexto"),
      byContextHelp: tr("Turnos com mais contexto custam mais por resposta — /compact ajuda a enxugar."),
      counts: tr("MCP e subagentes"),
      mcp: tr("Servidores MCP"),
      subagents: tr("Subagentes"),
      calls: tr("{0}×"),
      turns: tr("{0} turnos"),
      perTurn: tr("{0}/turno"),
      countsHelp: tr("Contagem de chamadas — não dá pra atribuir tokens a um tool isolado do turno."),
      empty: tr("Sem dados de custo ainda."),
      emptyWindow: tr("Sem dados nesta janela. Tente 7d ou 30d acima."),
      offHint: tr("Ative \"Analisar transcripts (custos)\" na Config pra ver as quebras."),
      equiv: tr("equiv."),
      approxNote: tr("≈ aproximado · local, sem chamada externa"),
      subNote: tr("sua assinatura cobre — equivalente de API (≈ aproximado)"),
      tableV: tr("tabela v{0}"),
      tips: {
        title: tr("Dicas"),
        none: tr("Sem dicas agora — uso equilibrado. 👍"),
        context: tr("Contexto grande (>150k) puxa ~{0}% do custo. Use /compact ou abra sessões novas pra tarefas separadas."),
        cacheRead: tr("~{0}% dos tokens são releitura de contexto (cache). Sessões muito longas relendo tudo — /compact ajuda."),
        opus: tr("Opus concentra ~{0}% do custo. Pra tarefas leves, Sonnet/Haiku cortam bastante."),
        mcp: tr("O servidor MCP \"{0}\" foi chamado {1}×. Vale conferir chamadas redundantes."),
        subagents: tr("Subagentes puxam ~{0}% do custo. Úteis, mas pesados — avalie reduzir o fan-out."),
      },
    },
    sec: {
      language: tr("Idioma"),
      appearance: tr("Aparência"),
      source: tr("Fonte e atualização"),
      account: tr("Conta e limites"),
      alerts: tr("Alertas e cores"),
      tips: tr("Dicas de custo"),
      status: tr("Status da Anthropic"),
      export: tr("Exportar uso (p/ agentes/scripts)"),
      aiAdvice: tr("AI advice (coaching por IA)"),
    },
    cfg: {
      ringTheme: tr("Tema do anel"),
      ringColor: tr("Cor do anel (mono/custom)"),
      barStyle: tr("Estilo na status bar"),
      statusBarValue: tr("Valor na status bar"),
      monthlyBudgetUsd: tr("Orçamento mensal (USD)"),
      monthlyBudgetAlertEnabled: tr("Alerta de orçamento mensal"),
      insightsEnabled: tr("Analisar transcripts (custos)"),
      langHelp: tr("Idioma de todo o plugin (painel, status bar, alertas). 🌐 = segue o VS Code. Os rótulos na tela de Settings do VS Code seguem o idioma do VS Code."),
      tipsHelp: tr("Quando cada dica dispara. Valores maiores = menos dicas (mais conservador). Padrões: 25/70/70/40/40."),
      tipsContextBigPct: tr("Dica: contexto grande (% custo)"),
      tipsCacheReadPct: tr("Dica: cache-read (% input)"),
      tipsOpusPct: tr("Dica: Opus (% custo)"),
      tipsMcpCalls: tr("Dica: MCP (chamadas)"),
      tipsSubagentPct: tr("Dica: subagentes (% custo)"),
      alignment: tr("Lado da status bar"),
      priority: tr("Prioridade na status bar"),
      useOAuthUsage: tr("Usar cota real (oauth/usage)"),
      oauthRefreshSeconds: tr("Atualizar oauth (s)"),
      ccusageCommand: tr("Comando ccusage"),
      ccusageRefreshSeconds: tr("Atualizar ccusage (s)"),
      stateFilePath: tr("Arquivo de estado (statusline)"),
      staleAfterSeconds: tr("Statusline fresca por (s)"),
      accountType: tr("Tipo de conta"),
      mode: tr("Modo de exibição"),
      costCapUsd: tr("Teto de custo (USD)"),
      sessionTokenCap: tr("Teto de tokens/sessão"),
      intenseTokensPerMin: tr("Ritmo intenso (tok/min)"),
      burnRateAlertEnabled: tr("Alerta de burn rate"),
      burnRateMaxPerHour: tr("Limite de ritmo ($/h)"),
      alertCooldownMinutes: tr("Cooldown do alerta (min)"),
      colorByProjection: tr("Colorir por projeção"),
      resetWarningMinutes: tr("Aviso de fim de janela (min)"),
      lowQuotaThreshold: tr("Avisar cota baixa (% restante)"),
      blockSummaryEnabled: tr("Resumo ao fechar o bloco"),
      warnThreshold: tr("Limiar amarelo (%)"),
      errorThreshold: tr("Limiar vermelho (%)"),
      statusCheckEnabled: tr("Monitorar status"),
      statusBadgeEnabled: tr("Badge na status bar"),
      statusNotifyEnabled: tr("Notificar incidentes"),
      statusRefreshSeconds: tr("Atualizar status (s)"),
      exportStateEnabled: tr("Gravar uso em arquivo JSON"),
      exportStatePath: tr("Caminho do arquivo (vazio = padrão)"),
      exportHelp: tr("JSON com seu uso atual (cota restante, fonte), atualizado sempre — pra um agente/script ler e, por ex., parar quando a cota ficar baixa."),
      aiAdviceHelp: tr("Relatório de coaching por IA (opt-in, BYO key). Use um preset abaixo, defina a chave e gere. A chave fica no cofre seguro (SecretStorage), separada da assinatura."),
      aiAdviceApiStyle: tr("Estilo da API (anthropic/openai)"),
      aiAdviceEndpoint: tr("Endpoint (vazio = Anthropic)"),
      aiAdviceModel: tr("Modelo (vazio = claude-opus-4-8)"),
      aiAdvicePromptWindowDays: tr("Amostra de prompts: janela (dias)"),
      aiAdviceMaxPrompts: tr("Amostra de prompts: máximo"),
    },
    srcTitle: tr("Fonte de dados"),
    srcActive: tr("Fonte ativa"),
    cmdsTitle: tr("Comandos"),
    cmd: {
      refresh: tr("↻ Atualizar"),
      state: tr("Arquivo de estado"),
      cycle: tr("Alternar estilo"),
      toggle: tr("Liga/desliga alerta"),
    },
    aiAdvice: {
      presetsTitle: tr("Presets"),
      setKey: tr("Definir chave"),
      run: tr("Gerar AI advice"),
    },
    openSettings: tr("Abrir settings.json (claudeUsageBar) →"),
    pickFile: tr("Escolher arquivo…"),
    alertLabel: tr("Alerta de burn rate"),
    alertOn: tr("🔔 Ligado"),
    alertOff: tr("🔕 Desligado"),
    on: tr("Ligado"),
    off: tr("Desligado"),
    st: {
      disabled: tr("Verificação de status desligada ou indisponível."),
      openPage: tr("Abrir status.claude.com →"),
      incidents: tr("Incidentes ativos"),
      components: tr("Componentes"),
      recent: tr("Resolvidos recentemente"),
    },
    comp: {
      operational: tr("operacional"),
      degraded_performance: tr("degradado"),
      partial_outage: tr("instável"),
      major_outage: tr("fora do ar"),
      under_maintenance: tr("manutenção"),
    },
    indicator: {
      none: tr("Todos os sistemas operacionais"),
      minor: tr("Interrupção menor"),
      major: tr("Interrupção significativa"),
      critical: tr("Interrupção crítica"),
      maintenance: tr("Em manutenção"),
    },
    impact: {
      none: tr("sem impacto"),
      minor: tr("impacto menor"),
      major: tr("impacto alto"),
      critical: tr("crítico"),
      maintenance: tr("manutenção"),
    },
    incStatus: {
      investigating: tr("investigando"),
      identified: tr("identificado"),
      monitoring: tr("monitorando"),
      resolved: tr("resolvido"),
      scheduled: tr("agendado"),
      in_progress: tr("em andamento"),
      verifying: tr("verificando"),
      completed: tr("concluído"),
    },
  };
}

type PanelMode = "sidebar" | "dashboard";

/**
 * HTML compartilhado entre a view da sidebar, o dashboard (WebviewPanel) e o
 * export estático (.html aberto no navegador).
 * - mode 'sidebar' (default): comportamento original, abas, sem regressão.
 * - mode 'dashboard': sem abas, todas as seções num grid responsivo.
 * - staticData presente: variante autocontida (dados embutidos, sem VS Code,
 *   com fallback de tema e sem elementos interativos via .needs-host).
 */
function panelHtml(opts?: {
  mode?: PanelMode;
  staticData?: PanelData;
  generatedAt?: string;
}): string {
  const mode: PanelMode = opts?.mode ?? "sidebar";
  const isDash = mode === "dashboard";
  const staticData = opts?.staticData ?? null;
  const isExport = !!staticData;
  const generatedAt = opts?.generatedAt ?? "";
  const nonce = String(Date.now()) + "x";
  const loc = panelStrings();
  // Fora do VS Code (export aberto no navegador) as variáveis --vscode-* não
  // resolvem. Definimos um tema escuro padrão cobrindo as usadas no <style>.
  const themeFallback = isExport
    ? `:root {
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
      --vscode-input-background: #2a2a2a;
      --vscode-input-foreground: #dddddd;
      --vscode-input-border: #444444;
      --vscode-textLink-foreground: #4daafc;
    }
    body { background: #1e1e1e; }`
    : "";
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  ${themeFallback}
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
  /* Créditos discretos (versão + repo) no rodapé da aba Sessão. */
  .credits { margin-top: 6px; font-size: 10px; color: var(--vscode-descriptionForeground); opacity: .65; text-align: center; }
  .credits a { color: inherit; text-decoration: none; }
  .credits a:hover { text-decoration: underline; opacity: 1; }
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
  .spark-bar:hover { opacity: 1; outline: 1px solid var(--vscode-focusBorder); }
  .spark-labels { display: flex; justify-content: space-between; font-size: 9.5px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
  /* Tooltip flutuante das barras (o title nativo não renderiza neste webview). */
  .spark-tip {
    position: fixed; z-index: 1000; pointer-events: none; display: none;
    background: var(--vscode-editorHoverWidget-background, #252526);
    color: var(--vscode-editorHoverWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
    border-radius: 4px; padding: 3px 7px; font-size: 11px;
    white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.35);
  }
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
  .tabs { display: flex; flex-wrap: wrap; gap: 2px 4px; margin: 4px 0 12px; border-bottom: 1px solid var(--track); }
  .tab {
    font-family: var(--vscode-font-family); font-size: 12px;
    padding: 6px 8px; cursor: pointer; border: none; background: none;
    color: var(--vscode-descriptionForeground); border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover { color: var(--vscode-foreground); }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--ok); }
  /* Dashboard (WebviewPanel / export): sem abas, tudo num grid responsivo. */
  body.mode-dashboard { padding: 18px 24px; }
  .mode-dashboard .tabs { display: none; }
  .mode-dashboard .tabs-wrap {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 16px; align-items: start; max-width: 1500px; margin: 8px auto 0;
  }
  .mode-dashboard .dash-sec { min-width: 0; }
  .mode-dashboard .dash-sec-title {
    font-size: 12px; text-transform: uppercase; letter-spacing: .5px;
    font-weight: 600; color: var(--vscode-foreground); margin: 0 0 8px;
  }
  .mode-dashboard .header, .mode-dashboard .alert,
  .mode-dashboard .footer { max-width: 1500px; margin-left: auto; margin-right: auto; }
  /* Some no export (.html no navegador): tudo que depende do host VS Code. */
  .is-export .needs-host { display: none !important; }
  /* Form de configurações */
  .cfg-section-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); margin: 14px 0 6px; }
  /* Título da seção quando é o 1º item do próprio card (1 card por seção). */
  .card > .cfg-section-title:first-child { margin-top: 2px; }
  /* Seções colapsáveis (<details>/<summary>) na Config. */
  details.cfg-sec { display: block; }
  .cfg-summary { margin: 2px 0 6px; cursor: pointer; list-style: none; user-select: none; outline: none; }
  .cfg-summary::-webkit-details-marker { display: none; }
  .cfg-summary::before { content: '▸'; display: inline-block; width: 12px; margin-right: 2px; font-size: 10px; opacity: .65; transition: transform .15s; }
  details.cfg-sec[open] > .cfg-summary::before { transform: rotate(90deg); }
  .cfg-summary:hover { color: var(--vscode-foreground); }
  /* Cards de conteúdo colapsáveis (mesmo padrão <details>). */
  details.cardc { display: block; }
  details.cardc > summary { margin-bottom: 6px; }
  details.cardc:not([open]) > summary { margin-bottom: 0; }
  details.cardc[open] > .cfg-summary::before { transform: rotate(90deg); }
  .cfg-help-line { font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.45; margin: 0 0 8px; }
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
  /* Botão de seletor de arquivo nativo nos campos de caminho. */
  .pick-btn {
    font-family: var(--vscode-font-family); font-size: 12px; vertical-align: middle;
    margin-left: 4px; padding: 2px 6px; cursor: pointer; border-radius: 5px;
    border: 1px solid var(--vscode-input-border, #444);
    background: var(--vscode-button-secondaryBackground, #313131);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }
  .pick-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
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
<body class="${isDash ? "mode-dashboard" : ""}${isExport ? " is-export" : ""}">
  <div id="app"><div class="empty">${loc.waiting}</div></div>
<script nonce="${nonce}">
  // No webview do VS Code, acquireVsCodeApi existe; no .html exportado (browser)
  // não — então usamos um stub no-op pra não quebrar o script.
  const vscode = (typeof acquireVsCodeApi === 'function')
    ? acquireVsCodeApi()
    : { getState: function(){ return null; }, setState: function(){}, postMessage: function(){} };
  // Modo dashboard (grid, sem abas) e dados embutidos do export (ou null).
  const DASHBOARD = ${isDash ? "true" : "false"};
  const STATIC_DATA = ${staticData ? JSON.stringify(staticData) : "null"};
  const STATIC_GENERATED_AT = ${JSON.stringify(generatedAt)};
  const IS_EXPORT = !!STATIC_DATA;
  // Strings já traduzidas (idioma ativo do VS Code), injetadas pelo host.
  const L = ${JSON.stringify(loc)};
  const colorVar = { ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)' };
  let curStyle = 'ring';
  let curLang = 'auto'; // idioma ativo (p/ marcar a bandeira) — vem do globalState
  let updatedAtMs = null; // última atualização efetiva (epoch ms)
  let lastData = null;    // último PanelData recebido (p/ re-render ao trocar de aba)
  // Aba ativa persistida entre recriações da view.
  const persisted = (vscode.getState && vscode.getState()) || {};
  let activeTab = persisted.activeTab || 'sessao';
  // A aba "Histórico" foi removida (o conteúdo foi pra "Custos"). Migra quem
  // tinha ela ativa pra não cair numa aba inexistente.
  if (activeTab === 'historico') activeTab = 'custos';
  // Estado recolhido das seções da Config (id da seção → true = recolhido).
  let collapsed = persisted.collapsed || {};
  // Estado recolhido dos cards de conteúdo (id do card → true = recolhido).
  let cardCollapsed = persisted.cardc || {};
  // Dashboard: abre SEMPRE com todas as seções expandidas. Resetamos o estado
  // recolhido na 1ª render (o usuário ainda pode recolher durante a sessão).
  let dashInit = false;
  function saveState(){ if (vscode.setState) vscode.setState({ activeTab: activeTab, collapsed: collapsed, cardc: cardCollapsed }); }

  // Schema dos settings para a aba Config (key, label, tipo, opções).
  const SETTINGS_SCHEMA = [
    { id: 'appearance', section: L.sec.appearance, extra: 'style', items: [
      { key: 'ringTheme', label: L.cfg.ringTheme, type: 'enum', options: ['semaforo','claude','mono','custom'] },
      { key: 'ringColor', label: L.cfg.ringColor, type: 'color' },
      { key: 'statusBarValue', label: L.cfg.statusBarValue, type: 'enum', options: ['quota','today','session'] },
      { key: 'alignment', label: L.cfg.alignment, type: 'enum', options: ['right','left'] },
      { key: 'priority', label: L.cfg.priority, type: 'number' },
    ]},
    { id: 'source', section: L.sec.source, items: [
      { key: 'useOAuthUsage', label: L.cfg.useOAuthUsage, type: 'bool' },
      { key: 'oauthRefreshSeconds', label: L.cfg.oauthRefreshSeconds, type: 'number' },
      { key: 'ccusageCommand', label: L.cfg.ccusageCommand, type: 'string' },
      { key: 'ccusageRefreshSeconds', label: L.cfg.ccusageRefreshSeconds, type: 'number' },
      { key: 'stateFilePath', label: L.cfg.stateFilePath, type: 'string', pick: 'open' },
      { key: 'staleAfterSeconds', label: L.cfg.staleAfterSeconds, type: 'number' },
    ]},
    { id: 'account', section: L.sec.account, items: [
      { key: 'accountType', label: L.cfg.accountType, type: 'enum', options: ['auto','subscription','api'] },
      { key: 'mode', label: L.cfg.mode, type: 'enum', options: ['auto','subscriber','cost'] },
      { key: 'costCapUsd', label: L.cfg.costCapUsd, type: 'number' },
      { key: 'monthlyBudgetUsd', label: L.cfg.monthlyBudgetUsd, type: 'number' },
      { key: 'monthlyBudgetAlertEnabled', label: L.cfg.monthlyBudgetAlertEnabled, type: 'bool' },
      { key: 'insightsEnabled', label: L.cfg.insightsEnabled, type: 'bool' },
      { key: 'sessionTokenCap', label: L.cfg.sessionTokenCap, type: 'number' },
      { key: 'intenseTokensPerMin', label: L.cfg.intenseTokensPerMin, type: 'number' },
    ]},
    { id: 'alerts', section: L.sec.alerts, items: [
      { key: 'burnRateAlertEnabled', label: '🔥 ' + L.cfg.burnRateAlertEnabled, type: 'bool' },
      { key: 'burnRateMaxPerHour', label: L.cfg.burnRateMaxPerHour, type: 'number' },
      { key: 'alertCooldownMinutes', label: L.cfg.alertCooldownMinutes, type: 'number' },
      { key: 'colorByProjection', label: L.cfg.colorByProjection, type: 'bool' },
      { key: 'resetWarningMinutes', label: L.cfg.resetWarningMinutes, type: 'number' },
      { key: 'lowQuotaThreshold', label: L.cfg.lowQuotaThreshold, type: 'number' },
      { key: 'blockSummaryEnabled', label: L.cfg.blockSummaryEnabled, type: 'bool' },
      { key: 'warnThreshold', label: L.cfg.warnThreshold, type: 'number' },
      { key: 'errorThreshold', label: L.cfg.errorThreshold, type: 'number' },
    ]},
    { id: 'tips', section: L.sec.tips, help: L.cfg.tipsHelp, items: [
      { key: 'tipsContextBigPct', label: L.cfg.tipsContextBigPct, type: 'number' },
      { key: 'tipsCacheReadPct', label: L.cfg.tipsCacheReadPct, type: 'number' },
      { key: 'tipsOpusPct', label: L.cfg.tipsOpusPct, type: 'number' },
      { key: 'tipsMcpCalls', label: L.cfg.tipsMcpCalls, type: 'number' },
      { key: 'tipsSubagentPct', label: L.cfg.tipsSubagentPct, type: 'number' },
    ]},
    { id: 'status', section: L.sec.status, items: [
      { key: 'statusCheckEnabled', label: L.cfg.statusCheckEnabled, type: 'bool' },
      { key: 'statusBadgeEnabled', label: L.cfg.statusBadgeEnabled, type: 'bool' },
      { key: 'statusNotifyEnabled', label: L.cfg.statusNotifyEnabled, type: 'bool' },
      { key: 'statusRefreshSeconds', label: L.cfg.statusRefreshSeconds, type: 'number' },
    ]},
    { id: 'export', section: L.sec.export, help: L.cfg.exportHelp, items: [
      { key: 'exportStateEnabled', label: L.cfg.exportStateEnabled, type: 'bool' },
      { key: 'exportStatePath', label: L.cfg.exportStatePath, type: 'string', pick: 'save' },
    ]},
    { id: 'aiAdvice', section: L.sec.aiAdvice, help: L.cfg.aiAdviceHelp, extra: 'aiadvice', items: [
      { key: 'aiAdviceApiStyle', label: L.cfg.aiAdviceApiStyle, type: 'enum', options: ['anthropic','openai'] },
      { key: 'aiAdviceEndpoint', label: L.cfg.aiAdviceEndpoint, type: 'string' },
      { key: 'aiAdviceModel', label: L.cfg.aiAdviceModel, type: 'string' },
      { key: 'aiAdvicePromptWindowDays', label: L.cfg.aiAdvicePromptWindowDays, type: 'number' },
      { key: 'aiAdviceMaxPrompts', label: L.cfg.aiAdviceMaxPrompts, type: 'number' },
    ]},
    { id: 'language', section: L.sec.language, extra: 'lang', items: [] },
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
    // No export estático não há atualização ao vivo: mostra a hora de geração.
    if (IS_EXPORT) {
      var ex = document.getElementById('lastUpd');
      if (ex) ex.textContent = STATIC_GENERATED_AT ? fmt(L.exportedAt, STATIC_GENERATED_AT) : '';
      return;
    }
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
  // Bandeiras de idioma: troca o idioma de TODO o plugin (globalState).
  function langButtons() {
    const cur = curLang || 'auto';
    const opts = [['auto','🌐'],['pt','🇧🇷'],['en','🇺🇸'],['es','🇪🇸'],['fr','🇫🇷'],['de','🇩🇪']];
    return '<div class="styles"><div class="cfg-help-line">' + esc(L.cfg.langHelp) + '</div><div class="style-btns lang-row">' +
      opts.map(function(o){
        return '<button class="sbtn lang-btn' + (o[0]===cur?' active':'') + '" data-lang="' + o[0] + '" title="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div></div>';
  }
  // Presets do AI advice: autopreenchem style/endpoint/modelo num clique.
  var AI_PRESETS = {
    ollama: { style: 'openai', endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.1' },
    lmstudio: { style: 'openai', endpoint: 'http://localhost:1234/v1/chat/completions', model: '' },
    gemini: { style: 'openai', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash' },
    groq: { style: 'openai', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    anthropic: { style: 'anthropic', endpoint: '', model: 'claude-opus-4-8' },
  };
  function aiAdvicePresets() {
    var opts = [['ollama','Ollama'],['lmstudio','LM Studio'],['gemini','Gemini'],['groq','Groq'],['anthropic','Anthropic']];
    return '<div class="styles-title">' + esc(L.aiAdvice.presetsTitle) + '</div><div class="style-btns">' +
      opts.map(function(o){
        return '<button class="sbtn" data-aipreset="' + o[0] + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
  }
  function aiAdviceActions() {
    return '<div class="cmd-btns" style="margin-top:8px">' +
      '<button class="sbtn" data-cmd="claudeUsageBar.setAiAdviceKey">' + esc(L.aiAdvice.setKey) + '</button>' +
      '<button class="sbtn" data-cmd="claudeUsageBar.aiAdvice">' + esc(L.aiAdvice.run) + '</button>' +
      '</div>';
  }
  // Formata tokens curto pro tooltip da barra (ex: 12.3M, 84k).
  function fmtTok(n) {
    if (!n || n <= 0) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\\.0$/, '') + 'k';
    return String(n);
  }
  // Formata USD curto (mesma escala do host: $X.XX / $XX.X / $XXX).
  function fmtUsd(n) {
    var v = (typeof n === 'number' && isFinite(n)) ? n : 0;
    if (v >= 100) return '$' + v.toFixed(0);
    if (v >= 10) return '$' + v.toFixed(1);
    return '$' + v.toFixed(2);
  }
  // Sparkline genérico: fileira de barras verticais proporcionais a um valor/dia.
  // O último item (hoje) fica destacado. Sem itens, não renderiza nada.
  function sparkBars(daily, valueOf, fmtVal, title) {
    const days = (daily || []).filter(function(d){ return d && valueOf(d) != null; });
    if (!days.length) return '';
    const max = Math.max.apply(null, days.map(valueOf).concat([0.0001]));
    const bars = days.map(function(d, i) {
      const v = valueOf(d) || 0;
      const h = Math.max(2, Math.round((v / max) * 100));
      const today = i === days.length - 1 ? ' today' : '';
      const tip = (d.date || '') + ' · ' + fmtVal(v);
      return '<div class="spark-bar' + today + '" style="height:' + h + '%" data-tip="' + esc(tip) + '"></div>';
    }).join('');
    // rótulos só nas pontas (primeiro e último dia), pra não poluir.
    const first = days[0].date || '';
    const last = days[days.length - 1].date || '';
    const labels = '<div class="spark-labels"><span>' + first.slice(5) +
      '</span><span>' + last.slice(5) + '</span></div>';
    return '<div class="spark"><div class="styles-title">' + esc(title) + '</div>' +
      '<div class="spark-bars">' + bars + '</div>' + labels + '</div>';
  }
  // Sparkline de tokens/dia (aba Custos). Tooltip mostra o valor ABSOLUTO (nº cheio).
  function sparkline(daily) {
    return sparkBars(daily, function(d){ return d.tokens; },
      function(v){ return fmt(L.tokens, Math.round(v).toLocaleString()); }, L.cost.perDayTokens);
  }
  // Sparkline de custo/dia (aba Custos) — só renderiza se houver algum custo.
  // Tooltip mostra o custo absoluto do dia com centavos.
  function costSparkline(daily) {
    const any = (daily || []).some(function(d){ return d && d.costUSD > 0; });
    if (!any) return '';
    return sparkBars(daily, function(d){ return d.costUSD; },
      function(v){ return '$' + (v || 0).toFixed(2); }, L.cost.perDay);
  }
  // Rótulo curto da janela ativa das quebras ("5h"/"Hoje"/"7d"/"30d").
  function winLabel(win) {
    return win === 'today' ? L.cost.today : (win || '5h');
  }
  // Seletor da janela das quebras (botões estilo "feature"). Grava costWindow.
  function windowSelector(win) {
    const opts = [['5h','5h'],['today',L.cost.today],['7d','7d'],['30d','30d']];
    const cur = win || '5h';
    return '<div class="styles"><div class="styles-title">' + esc(L.cost.window) + '</div><div class="style-btns">' +
      opts.map(function(o){
        return '<button class="sbtn' + (o[0]===cur?' active':'') + '" data-costwin="' + o[0] + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div></div>';
  }
  const card = (inner, cls) =>
    '<div class="card' + (cls ? ' ' + cls : '') + '">' + inner + '</div>';
  // Card colapsável: o TÍTULO vira summary (clica p/ recolher/expandir) e o
  // estado é lembrado pelo id. Mesmo padrão das seções da Config.
  function collapsibleCard(id, title, body, cls) {
    const openAttr = cardCollapsed[id] ? '' : ' open';
    return '<details class="card cardc' + (cls ? ' ' + cls : '') + '" data-card="' + id + '"' + openAttr + '>' +
      '<summary class="styles-title cfg-summary">' + esc(title) + '</summary>' + body + '</details>';
  }
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

  // Linha simples rótulo/valor (sem barra) p/ os cards de custo.
  function kvRow(label, val) {
    return '<div class="row"><div class="row-head"><span class="row-label">' + esc(label) +
      '</span><span class="row-val">' + esc(val) + '</span></div></div>';
  }

  // Card "Custos": hoje / mês / projeção (números OFICIAIS do ccusage) + barra
  // de orçamento (só API). Em assinatura o $ é "equivalente API" (prefixo ~).
  function costCard(cost) {
    if (!cost) return '';
    if (!(cost.today > 0 || cost.monthToDate > 0)) return '';
    const sub = !!cost.isSub;
    const usd = function(n){ return (sub ? '~' : '') + fmtUsd(n); };
    var rows = kvRow(L.cost.today, usd(cost.today)) +
      kvRow(L.cost.month, usd(cost.monthToDate)) +
      kvRow(L.cost.projected, usd(cost.monthProjected));
    // Barra de orçamento: só faz sentido com $ real (API) e orçamento definido.
    if (!sub && cost.budgetUsd > 0) {
      const pct = Math.min(100, (cost.monthToDate / cost.budgetUsd) * 100);
      rows += '<div class="row"><div class="row-head"><span class="row-label">' + esc(L.cost.budget) +
        '</span><span class="row-val">' + esc(fmtUsd(cost.monthToDate) + ' / ' + fmtUsd(cost.budgetUsd)) +
        (cost.overBudget ? ' ⚠' : '') + '</span></div>' + bar(pct, null) + '</div>';
    }
    const note = sub ? L.cost.subNote : L.cost.approxNote;
    return collapsibleCard('costsum', L.cost.title,
      rows + '<div class="cfg-help-line">' + esc(note) + '</div>');
  }

  // Card "Por modelo": tokens + custo ≈ por modelo no bloco de 5h (tabela local).
  // A barra é proporcional ao custo. Sempre rotulado "≈ aproximado · tabela vX".
  function byModelCard(cost) {
    if (!cost || !cost.byModel || !cost.byModel.length) return '';
    const list = cost.byModel.filter(function(m){ return m && (m.costUSD > 0 || m.tokens > 0); });
    if (!list.length) return '';
    const sub = !!cost.isSub;
    const max = Math.max.apply(null, list.map(function(m){ return m.costUSD; }).concat([0.0001]));
    const rows = list.map(function(m){
      const pct = (m.costUSD / max) * 100;
      const val = fmtTok(m.tokens) + ' · ' + (sub ? '~' : '') + fmtUsd(m.costUSD) +
        (sub ? ' ' + L.cost.equiv : '');
      return '<div class="row"><div class="row-head"><span class="row-label">' + esc(m.model) +
        '</span><span class="row-val">' + esc(val) + '</span></div>' + bar(pct, null) + '</div>';
    }).join('');
    const ver = cost.tableVersion ? ' · ' + fmt(L.cost.tableV, cost.tableVersion) : '';
    return collapsibleCard('bymodel', L.cost.byModel + ' (' + winLabel(cost.window) + ')',
      rows + '<div class="cfg-help-line">' + esc(L.cost.approxNote + ver) + '</div>');
  }

  // Card "Por projeto" (custo ≈): supera o antigo projectsCard (que era só tokens).
  function projectsCostCard(cost) {
    const list = ((cost && cost.byProject) || []).filter(function(p){ return p && (p.costUSD > 0 || p.tokens > 0); });
    if (!list.length) return '';
    const sub = !!cost.isSub;
    const max = Math.max.apply(null, list.map(function(p){ return p.costUSD; }).concat([0.0001]));
    const rows = list.map(function(p){
      const pct = (p.costUSD / max) * 100;
      const val = fmtTok(p.tokens) + ' · ' + (sub ? '~' : '') + fmtUsd(p.costUSD) + (sub ? ' ' + L.cost.equiv : '');
      return '<div class="row"><div class="row-head"><span class="row-label">' + esc(p.project) +
        '</span><span class="row-val">' + esc(val) + '</span></div>' + bar(pct, null) + '</div>';
    }).join('');
    return collapsibleCard('byproject', L.cost.byProject + ' (' + winLabel(cost.window) + ')', rows);
  }

  // Barra dos buckets de contexto: tinge de warn os turnos com contexto grande.
  function bucketBar(pct, warn) {
    pct = Math.max(0, Math.min(100, pct));
    return '<div class="track"><div class="fill bg-' + (warn ? 'warn' : 'ok') + '" style="width:' + pct + '%"></div></div>';
  }

  // Card "Por tamanho de contexto": custo por faixa de contexto do turno (5h).
  function bucketsCard(cost) {
    const list = ((cost && cost.byContextBucket) || []).filter(function(b){ return b && b.turns > 0; });
    if (!list.length) return '';
    const sub = !!cost.isSub;
    const max = Math.max.apply(null, list.map(function(b){ return b.costUSD; }).concat([0.0001]));
    const rows = list.map(function(b){
      const big = (b.bucket === '150–200k' || b.bucket === '>200k');
      const pct = (b.costUSD / max) * 100;
      const perTurn = b.turns > 0 ? b.costUSD / b.turns : 0;
      // Custo total do bloco + custo médio POR TURNO (a métrica que mostra que
      // turnos com mais contexto custam mais por resposta).
      const val = fmt(L.cost.turns, b.turns) + ' · ' + (sub ? '~' : '') + fmtUsd(b.costUSD) +
        ' · ' + fmt(L.cost.perTurn, (sub ? '~' : '') + fmtUsd(perTurn));
      return '<div class="row"><div class="row-head"><span class="row-label">' + esc(b.bucket) +
        (big ? ' ⚠' : '') + '</span><span class="row-val">' + esc(val) + '</span></div>' + bucketBar(pct, big) + '</div>';
    }).join('');
    return collapsibleCard('buckets', L.cost.byContext + ' (' + winLabel(cost.window) + ')',
      rows + '<div class="cfg-help-line">' + esc(L.cost.byContextHelp) + '</div>');
  }

  // Card "MCP e subagentes": CONTAGEM de chamadas (sem custo — não dá pra atribuir).
  function countsCard(cost) {
    const mcp = ((cost && cost.byMcpServer) || []).filter(function(x){ return x && x.calls > 0; });
    const sub = ((cost && cost.bySubagent) || []).filter(function(x){ return x && x.calls > 0; });
    if (!mcp.length && !sub.length) return '';
    function listRows(arr) {
      return arr.map(function(x){
        return '<div class="st-comp"><span>' + esc(x.name) + '</span>' +
          '<span class="st-comp-status">' + esc(fmt(L.cost.calls, x.calls)) + '</span></div>';
      }).join('');
    }
    var html = '';
    if (mcp.length) html += '<div class="st-recent"><b>' + esc(L.cost.mcp) + '</b></div>' + listRows(mcp);
    if (sub.length) html += '<div class="st-recent"><b>' + esc(L.cost.subagents) + '</b></div>' + listRows(sub);
    html += '<div class="cfg-help-line">' + esc(L.cost.countsHelp) + '</div>';
    return collapsibleCard('counts', L.cost.counts + ' (' + winLabel(cost.window) + ')', html);
  }

  // Monta o texto localizado de uma dica a partir do id + values.
  function tipText(tp) {
    const t = L.cost.tips;
    const v = tp.values || {};
    switch (tp.id) {
      case 'context': return fmt(t.context, v.pct);
      case 'cacheRead': return fmt(t.cacheRead, v.pct);
      case 'opus': return fmt(t.opus, v.pct);
      case 'mcp': return String(t.mcp).replace('{0}', v.name).replace('{1}', v.calls);
      case 'subagents': return fmt(t.subagents, v.pct);
      default: return '';
    }
  }

  // Card "Dicas": lista heurística de economia (⚠ alerta / ℹ informativo).
  function tipsCard(cost) {
    if (!cost) return '';
    const tips = (cost.tips || []).filter(function(tp){ return tp && tipText(tp); });
    const rows = tips.length
      ? tips.map(function(tp){
          const icon = tp.level === 'warn' ? '⚠' : 'ℹ';
          return '<div class="st-recent">' + icon + ' ' + esc(tipText(tp)) + '</div>';
        }).join('')
      : '<div class="st-recent">' + esc(L.cost.tips.none) + '</div>';
    return collapsibleCard('tips', L.cost.tips.title, rows);
  }

  // Card "Fonte de dados": mostra a fonte ativa (oauth/statusline/ccusage) e,
  // no fallback, o motivo do oauth não entrar — fim do fallback silencioso.
  function sourceCard(src) {
    if (!src) return '';
    const cls = (src.kind === 'ccusage' || src.kind === 'none') ? 'stc-warn' : 'stc-ok';
    return collapsibleCard('source', L.srcTitle,
      '<div class="st-recent"><b>' + esc(L.srcActive) + ':</b> <span class="' + cls + '">' + esc(src.activeLabel) + '</span></div>' +
      '<div class="st-recent">' + esc(src.oauthLine) + '</div>' +
      '<div class="st-recent">' + esc(src.statuslineLine) + '</div>'
    );
  }

  // Aba Config: form de settings + comandos + link.
  function configTab(settings, placeholders) {
    settings = settings || {};
    placeholders = placeholders || {};
    var html = '';
    SETTINGS_SCHEMA.forEach(function(sec){
      var body = '';
      // Linha de ajuda da seção (ex.: o que é o "Exportar uso").
      if (sec.help) body += '<div class="cfg-help-line">' + esc(sec.help) + '</div>';
      // Aparência: os botões visuais de estilo entram aqui (em vez de dropdown).
      if (sec.extra === 'style') body += styleButtons();
      // Idioma: bandeiras que trocam o idioma de todo o plugin.
      if (sec.extra === 'lang') body += langButtons();
      // AI advice: presets que autopreenchem style/endpoint/modelo (antes dos campos).
      if (sec.extra === 'aiadvice') body += aiAdvicePresets();
      sec.items.forEach(function(it){
        const val = settings[it.key];
        var ctrl = '';
        if (it.type === 'bool') {
          // Booléano vira toggle (estilo "feature") em vez de checkbox.
          ctrl = '<button class="toggle ' + (val ? 'on' : 'off') + '" data-toggle="' + it.key + '">' +
            (val ? L.on : L.off) + '</button>';
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
          // Placeholder com o caminho/comando efetivo quando o campo está vazio.
          var ph = placeholders[it.key] ? ' placeholder="' + esc(placeholders[it.key]) + '"' : '';
          ctrl = '<input type="text" data-key="' + it.key + '" value="' + esc(val) + '"' + ph + '>';
          // Campos de caminho ganham um botão de seletor nativo (File > Abrir).
          if (it.pick) {
            ctrl += '<button class="pick-btn" data-pick="' + it.key +
              '" data-pick-mode="' + it.pick + '" title="' + esc(L.pickFile) + '">📁</button>';
          }
        }
        body += '<div class="cfg-row"><span class="cfg-label">' + it.label + '</span><span class="cfg-ctrl">' + ctrl + '</span></div>';
      });
      // AI advice: botões de ação (Definir chave / Gerar) depois dos campos.
      if (sec.extra === 'aiadvice') body += aiAdviceActions();
      // Um card por seção, colapsável (<details>), lembrando o estado.
      var openAttr = collapsed[sec.id] ? '' : ' open';
      html += '<details class="card controls cfg-sec" data-sec="' + sec.id + '"' + openAttr + '>' +
        '<summary class="cfg-section-title cfg-summary">' + sec.section + '</summary>' + body + '</details>';
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
      html += collapsibleCard('st-incidents', L.st.incidents, inc);
    }
    // Componentes
    if (s.components && s.components.length) {
      const comps = s.components.map(function(c){
        const col = stColor(c.status);
        return '<div class="st-comp"><span>' + esc(c.name) + '</span>' +
          '<span class="st-comp-status stc-' + col + '">' + esc(stLabel(c.status)) + '</span></div>';
      }).join('');
      html += collapsibleCard('st-components', L.st.components, comps);
    }
    // Histórico recente (resolvidos)
    if (s.recent && s.recent.length) {
      const rec = s.recent.map(function(r){
        const d = r.resolvedAt ? r.resolvedAt.slice(0,10) : '';
        return '<div class="st-recent">✓ ' + esc(r.name) + (d ? ' · ' + d : '') + '</div>';
      }).join('');
      html += collapsibleCard('st-recent', L.st.recent, rec);
    }
    html += card('<button class="link-btn" id="openStatusPage">' + esc(L.st.openPage) + '</button>', 'controls');
    return html;
  }

  function tabsBar(statusIssue) {
    const tabs = [['sessao',L.tabs.sessao],['custos',L.tabs.custos],['status',L.tabs.status],['config',L.tabs.config]];
    return '<div class="tabs">' + tabs.map(function(t){
      const badge = (t[0]==='status' && statusIssue) ? ' ⚠' : '';
      return '<button class="tab' + (t[0]===activeTab?' active':'') + '" data-tab="' + t[0] + '">' + t[1] + badge + '</button>';
    }).join('') + '</div>';
  }

  function render(d, force) {
    if (!d) { d = lastData; if (!d) return; }
    lastData = d;
    // No dashboard, garante tudo aberto ao montar (reseta só uma vez).
    if (DASHBOARD && !dashInit) { collapsed = {}; cardCollapsed = {}; dashInit = true; }
    // Na aba Config NÃO reconstruímos o conteúdo a cada atualização de dados
    // vinda da extensão (ticks de ccusage/oauth/status ou o "eco" do próprio
    // setConfig que acabou de salvar). Recriar o formulário apagaria o que o
    // usuário está digitando/marcando e tiraria o foco do campo — dando a falsa
    // impressão de que as configurações "não salvam". O form é (re)montado só
    // ao ENTRAR na aba (force=true, vindo do clique na aba); enquanto ela está
    // aberta apenas guardamos os dados novos em lastData (já feito acima) e os
    // reaplicamos quando o usuário troca de aba e volta. Se o form ainda não
    // está na tela (1ª montagem), deixamos renderizar normalmente.
    if (!force && document.querySelector('[data-key]')) {
      // Sidebar: na aba Config não reconstruímos a cada tick (apagaria edições).
      // Dashboard: a Config fica sempre montada; só protegemos se um campo dela
      // estiver focado (senão atualizamos as demais seções ao vivo normalmente).
      if (!DASHBOARD && activeTab === 'config') return;
      if (DASHBOARD && document.activeElement &&
          document.activeElement.closest &&
          document.activeElement.closest('[data-key]')) return;
    }
    if (d.barStyle) curStyle = d.barStyle;
    if (d.lang) curLang = d.lang;
    if (d.updatedAtMs) updatedAtMs = d.updatedAtMs;
    const ringOverride = d.ringColorOverride || null;

    // Botões de atalho (somem no export via .needs-host): abrir o dashboard
    // (só na sidebar) e exportar o .html (na sidebar e no dashboard).
    const openDashBtn = DASHBOARD ? '' :
      '<button id="openDashboardBtn" class="refresh needs-host" title="' + esc(L.openDashboard) + '" aria-label="' + esc(L.openDashboard) + '"><span class="ic">⛶</span></button>';
    const exportBtn =
      '<button id="exportHtmlBtn" class="refresh needs-host" title="' + esc(L.exportHtml) + '" aria-label="' + esc(L.exportHtml) + '"><span class="ic">⬇</span></button>';
    const header =
      '<div class="header"><span class="title">' + esc(DASHBOARD ? L.dashboardTitle : L.title) + '</span>' +
      '<div class="header-right">' +
      '<span id="lastUpd" class="last-upd"></span>' +
      openDashBtn + exportBtn +
      '<button id="refreshBtn" class="refresh needs-host" title="' + esc(L.refresh) + '" aria-label="' + esc(L.refresh) + '"><span class="ic">↻</span></button>' +
      '</div></div>';

    // Alerta sempre visível (qualquer aba), pois é importante.
    let alertHtml = '';
    if (d.alert) {
      const extra = (d.alert.reasons || []).slice(1)
        .map(function(r){ return '<div class="alert-reason">· ' + esc(r) + '</div>'; }).join('');
      const sev = d.alert.severity === 'err' ? '' : ' warn';
      alertHtml = '<div class="alert' + sev + '"><div class="alert-title">⚠ ' + esc(d.alert.message) + '</div>' + extra + '</div>';
    }

    // Conteúdo de uma seção/aba — reusado pela sidebar (1 por vez) e pelo
    // dashboard (todas num grid). 'force' propaga p/ o re-monte do form da Config.
    function tabBody(tab) {
      if (tab === 'sessao') {
        const rows = (d.rows || []).map(function(row) {
          const pct = row.pct == null ? null : Math.max(0, Math.min(100, row.pct));
          return '<div class="row"><div class="row-head"><span class="row-label">' + esc(row.label) +
            '</span><span class="row-val">' + esc(row.value) + '</span></div>' + bar(pct, ringOverride) + '</div>';
        }).join('');
        return card('<div class="ring-wrap">' +
          ringSvg(d.ringPct, d.level, d.centerLabel, d.centerSub, ringOverride) +
          '</div>' + rows) + sourceCard(d.source);
      }
      if (tab === 'custos') {
        // Aba dedicada: hoje/mês + custo/dia + tokens/dia + seletor + quebras + dicas.
        const c = d.cost;
        const hasStats = !!(c && (c.byModel.length || c.byProject.length ||
          c.byContextBucket.length || c.byMcpServer.length || c.bySubagent.length));
        const insightsOn = !!(c && c.insightsEnabled);
        const sparks = costSparkline(d.daily) + sparkline(d.daily);
        // O seletor de janela fica visível sempre que a análise está ligada —
        // mesmo com a janela ativa vazia — pra dar como trocar pra 7d/30d.
        var breakdowns = '';
        if (insightsOn) {
          breakdowns = windowSelector(c.window) + (hasStats
            ? byModelCard(c) + projectsCostCard(c) + bucketsCard(c) + countsCard(c) + tipsCard(c)
            : '<div class="empty">' + esc(L.cost.emptyWindow) + '</div>');
        } else if (c) {
          breakdowns = '<div class="empty">' + esc(L.cost.offHint) + '</div>';
        }
        var cb = costCard(c) + (sparks ? collapsibleCard('daily', L.cost.daily, sparks) : '') + breakdowns;
        return cb || ('<div class="empty">' + esc(L.cost.empty) + '</div>');
      }
      if (tab === 'status') return statusTab(d.status);
      if (tab === 'config') {
        // Os controles de estilo e do alerta de burn rate vivem dentro das
        // seções (Aparência / Alertas e cores) — sem cards standalone redundantes.
        return configTab(d.settings, d.placeholders);
      }
      return '';
    }

    let body;
    if (DASHBOARD) {
      // Sem abas: todas as seções num grid. No export a Config sai (interativa).
      var secs = IS_EXPORT ? ['sessao','custos','status'] : ['sessao','custos','status','config'];
      body = '<div class="tabs-wrap">' + secs.map(function(t){
        return '<section data-tab="' + t + '" class="dash-sec">' +
          '<div class="dash-sec-title">' + esc(L.tabs[t]) + '</div>' + tabBody(t) + '</section>';
      }).join('') + '</div>';
    } else {
      body = tabBody(activeTab);
    }

    // Badge ⚠ na aba Status quando há incidente/degradação.
    const statusIssue = !!(d.status && (d.status.indicator !== 'none' ||
      (d.status.incidents && d.status.incidents.length)));
    // Créditos discretos: na aba Sessão (sidebar) ou sempre no dashboard.
    var creditsHtml = '';
    if ((DASHBOARD || activeTab === 'sessao') && d.credits && d.credits.version) {
      creditsHtml = '<div class="credits">v' + esc(d.credits.version) +
        ' · <a href="#" id="openRepo">bortolabs/claude-code-usage-bar</a></div>';
    }
    document.getElementById('app').innerHTML =
      header + alertHtml + (DASHBOARD ? '' : tabsBar(statusIssue)) + body +
      '<div class="footer">' + esc(d.footer || '') + creditsHtml + '</div>';
    tickLastUpd();
    wireEvents();
  }

  // (Re)liga todos os event listeners após cada render.
  function wireEvents() {
    document.querySelectorAll('.tab').forEach(function(t){
      t.addEventListener('click', function(){
        activeTab = t.getAttribute('data-tab');
        saveState();
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
    // Seletor de janela das quebras (aba Custos): via comando dedicado (não o
    // setConfig genérico) — o host atualiza o valor de runtime na hora, recomputa
    // as stats na nova janela e devolve os dados (que re-renderizam os títulos).
    document.querySelectorAll('.sbtn[data-costwin]').forEach(function(b){
      b.addEventListener('click', function(){
        vscode.postMessage({ type: 'setCostWindow', value: b.getAttribute('data-costwin') });
        document.querySelectorAll('.sbtn[data-costwin]').forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active');
      });
    });
    // Bandeiras de idioma: gravam o setting language (o host troca o idioma de
    // TODO o plugin e remonta o painel).
    document.querySelectorAll('.sbtn[data-lang]').forEach(function(b){
      b.addEventListener('click', function(){
        curLang = b.getAttribute('data-lang');
        vscode.postMessage({ type: 'setLanguage', value: curLang });
        document.querySelectorAll('.sbtn[data-lang]').forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active');
      });
    });
    document.querySelectorAll('.sbtn[data-cmd]').forEach(function(b){
      b.addEventListener('click', function(){
        vscode.postMessage({ type: 'runCommand', command: b.getAttribute('data-cmd') });
      });
    });
    // Presets do AI advice: preenche os 3 campos (DOM + persiste via setConfig).
    document.querySelectorAll('.sbtn[data-aipreset]').forEach(function(b){
      b.addEventListener('click', function(){
        var p = AI_PRESETS[b.getAttribute('data-aipreset')];
        if (!p) return;
        var set = function(key, value){
          var el = document.querySelector('[data-key="' + key + '"]');
          if (el) el.value = value;
          vscode.postMessage({ type: 'setConfig', key: key, value: value });
        };
        set('aiAdviceApiStyle', p.style);
        set('aiAdviceEndpoint', p.endpoint);
        set('aiAdviceModel', p.model);
      });
    });
    const os = document.getElementById('openSettings');
    if (os) os.addEventListener('click', function(){ vscode.postMessage({ type: 'openSettings' }); });
    const sp = document.getElementById('openStatusPage');
    if (sp) sp.addEventListener('click', function(){ vscode.postMessage({ type: 'openStatusPage' }); });
    const rp = document.getElementById('openRepo');
    if (rp) rp.addEventListener('click', function(e){ e.preventDefault(); vscode.postMessage({ type: 'openRepo' }); });
    // Botões de seletor de arquivo nativo (campos de caminho).
    document.querySelectorAll('.pick-btn[data-pick]').forEach(function(b){
      b.addEventListener('click', function(){
        vscode.postMessage({ type: 'pickPath', key: b.getAttribute('data-pick'), mode: b.getAttribute('data-pick-mode') });
      });
    });
    // Toggles dos booléanos (estilo "feature" no lugar do checkbox).
    document.querySelectorAll('.toggle[data-toggle]').forEach(function(b){
      b.addEventListener('click', function(){
        var on = !b.classList.contains('on');
        b.classList.toggle('on', on); b.classList.toggle('off', !on);
        b.textContent = on ? L.on : L.off;
        vscode.postMessage({ type: 'setConfig', key: b.getAttribute('data-toggle'), value: on });
      });
    });
    // Persiste o estado recolhido/expandido de cada seção da Config.
    document.querySelectorAll('details.cfg-sec[data-sec]').forEach(function(d){
      d.addEventListener('toggle', function(){
        collapsed[d.getAttribute('data-sec')] = !d.open;
        saveState();
      });
    });
    // Cards de conteúdo colapsáveis: lembra o estado recolhido/expandido.
    document.querySelectorAll('details.cardc[data-card]').forEach(function(d){
      d.addEventListener('toggle', function(){
        cardCollapsed[d.getAttribute('data-card')] = !d.open;
        saveState();
      });
    });
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
    const od = document.getElementById('openDashboardBtn');
    if (od) od.addEventListener('click', function(){ vscode.postMessage({ type: 'openDashboard' }); });
    const eh = document.getElementById('exportHtmlBtn');
    if (eh) eh.addEventListener('click', function(){ vscode.postMessage({ type: 'exportDashboardHtml' }); });
  }

  window.addEventListener('message', function(e) {
    const m = e.data;
    if (m && m.type === 'data') {
      if (m.barStyle) m.data.barStyle = m.barStyle;
      render(m.data);
    }
  });
  // Tooltip flutuante das barras do sparkline: o title nativo não renderiza de
  // forma confiável neste webview, então mostramos um <div> próprio seguindo o
  // cursor. Delegação no document (montada UMA vez; sobrevive aos re-renders).
  (function(){
    var tip = document.createElement('div');
    tip.className = 'spark-tip';
    document.body.appendChild(tip);
    function hide(){ tip.style.display = 'none'; }
    function place(bar, x, y){
      var txt = bar.getAttribute('data-tip');
      if (!txt) { hide(); return; }
      tip.textContent = txt;
      tip.style.display = 'block';
      var pad = 12;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var left = x + pad, top = y - h - pad;
      if (left + w > window.innerWidth - 4) left = x - w - pad;
      if (left < 4) left = 4;
      if (top < 4) top = y + pad;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    document.addEventListener('mousemove', function(e){
      var t = e.target;
      var bar = t && t.closest ? t.closest('.spark-bar') : null;
      if (bar) place(bar, e.clientX, e.clientY); else hide();
    });
    document.addEventListener('mouseleave', hide);
    window.addEventListener('blur', hide);
  })();
  // Export estático: renderiza os dados embutidos. Webview: pede um render
  // inicial assim que monta (o host responde com o último estado).
  if (STATIC_DATA) { render(STATIC_DATA); }
  else { vscode.postMessage({ type: 'ready' }); }
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
    "claudeUsageBar.setAiAdviceKey",
    "claudeUsageBar.aiAdvice",
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
    } else if (msg?.type === "setLanguage" && typeof msg.value === "string") {
      // Idioma do plugin: vai pro globalState via comando (sempre gravável).
      vscode.commands.executeCommand("claudeUsageBar.setLanguage", msg.value);
    } else if (msg?.type === "setCostWindow" && typeof msg.value === "string") {
      // Janela das quebras: comando dedicado (valor de runtime + persiste).
      vscode.commands.executeCommand("claudeUsageBar.setCostWindow", msg.value);
    } else if (msg?.type === "setConfig" && typeof msg.key === "string") {
      // Grava o setting alterado pela aba Config.
      vscode.workspace
        .getConfiguration("claudeUsageBar")
        .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    } else if (msg?.type === "pickPath" && typeof msg.key === "string") {
      // Seletor de arquivo nativo p/ os campos de caminho (export/statusline).
      const cfgv = vscode.workspace.getConfiguration("claudeUsageBar");
      const cur = (cfgv.get<string>(msg.key) || "").trim();
      const expand = (p: string) =>
        p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
      const fallback =
        msg.key === "exportStatePath"
          ? path.join(os.homedir(), ".claude", "usage-bar.json")
          : path.join(os.homedir(), ".claude", "usage-state.json");
      const defaultUri = vscode.Uri.file(cur ? expand(cur) : fallback);
      const apply = (uri: vscode.Uri | undefined) => {
        if (uri) {
          cfgv.update(msg.key, uri.fsPath, vscode.ConfigurationTarget.Global);
        }
      };
      if (msg.mode === "open") {
        // statusline: aponta p/ um arquivo EXISTENTE (que a bridge escreve).
        vscode.window
          .showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri,
            openLabel: tr("Usar este arquivo"),
          })
          .then((uris) => apply(uris && uris[0]));
      } else {
        // export: escolhe ONDE gravar (o arquivo pode ainda não existir).
        vscode.window
          .showSaveDialog({
            defaultUri,
            saveLabel: tr("Usar este caminho"),
            filters: { JSON: ["json"] },
          })
          .then(apply);
      }
    } else if (msg?.type === "openSettings") {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "claudeUsageBar"
      );
    } else if (msg?.type === "openStatusPage") {
      vscode.env.openExternal(vscode.Uri.parse("https://status.claude.com"));
    } else if (msg?.type === "openRepo") {
      vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/bortolabs/claude-code-usage-bar")
      );
    } else if (msg?.type === "openDashboard") {
      vscode.commands.executeCommand("claudeUsageBar.openDashboard");
    } else if (msg?.type === "exportDashboardHtml") {
      vscode.commands.executeCommand("claudeUsageBar.exportDashboardHtml");
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

  /**
   * Reconstrói o HTML do webview — usado ao trocar o idioma, já que o dicionário
   * `L` (traduzido) é injetado no HTML. O webview remonta, pede {type:'ready'} e
   * o handler existente responde com o último estado (agora no novo idioma).
   */
  rebuild() {
    if (this.view) {
      this.view.webview.html = panelHtml();
    }
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
