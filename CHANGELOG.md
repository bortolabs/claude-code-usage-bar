# Changelog

## 0.37.0

### 🎚️ Hierarquia de 3 tiers: anomalias, dicas e burn rate falam com uma voz

Reorganização de UX de como os avisos acionáveis aparecem — antes espalhados entre um banner
global, o card Copiloto e as abas Custos, às vezes repetindo a mesma coisa lado a lado.

- **Tier 1 — Alerta (banner global):** a **anomalia crítica** (loop de tool) agora sobe pro
  banner do topo, visível em **qualquer aba** — não depende mais só da notificação opt-in
  (que nasce desligada). Sem burn rate, ela vira o banner; com burn rate ativo, entra como
  linha extra.
- **Tier 2 — Orientação (card Copiloto, aba Sessão):** as **anomalias de alerta** (⚠ contexto
  inflado, cache baixo, MCP disparado) agora aparecem no **Copiloto**, a aba que fica aberta
  durante o uso. Antes só existiam na aba Custos. Reusa o texto já localizado (sem i18n novo).
- **Tier 3 — Análise (aba Custos):** as dicas seguem no seu lugar, agora **sem duplicar** as
  anomalias.
- **Escalonamento anomalia → dica:** quando uma anomalia dispara, a **dica equivalente é
  suprimida** (`mcpRunaway` cobre a dica de MCP; `ctxInflated` cobre a de contexto grande) —
  a anomalia é mais forte e já traz a ação. `cacheLow` fica de fora de propósito (é o oposto
  da dica de cache-read: hit baixo vs. releitura alta).
- **Burn rate domina a cota:** com o alerta de burn rate ativo, o conselho "Cabem ~X tokens
  até o reset" é **suprimido** — acabou o "vai estourar" logo acima de "cabem 39M". Uma voz
  por situação. Regra unificadora: **tier superior suprime o redundante do inferior.**
- Motor puro novo (`suppressCoveredTips`) com 5 testes; suíte total em 97.

## 0.36.0

### 🔎 Detector de anomalias e desperdício de tokens (roadmap #4)

- **Motor local novo (`src/anomalies.ts`)** que aponta padrões **acionáveis** de desperdício,
  além dos "insights" descritivos e das "dicas" de economia. Local, sem rede, sem LLM. Quatro
  detectores:
  - **Loop de tool** (crítico) — a mesma chamada **idêntica** (`name` + `input`) repetida em
    sequência num turno. Casar o input evita falso positivo com N chamadas paralelas da mesma
    tool com argumentos diferentes (ex.: vários `Read` de arquivos distintos).
  - **Contexto inflado** — turnos carregando contexto acima de 200k somando além do limiar.
  - **Cache hit baixo** — aproveitamento de cache abaixo do piso (criar/expirar cache custa
    mais que reusar).
  - **MCP disparado** — um servidor MCP com volume de chamadas desproporcional na janela.
- **Sinais em streaming**: os dados por-turno (`ctxInflatedTurns`, maior run de tool idêntica)
  são computados direto no agregador, sem guardar os turnos em memória nem furar o cache.
- **UI**: card "Anomalias" no painel (⛔ crítico / ⚠ alerta / ℹ info) e seção dedicada no
  dashboard. **Notificação nativa opt-in** (desligada por padrão, só p/ anomalia crítica;
  re-arma sozinha por janela, no molde do alerta de burn rate).
- **6 settings novos** (`anomalyDetectionEnabled`, `anomalyNotifyEnabled`,
  `anomalyCacheHitMinPct`, `anomalyMcpCallsMax`, `anomalyCtxInflatedTurns`, `anomalyToolLoopK`)
  na aba Config, traduzidos nos 5 idiomas. Cobertura com 22 testes novos (vitest).

## 0.35.1

- **fix: card "Créditos extras" mostrava centavos como dólares.** A API `oauth/usage` devolve
  `used_credits`/`monthly_limit` em **centavos** (ex.: limite de US$ 25 vem como `2500`) — o card
  exibia "$0.00 de $2500.00". Normalizado para a unidade da moeda na borda do parse
  (`oauthUsage.ts`); agora mostra "$0.00 de $25.00".

## 0.35.0

### 🔐 Consentimento explícito para o token OAuth

- **Nada é lido sem permissão.** A extensão agora pede **consentimento explícito** (diálogo modal)
  **antes de QUALQUER leitura** do token de login do Claude Code CLI — seja de
  `~/.claude/.credentials.json`, do Keychain do sistema ou da variável `CLAUDE_CODE_OAUTH_TOKEN`.
  O diálogo explica exatamente o que é lido, de onde, e para quê: **somente** consultar o endpoint
  oficial da Anthropic (`api.anthropic.com/api/oauth/usage`, via HTTPS) e exibir a cota do próprio
  usuário. O token **nunca** é registrado em logs, armazenado em outro lugar nem enviado a
  terceiros; a extensão **não tem telemetria**.
- **Sem consentimento, zero acesso**: a função que resolve o token nem é chamada; a extensão segue
  funcionando com as fontes locais (statusline/ccusage) e o card "Fonte de dados" mostra
  "aguardando seu consentimento".
- **Decisão persistida e reversível**: vale para todos (inclusive quem já usava a extensão — sem
  grandfathering), é perguntada no máximo **uma vez** automaticamente e pode ser mudada a qualquer
  momento na aba **Config** (estado + botão Conceder/Revogar) ou pelo comando
  **"Claude Usage: Acesso ao token (consentimento)"**.

