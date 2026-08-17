# Claude Code Usage & Status

[![Open VSX](https://img.shields.io/open-vsx/v/bortolabs/claude-code-usage-bar?label=Open%20VSX&color=a60ee5)](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar)
[![Downloads](https://img.shields.io/open-vsx/dt/bortolabs/claude-code-usage-bar?label=downloads&color=2f81f7)](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar)
[![Release](https://img.shields.io/github/v/release/bortolabs/claude-code-usage-bar?label=release&color=4caf78)](https://github.com/bortolabs/claude-code-usage-bar/releases/latest)

**🌐 Idioma / Language:** **Português (Brasil)** · [English](https://github.com/bortolabs/claude-code-usage-bar/blob/master/README.md)

> ⚠️ **Extensão da comunidade — não oficial.** Sem afiliação, endosso ou patrocínio da **Anthropic**.
> "Claude" e "Claude Code" são marcas da Anthropic, usadas aqui apenas para referência/interoperabilidade.
> _Community extension — **unofficial**. Not affiliated with, endorsed by, or sponsored by **Anthropic**.
> "Claude" and "Claude Code" are trademarks of Anthropic, used here only for reference/interoperability._

Um indicador na **status bar do VSCode** que dá feedback visual constante do uso da sessão
do [Claude Code](https://claude.com/claude-code) — um anel de progresso + número, sem você
precisar parar pra rodar `/usage`.

## Apoiar o projeto

Esta extensão é **gratuita e open source**, mantida nas horas vagas. Se ela te poupa tempo (ou
dinheiro de API 😄) e você quiser retribuir, qualquer café ajuda — **totalmente opcional, e nada
fica atrás de paywall**.

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-apoiar-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/bortolabs)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-apoiar-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/bortolabs)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-apoiar-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/bortolabs)

**Pix (Brasil):** `3a992bba-354b-406a-9d5a-40f9e18dab6f` (chave aleatória)

**Instale:**
- **Open VSX** (VSCodium, Cursor, Windsurf e também VS Code): procure por **"Claude Code Usage & Status"** ou veja a [página no Open VSX](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar).
- **`.vsix` (qualquer VS Code):** baixe o arquivo da [última release no GitHub](https://github.com/bortolabs/claude-code-usage-bar/releases/latest) e instale com `code --install-extension <arquivo>.vsix` (ou *Extensions → ⋯ → Install from VSIX…*).

> ℹ️ A listagem no **VS Code Marketplace** está **temporariamente indisponível** (em revisão junto ao suporte da Microsoft). Use o **Open VSX** ou o **`.vsix`** acima enquanto isso.

**Idiomas / Languages:** 🇧🇷 **Português** (base), 🇺🇸 **English**, 🇪🇸 **Español**,
🇫🇷 **Français**, 🇩🇪 **Deutsch**. Por padrão segue o idioma do VS Code, mas dá pra
**forçar** um idioma pelas **bandeiras** na aba **Config → Idioma** (troca toda a UI do
plugin na hora). Sem tradução para o idioma ativo, cai no português.

## Recursos por aba

- **Status bar** (o indicador) — anel/percentual da **cota real da sessão de 5h** (igual ao `/usage`) + tempo até o reset; 4 estilos (anel/barra/número/ícone), cor por **projeção de estouro**, e um modo que mostra **custo** no lugar da cota.
- **Aba Sessão** — cota 5h e **semana (7d)**, **cotas 7d por modelo (Sonnet/Opus)** com reset próprio, **contexto ao vivo** (% da janela do modelo), modelo em uso, **créditos extras** (se habilitados na conta), **metas de token** opcionais (5h/dia), **fonte de dados** ativa (oauth/statusline/ccusage) e o motivo do fallback; **alerta de burn rate** com **dica de ritmo** (quanto pausar/desacelerar pra não estourar antes do reset); **🧭 Copiloto de cota** — conselhos locais e contínuos (sem LLM): sugestão **Opus→Sonnet** quando a janela do Opus aperta, **o que ainda cabe até o reset** no ritmo atual e a **melhor janela** pra trabalho pesado.
- **Aba Custos** — hoje/mês/projeção e **orçamento mensal** com alerta; **sparklines** de custo e tokens por dia; seletor de janela (5h/Hoje/7d/30d) e **quebras** por modelo/projeto/**tamanho de contexto** (com custo por turno); contagem de **MCP/subagentes**; **Dicas** heurísticas de economia (locais) e **export de uso em JSON** (pra agentes/scripts).
- **Aba Status** — saúde da Anthropic ao vivo (`status.claude.com`): indicador geral, componentes, incidentes e resolvidos recentemente; **badge** na status bar e **notificação** de incidentes.
- **Aba Config** — edita os settings de forma visual (seções colapsáveis, toggles, file pickers), **idioma por bandeiras** 🇧🇷🇺🇸🇪🇸🇫🇷🇩🇪 e os **limiares das Dicas** ajustáveis.
- **Dashboard de analytics** (aba do editor, _Claude Usage: Abrir dashboard_) — **KPIs** (incl. **cache hit rate**), **composição de custo por tipo de token**, **gráfico ao longo do tempo** (empilhado, por hora/dia, com toggle), **insights** em linguagem natural, **comparativos** ("hoje vs média 7d", "semana vs anterior"), **heatmap semana × hora** de quando você mais usa (do **histórico local persistente**, que sobrevive à limpeza de transcripts), **tabelas** por modelo/período e **breakdowns** (modelo · projeto · sessão · contexto · skills · plugins · MCP · subagentes); janela **Hoje/Semana/Mês/Tudo**, **export `.html`**, **export CSV** das quebras e **AI advice** opcional — relatório de coaching por IA com **sua própria key** (uma **API key paga separada da assinatura**, ou um **LLM local grátis** / **free tier**; veja abaixo).

> Tudo **local, sem rede e sem LLM** — exceto a cota real (`api/oauth/usage`), a aba **Status** e o **AI advice** (opt-in), que fazem chamadas externas.

## Screenshots

A **status bar** (que dá nome ao plugin) aparece no rodapé de cada print — anel/percentual da cota da sessão de 5h e tempo até o reset, sempre à vista.

Aba **Sessão** — anel da cota de 5h, barras de uso de tokens/tempo/semana, **contexto ao vivo**, modelo e fonte de dados. No topo, a **dica de ritmo** sugere quanto pausar (ou o quanto desacelerar) pra não estourar antes do reset:

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/01-sessao.png" width="340" alt="Aba Sessão: anel da cota de 5h, barras de uso de tokens, tempo e semana (7d), contexto ao vivo, modelo em uso, card 'Fonte de dados', e no topo a dica de ritmo do alerta de burn rate">
</p>

Aba **Custos** — hoje/mês/projeção, sparklines de custo e tokens por dia, seletor de janela (5h/Hoje/7d/30d) e quebras por modelo/projeto; mais abaixo, custo por **tamanho de contexto** (com custo por turno), contagem de **MCP/subagentes** e as **Dicas** heurísticas de economia:

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/02-custos.png" width="340" alt="Aba Custos: hoje/mês/projeção, sparklines de custo e tokens por dia, seletor de janela 5h/Hoje/7d/30d, e custo por modelo/projeto">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/03-custos-insights.png" width="340" alt="Aba Custos (continuação): custo por tamanho de contexto com custo por turno, contagem de chamadas MCP e de subagentes, e Dicas heurísticas de economia">
</p>

Aba **Status** (saúde da Anthropic ao vivo) e aba **Config** (seções colapsáveis, idioma com bandeiras e limiares das dicas ajustáveis):

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/04-status.png" width="340" alt="Aba Status: status da Anthropic ao vivo — incidentes ativos, componentes e resolvidos recentemente">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/05-config.png" width="340" alt="Aba Config: seções colapsáveis, card de Idioma com bandeiras, e os limiares das Dicas de custo ajustáveis">
</p>

**Dashboard de analytics** (_Claude Usage: Abrir dashboard_) — abre numa **aba do editor** uma visão pensada em **métricas e dimensões**: cards de KPI (Custo, Mensagens, Input, Output, Cache miss/hit e **cache hit rate**), **composição de custo por tipo de token**, **gráfico ao longo do tempo** (barras empilhadas, por hora/dia, com toggle de métrica), **insights** em linguagem natural, **tabelas** por modelo/período e **breakdowns** em barras (modelo · projeto · sessão · contexto · skills · plugins · MCP · subagentes). Seletor de janela **Hoje/Semana/Mês/Tudo**. Dá pra **exportar um `.html` autocontido** (_Claude Usage: Exportar dashboard (HTML)_) e gerar um **relatório de coaching por IA** opcional (_AI advice_, BYO key):

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/06-dashboard.png" width="900" alt="Dashboard de analytics numa aba do editor: cards de KPI (custo, mensagens, input, output, cache miss, cache hit, cache hit rate), barra de composição de custo por tipo de token, gráfico de barras empilhadas de uso ao longo do tempo, callouts de insights, tabelas por modelo e por período, e breakdowns em barras por modelo/projeto/sessão/contexto/skills/plugins/MCP/subagentes">
</p>

### AI advice — qual key usar (incl. opções grátis)

O **AI advice** usa **sua própria API key** (BYO). **Não** usa a sua assinatura do Claude Code — é uma chamada de API à parte. A key fica no **SecretStorage**.

**Passo-a-passo:**

1. Escolha um provedor abaixo e **obtenha a key** (ou instale o LLM local).
2. Rode **_Claude Usage: Definir chave do AI advice_** e cole a key. **Pule este passo em
   endpoint local** (`localhost`, `127.0.0.1`, `[::1]`): ali não é preciso key nenhuma. Se
   você configurar uma mesmo assim, ela continua sendo enviada — para servidor local com
   auth ligado.
3. Ajuste os settings `claudeUsageBar.aiAdviceApiStyle`, `aiAdviceEndpoint` e `aiAdviceModel` conforme a tabela.
4. No dashboard, clique **✦ AI advice** (ou rode _Claude Usage: AI advice_).

| Provedor | Onde pegar a key | `aiAdviceApiStyle` | `aiAdviceEndpoint` | `aiAdviceModel` (ex.) |
| --- | --- | --- | --- | --- |
| **Ollama** (local, grátis, privado) | sem key — instale em [ollama.com](https://ollama.com) e `ollama pull llama3.3` | `openai` | `http://localhost:11434/v1/chat/completions` | `llama3.3` |
| **LM Studio** (local, grátis) | sem key — baixe um modelo no app | `openai` | `http://localhost:1234/v1/chat/completions` | (o modelo carregado) |
| **Google Gemini** (free tier) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `openai` | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-flash-latest` |
| **Groq** (free tier) | [console.groq.com/keys](https://console.groq.com/keys) | `openai` | `https://api.groq.com/openai/v1/chat/completions` | `llama-3.3-70b-versatile` |
| **OpenRouter** (modelos `:free`) | [openrouter.ai/keys](https://openrouter.ai/keys) | `openai` | `https://openrouter.ai/api/v1/chat/completions` | `meta-llama/llama-3.3-70b-instruct:free` |
| **Anthropic** (padrão, **pago**) | [console.anthropic.com](https://console.anthropic.com) | `anthropic` | (vazio = `/v1/messages`) | `claude-opus-4-8` |

> Modelos pequenos/locais dão conselhos mais simples; pra um relatório mais afiado, um modelo maior ajuda. **Local (Ollama/LM Studio) é o mais privado — os dados não saem da máquina.** De toda forma, o resto do plugin é 100% local; só o AI advice (opt-in) faz a chamada que você configurar.

Mostra a **cota real da sessão** — o mesmo número do `/usage` — em **qualquer ambiente**
(app, IDE ou terminal). O anel é o uso da sessão de 5h; a barra de tempo mostra quanto da
janela já passou.

| No anel | Exemplo |
| --- | --- |
| **% de uso da sessão de 5h** (igual ao `/usage`) + tempo até resetar | `◕ 17% · reseta 4h20` |

Passe o mouse para ver o resumo; clique para abrir o painel com o breakdown completo
(uso 5h/7d, tempo da sessão, custo equivalente, tokens, modelo, histórico).

## Como funciona

A extensão usa, em ordem de prioridade, a melhor fonte disponível:

1. **`api/oauth/usage`** (fonte primária) — o **mesmo endpoint que o `/usage` consulta**.
   Dá a **cota real** da sessão de 5h e da semana (7d), com o `resets_at` oficial. Lê o
   token OAuth localmente (env `CLAUDE_CODE_OAUTH_TOKEN`, ou `~/.claude/.credentials.json`,
   ou Keychain no macOS) e chama o endpoint — o token só vai para `api.anthropic.com`.
2. **statusline** (`~/.claude/usage-state.json`) — quando você roda o Claude Code no
   terminal/TUI, ela expõe os mesmos limites; usada se o oauth não estiver disponível.
3. **ccusage** (`ccusage blocks --active`) — deriva a sessão de 5h dos transcripts; usada
   para a **barra de tempo** e como fallback do uso. Requer `npx`/`ccusage`.

```
   api/oauth/usage          statusline (terminal)        transcripts (.jsonl)
   (cota real 5h/7d)        ~/.claude/usage-state.json   ccusage blocks (tempo/fallback)
        │                          │                            │
        └──────────────►  Claude Code Usage Bar (VSCode)  ◄─────┘
                 (oauth > statusline > ccusage)
```

> O **anel** mostra a cota real (oauth); a **barra de tempo** vem do ccusage (janela real
> ancorada no reset do oauth). Em **assinatura**, o custo em `$` é só "equivalente API"
> (referência), não cobrança — veja a seção de custo abaixo.

## Instalação

### 1. A extensão

- **Marketplace (recomendado):** no VSCode → `Extensions` → busque
  **"Claude Code Usage & Status"** → `Install`. Ou pela
  [página do Marketplace](https://marketplace.visualstudio.com/items?itemName=bortolabs.claude-code-usage-bar).
- **Via VSIX:** baixe o `.vsix` em [Releases](https://github.com/bortolabs/claude-code-usage-bar/releases),
  então no VSCode: `Extensions` → menu `…` → `Install from VSIX…`.
- **Do código:** `npm install && npm run compile`, depois abra a pasta e tecle `F5`
  (Extension Development Host).

### 2. ccusage (fonte principal)

A extensão chama o `ccusage` automaticamente via `npx`. Para evitar a latência do `npx`,
instale global e aponte o setting `claudeUsageBar.ccusageCommand`:

```bash
npm i -g ccusage
# depois, no settings.json:
# "claudeUsageBar.ccusageCommand": "ccusage blocks --active --json"
```

### 3. A bridge na statusline (opcional — só pra ter os limites reais 5h/7d no terminal)

Só necessária se você usa o Claude Code no **terminal** e quer os percentuais reais do
plano (em vez do % de tempo). Há duas situações.

**Se você JÁ tem uma statusline** (`statusLine` no seu `~/.claude/settings.json`),
adicione este bloco ao seu script de statusline, **antes** do `printf`/`echo` final.
Ele assume que o JSON do stdin está numa variável `input` (padrão dos scripts de
statusline) e que `jq` está instalado:

```sh
# --- bridge p/ Claude Code Usage Bar (VSCode): grava estado de uso ---
state_file="$HOME/.claude/usage-state.json"
printf '%s' "$input" | jq -c '{
  ts: (now | floor),
  model: (.model.display_name // .model.id // ""),
  session_id: (.session_id // ""),
  session_name: (.session_name // ""),
  cwd: (.cwd // .workspace.current_dir // ""),
  cost_usd: (.cost.total_cost_usd // 0),
  context: {
    input: (.context_window.total_input_tokens // 0),
    output: (.context_window.total_output_tokens // 0),
    size: (.context_window.context_window_size // 0),
    used_pct: (.context_window.used_percentage // null)
  },
  last_call: (.context_window.current_usage // null),
  five_hour: (.rate_limits.five_hour // null),
  seven_day: (.rate_limits.seven_day // null)
}' > "$state_file.tmp" 2>/dev/null && mv "$state_file.tmp" "$state_file" 2>/dev/null
# --- fim bridge ---
```

**Se você NÃO tem statusline ainda**, copie o script pronto deste repositório
([`scripts/usage-bridge-statusline.sh`](scripts/usage-bridge-statusline.sh)) para
`~/.claude/` e aponte o `settings.json` para ele:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/usage-bridge-statusline.sh"
  }
}
```

> A escrita é atômica (`.tmp` + `mv`), então a extensão nunca lê o arquivo pela metade.
> `jq` precisa estar disponível (`brew install jq` no macOS).

### 4. Pronto

Com o ccusage disponível, o indicador aparece assim que houver uma sessão ativa nos
transcripts. Se você usa o terminal e configurou a bridge, os limites reais 5h/7d
aparecem por cima quando estão frescos.

## Visual: status bar + painel

Você escolhe como ver:

- **Na status bar** (sempre visível) — estilo configurável em `claudeUsageBar.barStyle`
  ou pelos botões no painel:
  - `ring` → `◕ 6% · 4h42` (padrão)
  - `bar` → `█░░░░ 6% · 4h42`
  - `number` → `6% · 4h42`
  - `icon` → ícone + número
- **Ícone na Activity Bar** (lateral esquerda) — abre o painel completo, organizado em
  **4 abas** (a aba ativa é lembrada):
  - **Sessão** — anel SVG + uso 5h/7d + tempo da sessão + **contexto ao vivo** (do transcript).
  - **Custos** — hoje/mês/projeção + sparklines de custo/tokens por dia + quebras (modelo,
    projeto, contexto, MCP/subagentes) com janela ajustável (5h/hoje/7d/30d) + **Dicas**.
  - **Status** — status da Anthropic (`status.claude.com`): geral, componentes, incidentes
    ativos e histórico. Avisa com badge ☁ na status bar e notificação quando há problema.
  - **Config** — edite todos os settings por controles visuais (toggles, selects, números,
    cor), com botões de comando e link para o `settings.json`.
  Clicar no item da status bar (ou _Claude Usage: Abrir painel_) revela essa view.
- **Dashboard (aba do editor)** — _Claude Usage: Abrir dashboard_ (ou o botão ⛶ no topo do
  painel) abre **tudo de uma vez** num **grid amplo** com as seções expandidas, em vez das
  abas estreitas. _Claude Usage: Exportar dashboard (HTML)_ (botão ⬇) gera um **`.html`
  autocontido** (snapshot) pra abrir no navegador/compartilhar.

## Custo: assinatura vs API

O número em dólar do ccusage é o **equivalente em preço de API**. Se você tem **assinatura**
(Pro/Max), isso **não é cobrança** — enquanto não estourar os limites do plano (5h/7d), o
custo adicional é zero. Por isso, com `accountType: subscription` (ou `auto`), o `$` aparece
só como referência ("~$X, sua assinatura cobre"), **sem teto e sem alerta de custo**. O foco
fica em **tempo da sessão de 5h** e nos **limites do plano**.

Se você usa **API/pay-as-you-go**, defina `accountType: api` — aí o custo é real, com teto
(`costCapUsd`) e alerta.

## Aba "Custos" & Dicas

A aba **Custos** reúne o gasto num lugar só: **hoje / mês / projeção** (números do ccusage),
**barra de orçamento** (`monthlyBudgetUsd`, só API) e quebras **por modelo**, **por projeto**
(inclui o grupo "subagentes"), **por tamanho de contexto** e a **contagem** de chamadas por
servidor **MCP** e por **subagente**. As quebras de custo vêm de uma **tabela de preços local**
sobre os seus transcripts — **local, sem rede, sem LLM** — sempre rotuladas **"≈ aproximado ·
tabela vX"**. O custo oficial continua sendo o do ccusage; a tabela só serve pra **atribuir**.

O card **Dicas** sugere economia a partir desses números (ex.: contexto grande puxando o gasto
→ `/compact`; muita releitura de cache; Opus concentrando o custo → Sonnet/Haiku para tarefas
leves). Desligue toda essa análise (e a leitura de disco) com `insightsEnabled: false`.

## Alerta de burn rate

A extensão avisa quando o **ritmo de gasto** projeta estourar antes do reset — algo que o
`/usage` não mostra. Três gatilhos:

- **Projeção de custo** do bloco passa do teto (`costCapUsd`).
- **Ritmo alto**: `$/h` acima de `burnRateMaxPerHour`.
- **Limites do plano** (no terminal): projeção de 5h/7d atingir 100% antes do reset.

Quando dispara: notificação do VSCode (com "Silenciar 1h"), ícone ⚠ e vermelho na status
bar, e uma faixa no topo do painel. Desligue com `burnRateAlertEnabled: false`.

## Alerta de cota baixa

Além do burn rate (que olha o **ritmo**), há um aviso simples por **cota restante**: quando
sobra **menos que X%** (`lowQuotaThreshold`, padrão **15%**) na sessão de **5h** ou na semana
de **7d**, a extensão notifica com **quanto resta** e, quando há reset, **em quanto tempo a
janela vira** — com botões **"Abrir painel"** e **"Silenciar 1h"**.

- Avisa **1× por janela** e **re-arma sozinho** quando a cota se recupera.
- Só dispara com **cota real** (oauth/usage ou statusline) — **nunca** no fallback ccusage,
  pra não alarmar com número aproximado.
- `lowQuotaThreshold: 0` desliga. Ideal pra quem **não** usa o [export de uso](#export-de-uso-para-agentesscripts)
  (esse é o caminho recomendado pra automações/agentes).

> **Robustez do oauth/usage:** o endpoint tem **rate-limit próprio** e pode responder **429**
> por **chamadas frequentes demais** — independe da sua cota ter estourado (é comum aparecer
> "Quota reached" sem a cota cheia). Três defesas evitam isso: **uma chamada de cada vez**
> (colapsa o burst de gatilhos no startup), **coalescência do foco** (alt-tab não refaz o
> oauth se ele já está fresco — só as fontes locais atualizam) e **backoff exponencial gentil**
> (1ª falha recua ~20s, escalando até 15 min só se o 429 persistir, voltando ao normal no
> primeiro sucesso). A aba **Config → Fonte de dados** mostra o recuo em andamento.

## Uso

- **Clique** no item → abre o painel com o anel SVG.
- **Hover** → breakdown completo no tooltip.
- Paleta de comandos:
  - `Claude Usage: Abrir painel (anel SVG)`
  - `Claude Usage: Abrir dashboard`
  - `Claude Usage: Exportar dashboard (HTML)`
  - `Claude Usage: Alternar estilo da status bar`
  - `Claude Usage: Atualizar agora`
  - `Claude Usage: Verificar atualização agora` — pergunta ao Open VSX na hora, em vez de
    esperar a checagem diária. Serve porque instalação por `.vsix` nunca se atualiza sozinha.

## Configurações

> O **idioma** não é uma chave do `settings.json`: troque pelas bandeiras em **Config →
> Idioma** (guardado por máquina, por isso as bandeiras persistem).

Os grupos abaixo são os mesmos da aba **Config** do painel, na mesma ordem — se você achou um
setting lá, ele está sob o título correspondente aqui.

### Fonte e atualização

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.useOAuthUsage` | `true` | Usa `api/oauth/usage` (cota real, igual ao `/usage`) como fonte primária. |
| `claudeUsageBar.oauthRefreshSeconds` | `60` | Frequência de consulta ao endpoint oauth/usage. |
| `claudeUsageBar.ccusageCommand` | `npx -y ccusage@latest blocks --active --json` | Comando do ccusage. Aponte p/ um binário global p/ evitar latência do npx. |
| `claudeUsageBar.ccusageRefreshSeconds` | `60` | Frequência de atualização do ccusage. |
| `claudeUsageBar.stateFilePath` | `~/.claude/usage-state.json` | Caminho do arquivo da statusline. |
| `claudeUsageBar.staleAfterSeconds` | `900` | Janela em que o dado da statusline é considerado fresco. |

### Conta e limites

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.accountType` | `auto` | `subscription` (custo = referência, sem teto/alerta) ou `api` (custo real). `auto` = assinatura. |
| `claudeUsageBar.mode` | `auto` | `auto` decide a fonte; `subscriber` força limites 5h/7d; `cost` força custo. |
| `claudeUsageBar.costCapUsd` | `5` | Teto de custo (USD) p/ colorir o indicador. `0` desativa. |
| `claudeUsageBar.monthlyBudgetUsd` | `0` | Orçamento mensal (USD). `>0` liga a barra de orçamento e o alerta (mês/projeção). `0` desativa. |
| `claudeUsageBar.monthlyBudgetAlertEnabled` | `true` | Alerta de orçamento mensal. Desligado por padrão em assinatura. |
| `claudeUsageBar.insightsEnabled` | `true` | Analisa os transcripts locais p/ o custo por modelo. Desligue p/ pular a leitura de disco. |
| `claudeUsageBar.sessionTokenCap` | `0` | Teto de tokens por sessão de 5h (ex: `150000000`). Projeta o estouro de tokens no ritmo atual. `0` desativa. |
| `claudeUsageBar.intenseTokensPerMin` | `50000` | Ritmo tokens/min = 100% na cor por projeção (assinatura no app). |

### Aparência

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.ringTheme` | `semaforo` | Cor do anel: `semaforo`, `claude` (laranja), `mono`/`custom` (cor própria). Crítico sempre vermelho. |
| `claudeUsageBar.ringColor` | `#4caf78` | Cor hex usada quando `ringTheme` é `mono`/`custom`. |
| `claudeUsageBar.statusBarValue` | `quota` | O que o número mostra: `quota` (cota/tempo), `today` (custo de hoje `$`) ou `session` (custo do bloco 5h `$`). |
| `claudeUsageBar.alignment` | `right` | Lado da status bar (`right`/`left`). |
| `claudeUsageBar.priority` | `100` | Prioridade do item. |

### Alertas e cores

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.burnRateAlertEnabled` | `true` | Liga/desliga o alerta de burn rate (projeção de estouro). |
| `claudeUsageBar.burnRateMaxPerHour` | `20` | Alerta de ritmo: `$/h` acima disso dispara (em assinatura, só se definido). |
| `claudeUsageBar.alertCooldownMinutes` | `15` | Tempo mínimo entre notificações de alerta. |
| `claudeUsageBar.colorByProjection` | `true` | Colorir pela projeção de estouro (pior entre atual e projeção). |
| `claudeUsageBar.resetWarningMinutes` | `10` | Avisa quando faltar este tempo pro reset da sessão de 5h. `0` desativa. |
| `claudeUsageBar.lowQuotaThreshold` | `15` | Avisa quando restar menos que esta % de cota (5h ou 7d), só com cota real. `0` desativa. |
| `claudeUsageBar.blockSummaryEnabled` | `true` | Mostra resumo do consumo quando a sessão de 5h fecha. |
| `claudeUsageBar.warnThreshold` | `60` | % a partir do qual fica amarelo. |
| `claudeUsageBar.errorThreshold` | `85` | % a partir do qual fica vermelho. |

### Copiloto e histórico

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.advisorEnabled` | `true` | Copiloto de cota: conselhos locais na aba Sessão (troca Opus→Sonnet, o que cabe até o reset, melhor janela). Sem LLM, sem rede. |
| `claudeUsageBar.advisorNotifyEnabled` | `false` | Notificação nativa do copiloto (só a sugestão de troca de modelo). Desligada por padrão. |
| `claudeUsageBar.advisorCooldownHours` | `6` | Intervalo mínimo (horas) entre notificações do copiloto. |
| `claudeUsageBar.tokenGoalFiveHour` | `0` | Meta pessoal de tokens por janela de 5h (`0` = desligado). Mostra barra de progresso e aviso do copiloto ao estourar. |
| `claudeUsageBar.tokenGoalDaily` | `0` | Meta pessoal de tokens por dia (`0` = desligado). Mostra barra de progresso e aviso do copiloto ao estourar. |
| `claudeUsageBar.historyEnabled` | `true` | Grava um histórico local de uso (por dia/hora) que sobrevive à limpeza de transcripts do Claude Code — alimenta o heatmap e os comparativos do dashboard. |
| `claudeUsageBar.historyRetentionDays` | `365` | Dias de histórico local a manter (mínimo 7). |
| `claudeUsageBar.weeklySummaryEnabled` | `false` | Notificação semanal (às segundas) com o custo/tokens da semana vs a anterior. |

### Dicas de custo

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.tipsContextBigPct` | `25` | Dica de contexto: avisa quando turnos `>150k` somam ≥ esta % do custo. |
| `claudeUsageBar.tipsCacheReadPct` | `70` | Dica de cache: avisa quando a releitura (cache-read) passa desta % do input. |
| `claudeUsageBar.tipsOpusPct` | `70` | Dica de modelo: avisa quando o Opus concentra ≥ esta % do custo. |
| `claudeUsageBar.tipsMcpCalls` | `40` | Dica de MCP: avisa quando um servidor MCP passa deste nº de chamadas. |
| `claudeUsageBar.tipsSubagentPct` | `40` | Dica de subagentes: avisa quando somam ≥ esta % do custo. |

### Anomalias (desperdício)

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.anomalyDetectionEnabled` | `true` | Liga o detector de anomalias/desperdício (loop de tool, contexto inflado, cache hit baixo, MCP disparado). Aparece como card no painel e seção no dashboard. |
| `claudeUsageBar.anomalyNotifyEnabled` | `false` | Notifica com um aviso nativo quando há anomalia **crítica** (ex.: loop de tool). Desligado por padrão; re-arma sozinho por janela. |
| `claudeUsageBar.anomalyCacheHitMinPct` | `50` | Anomalia de cache: avisa quando o **cache hit rate** fica abaixo desta %. |
| `claudeUsageBar.anomalyMcpCallsMax` | `60` | Anomalia de MCP: avisa quando um servidor MCP é chamado **mais que** este número de vezes na janela (acima da dica, que é 40). |
| `claudeUsageBar.anomalyCtxInflatedTurns` | `3` | Anomalia de contexto: avisa quando há **pelo menos** este número de turnos com contexto acima de 200k. |
| `claudeUsageBar.anomalyToolLoopK` | `5` | Anomalia de loop: avisa quando a **mesma chamada de tool** se repete este número de vezes seguidas num turno. |

### Status da Anthropic

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.statusCheckEnabled` | `true` | Monitora o status da Anthropic (`status.claude.com`) e mostra a aba Status. |
| `claudeUsageBar.statusBadgeEnabled` | `true` | Badge ☁ na status bar quando há incidente. |
| `claudeUsageBar.statusNotifyEnabled` | `true` | Notifica (1× por incidente) novos problemas no ecossistema Anthropic. |
| `claudeUsageBar.statusRefreshSeconds` | `300` | Frequência de consulta ao status.claude.com. |
| `claudeUsageBar.updateCheckEnabled` | `true` | Avisa quando há versão nova publicada no Open VSX (consulta no máx. 1×/dia). Útil sobretudo para quem instalou pelo `.vsix`, que não recebe atualização automática. |

### AI advice (coaching por IA)

Opt-in e com a sua própria key — veja **AI advice — qual key usar** acima para os presets
prontos. A key em si fica no cofre seguro do VS Code (SecretStorage), nunca num setting.

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.aiAdviceApiStyle` | `anthropic` | Estilo da API do AI advice: `anthropic` (`/v1/messages`) ou `openai` (compatível). |
| `claudeUsageBar.aiAdviceEndpoint` | `""` | Endpoint do AI advice (vazio = Anthropic `/v1/messages`). |
| `claudeUsageBar.aiAdviceModel` | `""` | Modelo do AI advice (vazio = `claude-opus-4-8`). |
| `claudeUsageBar.aiAdvicePromptWindowDays` | `30` | AI advice: janela (dias) para amostrar seus prompts. |
| `claudeUsageBar.aiAdviceMaxPrompts` | `40` | AI advice: número máximo de prompts amostrados. |

### Exportar uso (p/ agentes/scripts)

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.exportStateEnabled` | `true` | Gravar o arquivo de uso para agentes/scripts. |
| `claudeUsageBar.exportStatePath` | `""` | Caminho do export (vazio = `~/.claude/usage-bar.json`). |

### Painel e dashboard

Estes quatro não têm linha na aba Config — você muda direto pela UI (o seletor de janela em
cada aba, o comando de estilo da status bar). Ainda assim são settings normais.

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.barStyle` | `ring` | Estilo na status bar: `ring`, `bar`, `number` ou `icon`. |
| `claudeUsageBar.costWindow` | `5h` | Janela das **quebras** na aba Custos: `5h`/`today`/`7d`/`30d` (também ajustável pelo seletor na aba). |
| `claudeUsageBar.dashboardWindow` | `today` | Janela do dashboard de analytics (Hoje/Semana/Mês/Tudo). |
| `claudeUsageBar.tooltipDetail` | `full` | Detalhe do **card de hover** na status bar. `full` = rate limits + uso/tokens/modelos da janela ativa; `compact` = só rate limits + link. |

## Export de uso (para agentes/scripts)

O plugin grava um **JSON local** com o uso atual a cada atualização, para **automações**
lerem — por exemplo, um **agente em auto-mode** que deve **parar/avisar** quando a cota
restante ficar baixa. Vem **ligado por padrão** em **`~/.claude/usage-bar.json`** (caminho
cross-platform; no Windows resolve em `C:\Users\<você>\.claude\usage-bar.json`). Desligue ou
troque o caminho na aba **Config → Exportar uso**.

> Escrita **atômica** (`.tmp` + rename), **sem token** e **sem envio externo** — é um arquivo
> só local com o seu uso.

Formato (`v: 2`):

```json
{
  "v": 2,
  "ts": 1719400000000,
  "source": "oauth",
  "trustworthy": true,
  "level": "ok",
  "model": "Opus 4.8",
  "fiveHour": { "usedPct": 36, "remainingPct": 64, "resetsAt": 1719415000000 },
  "sevenDay": { "usedPct": 27, "remainingPct": 73, "resetsAt": 1719650000000 },
  "contextPct": 41,
  "cost": 4.81,
  "etaMinutes": null,
  "today": 7.42,
  "month": { "costUSD": 96.10, "projectedUSD": 142.30, "budgetUSD": 0, "overBudget": false },
  "byModel": [
    { "model": "Opus 4.8", "tokens": 62118770, "costUSD": 98.65, "approximate": true }
  ],
  "byProject": [
    { "project": "meu-app", "tokens": 41200000, "costUSD": 64.10, "approximate": true }
  ],
  "byBranch": [
    { "branch": "feat/login", "project": "meu-app", "tokens": 18300000, "costUSD": 28.40, "approximate": true }
  ]
}
```

- **`trustworthy`** só é `true` quando a fonte é **cota real** (`source` = `oauth` ou
  `statusline`). No fallback `ccusage` (que é **% de tempo**, não cota) vem `false` e os
  campos de cota ficam `null` — **nunca** confie no "remaining" quando `trustworthy` for `false`.
- **`remainingPct`** = quanto ainda resta da janela (0–100). **`resetsAt`** = epoch ms.
- **`today`/`month`** vêm do **ccusage** (custo oficial). **`byModel`** é **`approximate`**
  (atribuição por uma tabela de preços local) — bom p/ proporção entre modelos, não p/ fatura.
  Campos novos da `v2`; os da `v1` seguem iguais.
- **`byProject`/`byBranch`** também são **`approximate`**. O `byBranch` cruza o horário de
  cada turno com os checkouts do git (`git reflog`) do repo — responde "quanto custou a
  feature/PR X", mas a atribuição é por tempo (duas janelas em branches diferentes ao
  mesmo tempo se misturam).

Exemplo de loop com critério de parada (Python):

```python
import json, time, os

PATH = os.path.expanduser("~/.claude/usage-bar.json")

def cota_ok(minimo=15):
    try:
        d = json.load(open(PATH))
    except FileNotFoundError:
        return True  # sem dado ainda → não bloqueia
    if not d.get("trustworthy"):
        return True  # fonte aproximada → não decide pela cota
    fh = d.get("fiveHour") or {}
    return fh.get("remainingPct", 100) >= minimo

while cota_ok(minimo=15):
    rodar_proximo_passo_do_agente()
    time.sleep(2)
print("Cota 5h abaixo do mínimo — pausando o auto-mode.")
```

## Limitações

- A status bar nativa do VSCode renderiza apenas texto + ícones (codicons), não SVG
  arbitrário. O "círculo" é o glifo de anel que mais se aproxima (`○ ◔ ◑ ◕ ●`).
- Em contas com assinatura, os campos `rate_limits` só aparecem **após a primeira resposta
  da API** na sessão — até lá, o indicador mostra o custo/contexto como nas contas API.
- **Contexto** e **modelo** são do projeto da janela (a busca é restrita aos transcripts
  daquele workspace). Já a **cota** e o **custo do bloco de 5h** são da conta inteira — não
  dá pra separar por projeto. Duas janelas no mesmo projeto mostram a sessão mais recente dele.
- O **export JSON** é um arquivo único: com duas janelas em projetos diferentes, cada uma
  grava o contexto do **seu** projeto no mesmo caminho, alternadamente. Use
  `exportStatePath` com caminhos distintos por workspace se consumir o export em multi-projeto.

## Aviso / Disclaimer

Esta é uma **extensão independente, mantida pela comunidade**. **Não é oficial** e **não tem
qualquer afiliação, parceria, endosso ou patrocínio da Anthropic.** "Anthropic", "Claude" e
"Claude Code" são marcas de seus respectivos donos; são citadas aqui apenas para descrever a
interoperabilidade da ferramenta com o Claude Code. A extensão lê dados de uso **localmente**
na sua máquina e não coleta nem envia seus dados para o autor.

_This is an **independent, community-maintained** extension. It is **unofficial** and has **no
affiliation, partnership, endorsement, or sponsorship from Anthropic.** "Anthropic", "Claude",
and "Claude Code" are trademarks of their respective owners, referenced here only to describe
interoperability with Claude Code._

## Licença

MIT — veja [LICENSE](LICENSE).
