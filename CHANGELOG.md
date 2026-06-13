# Changelog

## 0.5.0

- **Alerta de burn rate** — avisa quando o ritmo de gasto projeta estourar antes do reset.
  Três gatilhos: projeção de custo > teto, ritmo alto (`$/h`) e projeção dos limites do
  plano (5h/7d) baterem 100%. Mostra:
  - **notificação** do VSCode (com cooldown e botão "Silenciar 1h");
  - **ícone ⚠ + vermelho** na status bar;
  - **faixa de aviso** no topo do painel.
- Novos settings: `burnRateAlertEnabled`, `burnRateMaxPerHour`, `alertCooldownMinutes`.

## 0.4.1

- **Botão "Atualizar" no painel** (canto superior direito, igual ao modal do `/usage`),
  com ícone que gira ao recarregar. Atualiza statusline + ccusage na hora.

## 0.4.0

- **Nova fonte de dados: ccusage** — a extensão agora calcula o uso da **sessão de 5h**
  a partir dos transcripts (via `ccusage blocks --active`), então **funciona em qualquer
  ambiente** (app/IDE ou terminal), sem depender da statusline disparar.
  - Mostra **% de tempo decorrido da sessão de 5h** + **tempo até resetar** + custo real do bloco.
  - Tooltip/painel ganham ritmo de gasto ($/h) e projeção do bloco.
- **Limites reais do plano (5h/7d, igual ao `/usage`)** continuam usados quando você roda
  o Claude Code no **terminal** (statusline fresca) — eles têm prioridade sobre o ccusage.
- **Botões de estilo no painel**: troque ring/bar/number/icon com um clique, vendo na hora.
- Novos settings: `ccusageCommand`, `ccusageRefreshSeconds`.

> Por que ccusage: os limites 5h/7d que alimentam o `/usage` só existem nos headers da API
> e só são expostos pela statusline, que **só roda no terminal (TUI)**. Para ter feedback
> constante no app/IDE, a sessão de 5h é derivada dos transcripts pelo ccusage.

## 0.3.0

- **Painel com anel SVG real** (estilo app do Claude): clique no item da status bar ou
  rode _Claude Usage: Abrir painel_. Atualiza ao vivo, com barras de cada métrica.
- **Estilos da status bar** via `claudeUsageBar.barStyle`: `ring` (◕ 38%), `bar` (███░░ 38%),
  `number` (38%) e `icon` ($(pulse) 38%).

## 0.2.0

- **Suporte a todos os tipos de conta** com modo adaptativo automático:
  - Assinatura (Pro/Max): anel = janela 5h, número = janela 7d (limites do plano, igual ao `/usage`).
  - API/pay-as-you-go: número = custo $ acumulado, anel = uso de contexto (não há limite de plano).
- Novo setting `claudeUsageBar.mode` (`auto`/`subscriber`/`cost`) e `claudeUsageBar.costCapUsd`.
- Foco nos limites de plano e custo (o uso de contexto já é coberto pelo `/context`).
- Removido o comando de alternar métrica (substituído pela detecção automática de modo).

## 0.1.0

- Versão inicial.
- Indicador na status bar com anel de progresso + percentual.
- Métricas: janela de 5h, janela de 7d (limites do plano, igual ao `/usage`) e uso de contexto.
- Tooltip com breakdown completo: sessão 5h/7d, contexto, tokens da última chamada,
  custo estimado, modelo e sessão.
- Clique alterna a métrica primária.
- Lê o estado de `~/.claude/usage-state.json`, gravado pela statusline do Claude Code.
