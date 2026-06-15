# Changelog

## 0.19.1

- **Fix: falso "sessão de 5h encerrada".** O resumo de bloco (#9) disparava ao clicar em
  Atualizar, mesmo sem a janela ter resetado. Causa: o `resets_at` do oauth varia alguns
  ms a cada chamada, e a comparação era por igualdade exata. Agora só conta como janela
  nova quando o reset salta ≥ 1h (um bloco de 5h novo reseta ~5h à frente); o drift de ms
  é absorvido sem notificar.

## 0.19.0

- **Painel reorganizado em abas: Sessão · Histórico · Config.** A aba ativa persiste
  entre recriações da view. O alerta de burn rate fica visível em qualquer aba.
- **Breakdown por projeto (#4)** na aba Histórico: card "Projetos nesta sessão (5h)" com
  os projetos que estão consumindo o bloco atual, com barras proporcionais. Calculado dos
  transcripts (`~/.claude/projects`), filtrando pela janela de 5h real.
- **Aba de Configurações visual:** edite todos os 24 settings por controles (toggles,
  selects, números, cor), agrupados em seções (Aparência, Fonte, Conta, Alertas). Inclui
  botões de comando (Atualizar, Arquivo de estado, Alternar estilo, Liga/desliga alerta)
  e link para abrir o `settings.json` filtrado.

## 0.18.0

- **Resumo ao fechar o bloco de 5h.** Quando a janela de 5h reseta, mostra uma notificação
  com o que a sessão consumiu (pico de cota, tokens e custo equivalente). Setting
  `blockSummaryEnabled` (on por padrão).

## 0.17.0

- **Tema do anel configurável.** Novo setting `ringTheme`: `semaforo` (padrão, verde/amarelo/
  vermelho), `claude` (laranja do Claude), `mono`/`custom` (cor própria via `ringColor`).
  Em qualquer tema, o nível **crítico** continua **vermelho** para não perder o sinal de alerta.

## 0.16.2

- **Linha "Uso de tokens da sessão"** agora mostra **% + tokens** (ex: "17% · 58.97M
  tokens") — coerente com a barra/grifo — e deixou de repetir o "reseta em Xh" (que já
  está no grifo).
- **Alerta de burn rate em card próprio**, separado do card de estilos da status bar.

## 0.16.1

- **Subtítulo do anel em duas linhas.** "sessão 5h · reseta 4h23" quebra no "·" para
  "sessão 5h" / "reseta 4h23", evitando que o texto estoure e se sobreponha ao anel.

## 0.16.0

- **"Atualizado há Xs" ao lado do botão Atualizar**, com cronômetro vivo (incrementa
  sozinho a cada 1s). Conta desde a última vez que os dados foram efetivamente buscados.
  Ao clicar em Atualizar, mostra "atualizando…" em verde como feedback imediato.

## 0.15.1

- **Alerta de projeção em amarelo, não vermelho.** Quando o alerta é só uma *projeção*
  de estouro (uso atual ainda baixo), o indicador e a faixa do painel ficam **amarelos**
  (warning). O vermelho fica reservado para estouro já consumado (uso ≥ limite de erro).
- **Tooltip explicando "burn rate"** no toggle de Ligar/Desligar (ícone ⓘ + hover).

## 0.15.0

- **Tempo da sessão agora usa a janela REAL** (reset do `oauth/usage`), não o bloco fixo
  por relógio do ccusage. Logo após um reset, "Tempo da sessão 5h" mostra ~0% (antes podia
  mostrar 10%+ porque o bloco do ccusage começa na hora cheia).
- **1ª barra deixou de ser redundante**: agora mostra "Uso de tokens da sessão · X tokens"
  (o % da cota já está no anel/grifo logo acima).
- **Layout em cards**: sessão, histórico e controles ficam em cards separados — o "Alerta
  de burn rate" não fica mais grudado nos botões de estilo.

## 0.14.2

- **Fix: o painel piscava entre o layout novo (oauth/cota real) e o antigo (ccusage).**
  Quando uma atualização do `oauth/usage` falhava pontualmente (timeout/rede), o último
  resultado bom era descartado e o render caía no ccusage, alternando o layout. Agora o
  último resultado válido do oauth é mantido por alguns ciclos (≈5×`oauthRefreshSeconds`),
  então uma falha isolada não troca mais a fonte/layout.

## 0.14.1

- **Cross-platform (Windows/Linux/macOS).** A leitura do token OAuth para o `api/oauth/usage`
  agora funciona nos três SOs: tenta `CLAUDE_CODE_OAUTH_TOKEN`, depois o arquivo
  `~/.claude/.credentials.json` (fonte canônica em Linux/Windows), e por fim o Keychain
  (macOS). A chamada HTTP passou a usar o módulo `https` nativo do Node (não depende mais
  de `curl`, que pode faltar no Windows).

## 0.14.0

- **Cota REAL do plano no anel (igual ao `/usage`), também no app/IDE.** A extensão agora
  consulta o endpoint oficial `api/oauth/usage` — a mesma fonte do `/usage` — lendo o token
  OAuth do Keychain do macOS. Resultado:
  - **anel = `five_hour.utilization`** (a cota real da sessão de 5h, idêntica ao `/usage`);
  - **reset real** (`resets_at` da Anthropic), corrigindo a divergência de tempo;
  - **barra de tempo** da sessão (ccusage) continua, agora como linha separada no painel;
  - 7d e extra-usage também disponíveis.
  - Vira a **fonte primária** (acima de statusline e ccusage). Setting `useOAuthUsage`
    (on por padrão) e `oauthRefreshSeconds`. macOS apenas (usa Keychain); fora disso,
    cai no ccusage. O token fica local e só é enviado para `api.anthropic.com`.

## 0.13.0

- **Tooltip do hover resumido.** Ao passar o mouse no item da status bar, o popover
  agora é enxuto: sessão 5h + reset (com barrinha), alerta/projeção só quando ativo, e
  um link **"Abrir painel"** para os detalhes completos. Antes era um bloco denso.

## 0.12.0

- **Estouro de tokens da sessão** (ritmo de uso vs tempo restante): com um teto de
  tokens definido (`sessionTokenCap`, ex: 150M), o indicador projeta — no ritmo atual —
  quantos tokens você terá usado quando a janela de 5h fechar (`projection.totalTokens`
  do ccusage), e:
  - **colore** quando a projeção passa do teto (entra no "pior dos dois");
  - **alerta** "Nesse ritmo: 124M tokens até o reset (teto 100M)";
  - mostra **ETA** "estoura em ~Xmin" no ritmo de tokens/min;
  - exibe a projeção no tooltip/painel.
  - Vale também em **assinatura** (onde não há limite de tokens oficial). `0` desativa.

## 0.11.1

- **Fix: toggle do alerta sem feedback.** Ao clicar no 🔔/🔕 do painel:
  - o botão agora muda na hora (feedback otimista), sem esperar o round-trip;
  - mostra notificação clara "alerta LIGADO/DESLIGADO" (antes só uma mensagem fugaz);
  - corrigido um problema de timing onde a 1ª mensagem ao webview podia se perder e
    o listener de mensagens podia acumular ao recriar a view.

## 0.11.0

- **ETA até estourar** (#7): quando há previsão de estouro, mostra *em quanto tempo* o
  limite atinge 100% no ritmo atual — no painel/tooltip ("estoura em ~38min") e
  incorporado na notificação de alerta. No terminal usa os limites 5h/7d; em conta API,
  o custo vs teto.
- **Aviso de fim de janela** (#8): notifica uma vez quando faltar pouco para a sessão de
  5h resetar (setting `resetWarningMinutes`, padrão 10) — útil para emendar trabalho pesado.

## 0.10.0

- **Sparkline de histórico** no painel: mini-gráfico de barras dos últimos ~7 dias
  (via `ccusage daily`), com o dia de hoje destacado e tokens/data no tooltip.
- **Correção do modelo atual**: agora lido do transcript mais recente
  (`~/.claude/projects/*.jsonl`). Antes vinha do array de modelos do bloco do ccusage,
  que mistura vários (opus/haiku/etc) e mostrava o errado. Nome formatado (ex: "Opus 4.8").
- Adicionado `ROADMAP.md` com o histórico de features e as próximas ideias.

## 0.9.0

- **Cor por projeção de estouro** (`colorByProjection`, on por padrão): o indicador
  colore pela projeção de onde você vai chegar no reset, não só pelo valor atual —
  usa o **pior dos dois**. Assim o anel esquenta antes de o número ficar alto.
  - **Terminal**: projeta a % dos limites 5h/7d no reset.
  - **API**: projeta o custo vs teto.
  - **Assinatura no app**: usa o ritmo de tokens/min vs uma referência de intensidade
    (`intenseTokensPerMin`, default 50k), já que não há limite real.
  - Projeção só conta após 25% da janela decorrida (evita alarme falso no início).
  - O tooltip mostra a projeção quando ela é o fator relevante (↗/⚠).

## 0.8.0

- **Liga/desliga do alerta de burn rate** em três lugares:
  - **toggle no painel** (🔔/🔕) mostrando o estado atual;
  - **comando na paleta** _Claude Usage: Ligar/desligar alerta de burn rate_;
  - botão **"Desligar alertas"** na própria notificação (ao lado de "Silenciar 1h").

## 0.7.0

- **Correção conceitual de custo para assinaturas (Pro/Max).** O "custo" que o ccusage
  calcula é o **equivalente em preço de API** — não é cobrança quando você tem assinatura
  (enquanto não estourar os limites do plano, o custo adicional é zero). Antes o plugin
  comparava esse valor com um teto em dólar e alertava como se fosse gasto real.
  - Novo setting `accountType` (`auto`/`subscription`/`api`). `auto` assume assinatura.
  - Em **assinatura**: o `$` vira "equivalente API ~$X" (referência), **sem teto, sem cor
    de erro por custo e sem alerta de custo/$h** (a menos que você defina `burnRateMaxPerHour`
    explicitamente). O foco passa a ser tempo da sessão e limites do plano.
  - Em **api**: comportamento de custo real (teto + alerta) preservado.

## 0.6.0

- **Ícone na Activity Bar** (lateral esquerda): abre uma view dedicada com o painel
  completo (anel SVG, barras, alerta, botões de estilo e atualizar), sempre acessível.
- O painel deixou de abrir como aba ao lado; agora vive na sidebar. O comando
  _Abrir painel_ e o clique no item da status bar revelam a view.

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