### Cotas por modelo e dados que faltavam

- **📊 Cotas 7d por modelo (Sonnet/Opus).** O endpoint oauth/usage já retornava as janelas semanais
  dedicadas por modelo — agora elas aparecem: rows com barra na aba **Sessão** (com reset próprio),
  linhas no **hover card** da status bar e campos `sevenDaySonnet`/`sevenDayOpus` no **export JSON**
  (`~/.claude/usage-bar.json`, aditivo). Contas sem a janela (ex.: Opus no Pro) simplesmente não
  mostram a row.
- **💳 Card "Créditos extras".** Quando a conta tem extra usage habilitado, a aba Sessão ganha um
  card com barra de utilização e usado/limite do mês.
- **🕒 Incidentes com tempo relativo.** A aba Status mostra "ativo há 2h · atualizado há 20min" em
  cada incidente, e o formato relativo ganhou dias ("há 3d").
- **⬇ Export CSV das quebras** (ROADMAP #18). Comando **"Claude Usage: Exportar CSV"** e botão no
  dashboard: escolhe a dimensão (modelo / projeto / dia / sessão / contexto) e salva um CSV da
  janela ativa. Dados 100% locais.

### Histórico persistente, heatmap e comparativos

- **🗓️ Histórico local persistente** (`historyEnabled`, ligado por padrão): agregados por dia/hora
  gravados no storage da extensão — **sobrevivem à limpeza de transcripts do Claude Code**.
  Retenção configurável (`historyRetentionDays`, default 365).
- **🔥 Heatmap semana × hora** no dashboard (ROADMAP #15): quando você mais consome tokens, com
  tooltip por célula e pico destacado. Aparece com ~7 dias de dados.
- **📈 Comparativos** (ROADMAP #14): "Hoje vs média 7d" e "Semana vs anterior" (tokens e custo, Δ%
  colorido) no dashboard.
- **🔔 Resumo semanal opt-in** (ROADMAP #17, `weeklySummaryEnabled`): notificação às segundas com a
  semana vs a anterior.

### Copiloto de cota (local, sem LLM)

- **🧭 Card "Copiloto"** na aba Sessão (`advisorEnabled`): sugestão **Opus→Sonnet** quando a janela
  semanal do Opus aperta e a do Sonnet tem folga; estimativa de **o que ainda cabe até o reset** no
  ritmo atual; dica de **melhor janela** ("recém-resetada + semana folgada"), enriquecida pelo
  heatmap. Conselhos dispensáveis (×), com histerese anti-flapping. Notificação nativa só para a
  troca de modelo, **opt-in** (`advisorNotifyEnabled`, cooldown de 6h).
- **🎯 Metas de token** (ROADMAP #16): `tokenGoalFiveHour`/`tokenGoalDaily` (0 = off) — barra de
  progresso na Sessão + aviso do copiloto ao estourar.
- Complementa o **AI advice** (que é sob demanda e usa LLM): o copiloto é contínuo, local e gratuito.

### Base técnica

- **✅ Testes (vitest)**: 70 testes cobrindo projeção/ETA, alertas, pricing, insights, agregação de
  transcripts e o histórico/copiloto novos. **CI em push/PR** (`ci.yml`: typecheck + testes +
  bundle) e gate de typecheck+testes no publish.
- **📦 Bundle com esbuild** no publish (arquivo único minificado — VSIX menor, ativação mais rápida).
  Dev flow (F5/watch com tsc) inalterado.
- **🔁 Backoff do oauth persistido** no globalState: recarregar a janela não zera mais o recuo — o
  burst de startup não bate num endpoint ainda em 429.
- Projeção unificada em `core/projection.ts`: a variante do alerts.ts projetava com apenas 60s de
  janela decorridos (alarmista); agora vale a regra dos 25% em todo lugar.
- i18n nos 5 idiomas em paridade.

## 0.34.3

- **GitHub Sponsors** adicionado às opções de apoio (botão Sponsor do VS Code/Marketplace + botão no
  repo + badge no README), junto com Ko-fi e Buy Me a Coffee. Tudo opcional, nada atrás de paywall.

## 0.34.0

- **☕ Apoio voluntário ao projeto.** A extensão é gratuita e open source; quem quiser retribuir agora
  tem como — **totalmente opcional, nada fica atrás de paywall**. Adicionados: botão **Sponsor**
  nativo (VS Code/Marketplace) via `package.json`, **`.github/FUNDING.yml`** (Ko-fi + Buy Me a
  Coffee; GitHub Sponsors entra depois), uma subseção **"Apoiar"** no README (badges + Pix) e um link
  discreto **"☕ apoiar"** no rodapé do painel.
- i18n nos 5 idiomas em paridade.

## 0.33.0

- **🪟 Card de hover rico na status bar.** Passar o mouse no item da status bar agora abre um cartão
  completo (igual aos melhores do gênero): **Rate Limits** (5h + 7d com barra e reset), **Uso da
  janela ativa** (custo · mensagens · tokens) + os oficiais **Hoje/Mês** do ccusage, **quebra de
  tokens** (Input/Output/Cache leitura/escrita com % e barra) + **cache hit %**, e **por modelo**
  (top 3 com custo, msgs e barra de participação) — tudo a partir dos dados já calculados, sem
  leitura nova.
- **⚙️ Novo setting `tooltipDetail`** (`full` por padrão · `compact`): quem prefere o tooltip enxuto
  de antes (só rate limits + link) escolhe `compact`.
- Degradação graciosa: com a análise local desligada, mostra só rate limits + custo e uma dica pra
  ativar. i18n nos 5 idiomas em paridade.

## 0.32.1

- **🪟 Seletor de janela sempre visível na aba Custos.** Antes, quando a janela ativa (padrão 5h)
  estava vazia, o seletor **5h · Hoje · 7d · 30d** sumia junto com as quebras — então não dava pra
  trocar pra 7d/30d pra ver os dados. Agora, com a análise ligada, o seletor fica **sempre** na tela
  e a janela vazia mostra **"Sem dados nesta janela. Tente 7d ou 30d acima."**. Com a análise
  desligada, aparece a dica pra ativar **"Analisar transcripts (custos)"** na Config.
- i18n nos 5 idiomas em paridade.

## 0.32.0

- **⚙️ AI advice configurável na aba Config.** Nova seção **"AI advice"** no painel (não precisa
  mais ir no Settings nativo): campos de **estilo da API**, **endpoint**, **modelo** e a amostra de
  prompts (janela/máximo), botões **Definir chave** e **Gerar AI advice**, e **presets** que
  **autopreenchem** style/endpoint/modelo num clique — **Ollama** e **LM Studio** (local, grátis),
  **Gemini**, **Groq** (free tier) e **Anthropic** (pago). A chave continua no SecretStorage.
- i18n nos 5 idiomas em paridade.

## 0.31.2

- **README: guia completo de qual key usar no AI advice.** A seção "AI advice — qual key usar"
  virou uma **tabela com passo-a-passo** e **links de onde obter cada key grátis**: Ollama/LM
  Studio (local, sem key), Google Gemini, Groq e OpenRouter (free tier), além da Anthropic (pago) —
  cada um com o `aiAdviceApiStyle`/`aiAdviceEndpoint`/`aiAdviceModel` certo. (Apenas docs.)

## 0.31.1

- **AI advice agora aceita endpoints locais (http).** A chamada escolhe `http`/`https` pelo
  protocolo da URL — então dá pra apontar pra um **LLM local grátis** (Ollama em
  `http://localhost:11434/v1/chat/completions`, LM Studio em `:1234`) e os dados **não saem da
  máquina**. Continua aceitando free tiers OpenAI-compatíveis (Gemini/Groq/OpenRouter) e a
  Anthropic (pago).
- **Deixa claro que a key do AI advice é separada da assinatura.** O prompt do comando "Definir
  chave do AI advice" agora explica que é uma **API key do provedor** (paga ou de um LLM
  local/free tier), **não** a assinatura do Claude Code.
- **README:** nova seção **"Recursos por aba"** (panorama antes dos screenshots) e um guia de
  **qual key usar no AI advice**, com as opções grátis.

## 0.31.0

- **📊 Dashboard de analytics de verdade** (substitui o "fullscreen" da 0.30, que só refluía a
  sidebar). O comando **"Abrir dashboard"** agora abre uma visão pensada em **métricas e dimensões**:
  - **Cards de KPI:** Custo · Mensagens · Input · Output · Cache (miss) · Cache (hit) · **Cache hit rate**.
  - **Composição de custo** por tipo de token (barra empilhada com `$` e `%`: input/output/cache-read/cache-write).
  - **Gráfico ao longo do tempo** (barras empilhadas) com **toggle** Tokens (composição)/Custo/Mensagens
    e tooltip — **por hora** na janela "Hoje", **por dia** nas demais.
  - **Insights** em linguagem natural (locais, sem rede): contexto >150k, sessões 8h+, cache hit rate,
    share de output/Opus, MCP, subagentes.
  - **Breakdowns em barras** (×contagem/`$` e `%`): por **modelo · projeto · sessão · contexto ·
    skills · plugins · MCP · subagentes**.
  - **Tabelas** por **modelo** (4 tipos de token + msgs + custo) e por **período** (dia/hora).
  - **Seletor de janela** no topo: **Hoje · Semana · Mês · Tudo**.
- **🧮 Novas métricas no agregador** (local, sem rede): custo separado por **tipo de token**
  (`pricing.costForSplit`), **cache hit rate**, séries **por dia/hora** com split, **por sessão**
  (com duração) e **skills/plugins** (dos blocos `tool_use` do `Skill`).
- **✦ AI advice (opt-in, BYO key).** Botão/comando que gera um **relatório de coaching em Markdown**
  a partir dos seus agregados + uma amostra dos seus prompts, via **Anthropic `/v1/messages`** (ou um
  endpoint OpenAI-compatível). A chave fica no **SecretStorage** (comando "Definir chave do AI
  advice"); **confirmação explícita** antes de enviar — é a única parte do plugin que sai da máquina.
- **⬇ Export `.html`** agora exporta o dashboard de analytics (snapshot autocontido, tema próprio).
- Sidebar **inalterada**; i18n nos 5 idiomas em paridade.

## 0.30.0

- **🖥️ Dashboard completo numa aba do editor.** Novo comando **"Claude Usage: Abrir dashboard"**
  (e um botão ⛶ no topo do painel) abre uma **aba larga** com **tudo de uma vez** — Sessão, Custos,
  quebras (modelo/projeto/contexto), gráficos, dicas, Status e Config — num **grid responsivo** que
  se reorganiza conforme a largura, em vez das abas estreitas da barra lateral. Abre com **todas as
  seções expandidas** e atualiza **ao vivo** igual à sidebar (refresh, troca de janela das quebras,
  troca de idioma). Reusa o mesmo motor de dados — sem fonte nova.
- **⬇ Exportar dashboard em HTML.** Comando **"Claude Usage: Exportar dashboard (HTML)"** (e botão ⬇)
  gera um **`.html` autocontido** com os dados do momento — abre no **navegador**, dá pra
  compartilhar ou arquivar. É um **snapshot** (sem rede, sem depender do VS Code): traz um tema
  próprio embutido pras cores ficarem certas fora do editor e marca a **hora de geração**. A aba de
  Configurações e os botões interativos ficam de fora do arquivo (não funcionariam no navegador).
- A barra lateral continua **idêntica** (abas, cards colapsáveis, idioma) — o dashboard é uma visão
  adicional, não um substituto.
- i18n: as strings novas entram nos 5 idiomas (pt/en/es/fr/de), em paridade.

## 0.29.4

- **Banner de alerta agora respeita a bandeira do plugin.** Ao escolher um idioma pela bandeira
  (ex.: inglês), o banner de burn rate continuava em português — o `alerts.ts` usava o i18n do
  VS Code, não o override do plugin. Migrado para o `tr()`: os textos (projeções de custo/tokens,
  ritmo alto, projeção 5h/semanal e a **dica de ritmo**) agora seguem o idioma escolhido.
- **Screenshots novas no README.** Galeria atualizada (Sessão com a dica de ritmo, Custos +
  Insights, Status, Config), agora com a **status bar à mostra** no rodapé de cada print. Corrige
  também as imagens que não carregavam na listagem (os nomes apontavam para arquivos inexistentes).

## 0.29.3

Release consolidada (0.28.2 → 0.29.3). Destaques desde a v0.28.1:

- **🌍 Idioma com bandeiras 🇧🇷🇺🇸🇪🇸🇫🇷🇩🇪.** Card **"Idioma"** na Config: clicar numa bandeira
  troca o idioma de **todo o plugin** (painel, status bar, tooltips, alertas) na hora,
  independente do VS Code. `🌐` = seguir o VS Code. A escolha **persiste** (globalState) e até o
  motivo de "fonte indisponível" é traduzido no idioma atual (sem mais texto vazado de outro
  idioma).
- **💡 Dica de ritmo no alerta de burn rate.** Quando a sessão 5h (ou o teto de custo) projeta
  bater 100% antes do reset, o banner sugere **quanto pausar** ou **quanto reduzir o ritmo** pra
  não estourar — ex.: *"pause ~3 min ou reduza o ritmo ~15%"*. Enquanto **uso% ≤ tempo%**, não há
  estouro previsto; pausar deixa o tempo empatar com o consumo. Local, sem rede.
- **🪟 Janela das quebras que pega de fato.** Trocar **5h · Hoje · 7d · 30d** agora reflete na
  hora em *Por modelo / Por projeto / Por tamanho de contexto* (antes ficavam presos em "5h").
- **📊 Tooltips dos gráficos.** Passar o mouse nas barras mostra o valor absoluto do dia (número
  cheio de tokens / custo exato) — via tooltip próprio (o nativo não renderizava no webview).
- **🎨 Aba Custos mais enxuta.** Todos os cards **colapsáveis** (e lembram o estado), **custo por
  turno** em cada faixa de contexto, e a **cor da status bar reflete o uso de tokens, nunca o
  tempo decorrido** (tempo acabando é bom: vem reset).

Histórico detalhado por versão abaixo.

## 0.29.2

- **Corrige a janela das quebras (5h/Hoje/7d/30d) que não pegava.** Ao trocar a janela, os cards
  **Por modelo / Por projeto / Por tamanho de contexto** continuavam presos em "5h" (só o botão
  mudava). A troca usava o mesmo caminho de gravação que tinha quebrado o idioma (setting +
  evento de mudança), pouco confiável. Agora vai por um **comando dedicado** que aplica a janela
  na hora (re-varre os transcripts no novo intervalo e re-renderiza) e só então persiste no
  setting — o filtro de tempo é aplicado em `costWindowStart()` → `readTranscriptStats()`, que
  ignora os turnos fora de `[início, agora]`.
- **Tooltip dos gráficos agora aparece de fato.** O `title` nativo não renderizava neste webview;
  trocado por um tooltip flutuante próprio que segue o cursor e mostra o valor absoluto do dia
  (tokens cheios / custo exato). As barras também destacam ao passar o mouse.
- **Idioma: corrige texto vazado na "Fonte de dados".** Ao voltar de outro idioma (ex.: alemão)
  pro pt-br, a linha de status do oauth/usage podia continuar com um trecho no idioma anterior
  (ex.: "Wartezeit…"). O motivo agora é guardado **cru/estruturado** e traduzido só na hora de
  exibir, no idioma atual.

## 0.29.1

- **Corrige a seleção de idioma que não persistia.** A escolha das bandeiras agora é gravada no
  **globalState** da extensão (sempre gravável e sincronizado), em vez de num setting — settings
  só podem ser escritos depois de registrados, então logo após instalar a extensão a gravação
  falhava e a bandeira voltava pro 🌐. Agora gruda na hora, sem precisar recarregar a janela.
- **Card de Idioma movido pro fim da Config** (logo após "Exportar uso").
- **Card "Por dia" (custo/tokens) agora é colapsável** como os demais.
- **Tooltip dos gráficos mostra o valor absoluto** ao passar o mouse: o **número cheio** de
  tokens (ex.: `12.345.678 tokens`) e o **custo exato** do dia (ex.: `$29.10`).

## 0.29.0

- **Seletor de idioma com bandeiras 🇧🇷🇬🇧🇪🇸🇫🇷🇩🇪.** Novo card **"Idioma"** na aba **Config**:
  clicar numa bandeira troca o idioma de **todo o plugin** (painel, status bar, tooltips,
  alertas) na hora — independente do idioma do VS Code. `🌐` = seguir o VS Code (padrão).
  Setting `language`. *(Os rótulos na tela de Settings nativa do VS Code seguem o idioma do VS
  Code — limitação da plataforma.)*
- README atualizado (idioma, aba Custos, contexto ao vivo, cards colapsáveis) e screenshots
  reorganizados para destacar a status bar.
- Correção: os campos da seção "Dicas de custo" agora caem nos padrões de boas práticas mesmo
  antes de a janela recarregar (a 0.28.1 tinha o mapa de defaults, mas ele não estava sendo
  aplicado de fato).

## 0.28.2

- **Cor da status bar = uso de TOKENS, nunca o tempo decorrido.** No fallback do ccusage (sem
  cota real) a cor passava a alarmar conforme o **tempo** da sessão avançava — o que é o
  contrário do desejado (tempo acabando é bom: vem reset). Agora a cor reflete só o **custo/uso**;
  o anel ainda mostra o % de tempo, mas sem ficar vermelho por isso. (No modo cota real/oauth a
  cor já vinha da cota 5h/7d.)
- **Custo por turno no card "Por tamanho de contexto".** Cada faixa agora mostra também o **custo
  médio por turno** (`~$X/turno`), deixando claro quanto cada tamanho de contexto custa por
  resposta — não só o total do bloco.
- **Cards colapsáveis.** Todos os cards de conteúdo (Custos, Fonte de dados, Status…) agora
  recolhem/expandem ao clicar no título, como as seções da Config, e **lembram** o que você
  deixou recolhido — deixa a aba Custos bem mais enxuta.

## 0.28.1

Release consolidada (0.28.0 + correções). A aba **Custos** ficou mais completa e o **Contexto**
voltou a funcionar no app.

- **🧮 Contexto ao vivo.** Corrige o Contexto **travado** (ex.: "6%" parado): vinha só da
  **statusline** do terminal, que no app/IDE podia estar velha. Agora é calculado **direto do
  transcript** (tokens do último turno ÷ janela do modelo: 1M, ou 200k no Haiku) — reflete o uso
  real sem depender da statusline (que vira só fallback; sem dado, a linha some).
- **🪟 Janela configurável na aba Custos.** Seletor **5h · Hoje · 7d · 30d** define o período das
  **quebras** (por modelo/projeto/contexto, MCP/subagentes e dicas). Hoje/Mês e os gráficos
  seguem do ccusage. Setting `costWindow`.
- **📈 Sparklines por dia.** **Custo/dia** e **tokens/dia** na aba Custos.
- **🎚 Dicas configuráveis.** Nova seção **"Dicas de custo"** na Config com os 5 gatilhos
  (contexto, cache-read, Opus, MCP, subagentes) — ajuste a sensibilidade. Já vêm preenchidos com
  os **padrões de boas práticas** (25/70/70/40/40).
- **🗂 Aba "Histórico" removida** (redundante com Custos): o sparkline de tokens/dia migrou pra
  Custos. Ficam **4 abas**: Sessão · Custos · Status · Config.

## 0.28.0

- **Janela configurável na aba Custos.** Um seletor **5h · Hoje · 7d · 30d** define o período das
  **quebras** (por modelo/projeto/contexto, MCP/subagentes e dicas). Os cartões **Hoje/Mês** e o
  novo gráfico de custo continuam vindo do ccusage (não mudam com o seletor). Setting `costWindow`.
- **Sparkline de custo por dia** na aba Custos — mini-gráfico do `$`/dia dos últimos dias (ao lado
  do que já existia de tokens no Histórico).
- **Limiares das Dicas configuráveis.** Nova seção **"Dicas de custo"** na Config expõe os 5
  gatilhos (contexto grande, cache-read, Opus, chamadas de MCP, subagentes) — ajuste a
  sensibilidade das sugestões. Settings `tipsContextBigPct`, `tipsCacheReadPct`, `tipsOpusPct`,
  `tipsMcpCalls`, `tipsSubagentPct`.
- Os títulos das quebras agora mostram a janela ativa (ex.: "Por modelo (7d)").

## 0.27.1

Release consolidada — reúne tudo desde a 0.25.1. Chega o **acompanhamento de custos** e os
**insights locais** (nosso "coach" de gasto), além de um bom ganho de performance.

- **💰 Custos por modelo, hoje e mês.** Custo de **hoje**, **mês até agora** e **projeção do
  mês** (números oficiais do ccusage), mais a quebra **por modelo** (Opus/Sonnet/Haiku…)
  calculada de uma **tabela de preços local** sobre os seus transcripts. Em **assinatura**, o
  `$` aparece como **equivalente de API** (`~`), nunca como cobrança; em **API** dá pra definir
  um **orçamento mensal** com **alerta** (consumido **e** projeção).
- **🧭 Nova aba "Custos"** com tudo num lugar só: hoje/mês + quebra por **modelo**, **projeto**
  e **tamanho de contexto**, mais a **contagem** de chamadas por servidor **MCP** e por
  **subagente**.
- **🧠 Dicas (Insights) — local, sem LLM.** Sugestões de economia a partir dos seus próprios
  números: contexto grande puxando o custo → `/compact`, muita releitura de cache, Opus
  concentrando o gasto → Sonnet/Haiku, MCP/subagentes pesados. Sempre rotulado **"≈ aproximado
  · tabela vX"** — o número oficial continua sendo o do ccusage.
- **📟 Modo "custo" na status bar** (`statusBarValue`): o número pode mostrar **cota** (padrão),
  **custo de hoje** ou **custo do bloco de 5h**, mantendo o anel/estilo.
- **🛠 Export `v2`:** o JSON de export ganhou `today`, `month` e `byModel[]` (marcados
  `approximate`) — pra agentes/scripts.
- **⚡ Performance:** a análise dos transcripts ganhou **cache por mtime** (tick ocioso de
  ~230ms → ~0,3ms) e o fim de uma varredura de disco redundante — agora é **uma** leitura por ciclo.
- **🐞 Correção:** tooltip da status bar que mostrava "reseta em 0m" divergente do painel (0.25.2).

Tudo **local, sem rede e sem LLM**; em 5 idiomas (pt/en/es/fr/de).

## 0.27.0

- **Nova aba "Custos"** (entre Histórico e Status) — reúne tudo de gasto num lugar só:
  - **Custos** (hoje / mês / projeção do ccusage + barra de orçamento em API).
  - **Por modelo (5h)** — custo ≈ por modelo (tabela local).
  - **Por projeto (5h)** — agora com **custo** (antes era só tokens no Histórico); inclui o
    projeto sintético **"subagentes"** (gasto das sidechains).
  - **Por tamanho de contexto (5h)** — custo por faixa de contexto do turno
    (`<50k … >200k`); as faixas **>150k** ficam **destacadas** (custam mais por resposta).
  - **MCP e subagentes (5h)** — **contagem** de chamadas por servidor MCP e por subagente
    (não dá pra atribuir tokens a um tool isolado do turno).
  - **Dicas** — análise **local, sem LLM**, com sugestões de economia (ex.: contexto grande
    puxando o custo → `/compact`; releitura de cache; Opus concentrando o gasto → Sonnet/Haiku;
    servidor MCP muito chamado; subagentes pesados). Sempre rotulado **"≈ aproximado"**.
- **Histórico** ficou enxuto: só o **sparkline** dos últimos dias (o resto migrou pra Custos).
- Mantém tudo da 0.26.0 (motor de custo, alerta de orçamento, modo custo na status bar).

## 0.26.0

- **Custos por modelo, hoje e mês (novo).** A aba **Histórico** ganhou dois cards:
  - **Custos** — **hoje**, **mês até agora** e **projeção do mês** (no ritmo atual). Os
    números vêm do **ccusage** (oficiais). Em **API**, com **orçamento mensal** definido,
    aparece uma **barra vs. orçamento**.
  - **Por modelo (5h)** — tokens e **custo aproximado por modelo** (Opus/Sonnet/Haiku…),
    calculado de uma **tabela de preços local** a partir dos seus transcripts. Tudo **local,
    sem rede e sem LLM**, sempre rotulado **"≈ aproximado · tabela vX"**. Em assinatura, o `$`
    aparece como **equivalente de API** (`~`), nunca como cobrança.
- **Alerta de orçamento mensal (novo).** Defina `monthlyBudgetUsd` (> 0) para ser avisado
  quando o gasto do mês — **ou a projeção** no ritmo atual — alcançar o orçamento. Respeita o
  **"Silenciar 1h"** e re-arma sozinho ao cair abaixo de 90%. **Desligado por padrão em
  assinatura** (lá o custo é só equivalente de API).
- **Modo "custo" na status bar (novo).** O setting **Valor na status bar** (`statusBarValue`)
  troca o número entre **cota** (padrão), **custo de hoje** (`$`) e **custo do bloco de 5h**
  (`$`) — mantendo o anel/estilo. Em assinatura, o `$` vem como `~` (equivalente API).
- **Insights local** (`insightsEnabled`, ligado por padrão): analisa os transcripts em
  `~/.claude/projects` para o detalhamento de custo. Desligue para pular a leitura de disco.
- **Export `v2`:** o JSON de export agora inclui `today`, `month`
  (`costUSD`/`projectedUSD`/`budgetUSD`/`overBudget`) e `byModel[]` (com `approximate: true`).
- Inclui a correção do tooltip da 0.25.2 (reset divergente "reseta em 0m").

## 0.25.2

- **Corrige o reset divergente no tooltip da status bar.** O hover mostrava "reseta em
  0m" enquanto o painel mostrava o reset real (ex.: 16m). Causa: o tooltip lia o reset da
  **statusline** (que pode estar velha), em vez do **oauth/usage** (a mesma fonte do anel).
  Agora o tooltip usa o oauth primeiro, com fallback pra statusline — batendo com o painel.

## 0.25.1

- **Créditos no rodapé da Sessão.** Linha discreta no fim da aba **Sessão** com a **versão**
  do plugin e um link pro **repositório no GitHub** (`bortolabs/claude-code-usage-bar`).

## 0.25.0

- **Aba Config repaginada** — menos poluída e mais "feature, não parâmetro":
  - **Cards de seção colapsáveis** (Aparência, Fonte e atualização, Conta e limites,
    Alertas e cores, Status, Exportar uso) — clique no título recolhe/expande, e o painel
    **lembra** o que você deixou recolhido.
  - **Booléanos viram toggle** (Ligado/Desligado) em vez de checkbox; o **Alerta de burn
    rate** ganhou destaque com 🔥.
  - O **seletor visual de estilo** (anel/barra/número/ícone) foi pra dentro da **Aparência**
    (no lugar do dropdown), e os cards standalone redundantes de estilo e de burn rate saíram.
- **Seletor de arquivo nativo (📁)** nos campos de caminho do **Statusline** e do **Export**
  — abre o diálogo do VS Code em vez de digitar o caminho na mão.
- **Placeholder com o caminho/comando padrão** nos campos vazios (deixa claro que "vazio =
  usa `~/.claude/usage-state.json`", etc.). O texto do **Exportar uso** ficou mais claro.
- **Correções:**
  - **Lado/Prioridade da status bar agora aplicam na hora** — antes, mudar para "left" (ou a
    prioridade) só fazia efeito após reiniciar o VS Code; agora o item é recriado na hora.
  - **Modelo mostra a versão** mesmo vindo da statusline (ex.: "Opus 4.7" em vez de só "Opus").
  - **Barra de Contexto some** quando não há dado real de contexto (em vez de exibir "0%").
  - **Sem o flash "indisponível"** do oauth: enquanto o cache é a fonte exibida, o
    diagnóstico mostra "ok ✓" (o 429 transitório de revalidação não pisca mais).
- **Status da Anthropic:** o padrão de atualização passou de **120s → 300s** (5 min) —
  página de status muda pouco, menos consultas à toa.

## 0.24.0

- **Fim do 429 ao reabrir o VS Code.** O 429 que voltava no startup **não era cota** — era
  o `oauth/usage` (rate-limit próprio) levando um **burst** de chamadas: no boot, vários
  gatilhos (activate + abertura da view + foco da janela) disparavam o fetch quase juntos e,
  somados ao poll do próprio Claude Code, estouravam o limite do endpoint. Três defesas:
  - **Uma chamada de cada vez** (guarda de concorrência) — colapsa o burst de startup.
  - **Coalescência do foco** — focar a janela (alt-tab) não refaz o oauth se ele já está
    fresco (<30s); as fontes locais (statusline/ccusage) seguem atualizando no foco. Mata o
    spam sem perder o refresh-ao-acordar.
  - **Backoff mais gentil** — a 1ª falha recua ~20s (cura a colisão pontual de abertura) e
    só escala até 15min se o 429 persistir. Antes o piso de 2min deixava o painel no ccusage
    à toa.
- **Painel reorganizado (menos poluído).** Duas mudanças de layout:
  - O card **"Fonte de dados"** saiu da aba **Config** e foi pra aba **Sessão**, **logo
    abaixo do painel principal** — onde ele é mais útil (mostra a fonte ativa junto do uso).
  - Na aba **Config**, cada seção agora é um **card separado** (Aparência, Fonte e
    atualização, Conta e custos, Alertas e cores, Status, Exportar uso…), no mesmo estilo
    dos cards "Estilo na status bar" e "Alerta de burn rate". Antes era um bloco único só,
    que ficava visualmente carregado.

## 0.23.1

- **Backoff no `oauth/usage` (corrige o "Quota reached" falso).** O endpoint de usage tem
  **rate-limit próprio** — com o polling de 60s **+** os refreshes por foco/abertura da view,
  dava pra levar **429 mesmo sem a cota ter estourado** (e o Claude Code lê o mesmo endpoint,
  por isso às vezes mostrava "Quota reached" indevidamente). Agora, ao receber 429/falha, a
  extensão faz **backoff exponencial** (2 → 4 → 8 min, teto de 15 min; piso de 2 min p/ 429) e
  **volta ao normal no primeiro sucesso**, em vez de seguir martelando o endpoint.
  - O recuo vale para **qualquer gatilho** (intervalo, foco, abertura da view) — nada
    re-dispara a chamada enquanto estiver recuando.
  - A aba **Config → Fonte de dados** mostra o motivo **e** o recuo em andamento
    ("…recuando, nova tentativa em ~Xmin").

## 0.23.0

- **Alerta nativo de cota baixa (opcional).** Para quem **não** usa agente, o plugin passa a
  avisar com uma notificação quando **restar pouca cota** numa janela real — `< 15%` por
  padrão, na sessão de **5h** ou na semana de **7d**. A notificação traz **quanto resta** e,
  quando há reset, **em quanto tempo a janela vira**, com botões **"Abrir painel"** e
  **"Silenciar 1h"**.
  - Avisa **1× por janela** e **re-arma sozinho** quando a cota se recupera (histerese para
    não oscilar no limiar). Respeita o **silêncio de 1h** dos demais alertas.
  - Só dispara com **cota real** (oauth/statusline) — nunca no fallback ccusage (% de tempo),
    pra não alarmar com número aproximado.
  - Configurável na aba **Config** → "Avisar cota baixa (% restante)" (limiar `0` = desligado).

## 0.22.0

- **Export de uso para agentes/scripts.** O plugin passa a gravar um **JSON local** com o
  uso atual — cota **restante** de 5h/7d, reset, fonte e **confiabilidade** — para
  automações lerem. Caso de uso: um **agente em auto-mode** parar/avisar quando a cota
  restante ficar baixa (ex.: `fiveHour.remainingPct < 15`).
  - **Ligado por padrão**, gravando em `~/.claude/usage-bar.json` (caminho **cross-platform**;
    no Windows resolve em `C:\Users\<você>\.claude\…`). Dá pra desligar/trocar o caminho na
    aba **Config** (seção "Exportar uso").
  - Escrita **atômica**, **sem token** e **sem envio externo** (arquivo só local).
  - Só marca `trustworthy: true` quando a fonte é **cota real** (oauth/statusline); no
    fallback ccusage (% de tempo) marca `false` e não inventa "remaining" — pra um agente
    nunca decidir com base em número errado.

## 0.21.3

- **Fonte de dados visível (fim do fallback silencioso).** A aba **Config** passa a mostrar
  a **fonte ativa** — `oauth/usage` (cota real), `statusline (plano)` (cota real) ou
  `ccusage` (aproximado) — e, quando o `oauth/usage` não entra, o **motivo** ("token não
  encontrado", "401", "desativado nas configurações"…). Antes ele caía no ccusage em
  silêncio, dando a impressão de "número errado".
- **ccusage marcado como aproximado.** Quando não há cota real e cai no ccusage, o anel
  mostra **"≈ tempo"** e o rodapé **"ccusage (≈ tempo)"**, deixando claro que é a **% de
  tempo do bloco**, não a cota do `/usage` — evita confundir os dois.
- **Distribuição:** a extensão passa a ser publicada também no **[Open VSX](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar)**
  (VSCodium/Cursor/Windsurf/VS Code) e cada release no GitHub anexa o **`.vsix`**. A
  listagem no VS Code Marketplace está temporariamente indisponível (em revisão).

## 0.21.2

- **Fix: "Silenciar 1h" do alerta de burn rate.** Agora silencia **qualquer** alerta por
  1h de verdade. Antes, só empurrava o cooldown do **mesmo tipo** de alerta — quando os
  motivos do burn rate flutuavam, a chave mudava e o popup furava o silêncio em poucos
  minutos. Passou a usar um silêncio absoluto até o fim da hora.
- **Fix: dados velhos ao reabrir o VS Code / acordar de sleep.** O painel agora refaz o
  fetch quando a view fica **visível** e quando a **janela recupera o foco** (com throttle
  para não martelar). Evita exibir o estado da sessão anterior até o próximo tick.
- **UX:** o botão de atualizar no topo do painel agora é só o **ícone ↻** (sem o texto
  "Atualizar"), ocupando menos espaço; o rótulo continua no tooltip.
- **Disclaimer de não-afiliação.** README e descrição deixam explícito que é uma extensão
  **não oficial**, sem vínculo com a Anthropic ("Claude"/"Claude Code" são marcas da
  Anthropic, citadas só para interoperabilidade).

## 0.21.1

- **Screenshots na página do Marketplace + README.** Galeria com o painel (aba Sessão),
  a aba Status (status.claude.com), a aba Config e o Histórico/projetos da sessão, para
  o usuário ver a extensão antes de instalar. As imagens ficam em `media/screenshots/`
  (servidas via URL do GitHub; ficam fora do `.vsix` para não pesar o pacote).
- Bandeiras dos idiomas suportados na seção de idiomas do README.

## 0.21.0

- **Suporte a múltiplos idiomas (i18n).** A extensão agora segue o idioma do VS Code.
  Além do **português** (base), foram adicionados **English, Español, Français e Deutsch**
  — cobrindo a status bar, o tooltip, as notificações, todo o painel (abas, configurações,
  status) e a tela de Configurações/Command Palette do VS Code.
  - Infraestrutura padrão do VS Code: `vscode.l10n` para as strings de runtime (com bundles
    em `l10n/bundle.l10n.<lang>.json`) e `package.nls.<lang>.json` para o manifesto.
  - O painel (webview) recebe um dicionário já traduzido pelo host, mantendo uma única
    fonte de tradução.
  - **Escalável:** adicionar um novo idioma = adicionar dois arquivos JSON de tradução,
    sem mexer no código. Quando não há tradução para o idioma do usuário, cai no português.

## 0.20.1

- **Fix: aba Config "não salvava" as alterações.** As mudanças até eram gravadas
  (`config.update` no `change` de cada controle), mas o formulário inteiro era
  **reconstruído a cada atualização de dados** vinda da extensão (ticks de
  ccusage/oauth/status e o "eco" do próprio save). Esse re-render pisava nos
  itens ainda em processo de salvamento (saves são assíncronos) e apagava o que
  estava sendo digitado num campo numérico antes do `blur` — revertendo
  marcações e o valor digitado, dando a impressão de que nada era salvo. Agora o
  formulário só é (re)montado ao **entrar** na aba Config; enquanto ela está
  aberta, os dados novos são guardados e reaplicados ao trocar de aba e voltar,
  preservando o foco e as edições em andamento.

## 0.20.0

- **Renomeado para "Claude Code Usage & Status"** (displayName) — refletindo que o plugin
  agora cobre uso E status. O id interno (`claude-code-usage-bar`) e o repositório
  permanecem, então instalações e links não quebram.
- **Aba Status + aviso de incidentes da Anthropic.** Nova aba **Status** no painel que lê
  `status.claude.com` (API pública do Statuspage) e mostra: status geral, componentes
  (claude.ai, API, Claude Code, Console…), incidentes ativos e histórico recente, com link
  para a página oficial.
  - **Badge ☁** no indicador da status bar quando há incidente/degradação.
  - **Notificação** (1× por incidente, com dedupe) quando surge um novo problema.
  - Tudo configurável: `statusCheckEnabled`, `statusBadgeEnabled`, `statusNotifyEnabled`,
    `statusRefreshSeconds`.
  - Interface em **PT-BR** (status, impacto, componentes traduzidos; o nome/descrição do
    incidente vêm em inglês da própria Anthropic).
  - Motivação: saber na hora que uma queda é da Anthropic (não do plugin/sua máquina).

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
