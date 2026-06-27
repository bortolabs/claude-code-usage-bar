# Claude Code Usage & Status

[![Open VSX](https://img.shields.io/open-vsx/v/bortolabs/claude-code-usage-bar?label=Open%20VSX&color=a60ee5)](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar)
[![Release](https://img.shields.io/github/v/release/bortolabs/claude-code-usage-bar?label=release&color=4caf78)](https://github.com/bortolabs/claude-code-usage-bar/releases/latest)

> ⚠️ **Extensão da comunidade — não oficial.** Sem afiliação, endosso ou patrocínio da **Anthropic**.
> "Claude" e "Claude Code" são marcas da Anthropic, usadas aqui apenas para referência/interoperabilidade.
> _Community extension — **unofficial**. Not affiliated with, endorsed by, or sponsored by **Anthropic**.
> "Claude" and "Claude Code" are trademarks of Anthropic, used here only for reference/interoperability._

Um indicador na **status bar do VSCode** que dá feedback visual constante do uso da sessão
do [Claude Code](https://claude.com/claude-code) — um anel de progresso + número, sem você
precisar parar pra rodar `/usage`.

**Instale:**
- **Open VSX** (VSCodium, Cursor, Windsurf e também VS Code): procure por **"Claude Code Usage & Status"** ou veja a [página no Open VSX](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar).
- **`.vsix` (qualquer VS Code):** baixe o arquivo da [última release no GitHub](https://github.com/bortolabs/claude-code-usage-bar/releases/latest) e instale com `code --install-extension <arquivo>.vsix` (ou *Extensions → ⋯ → Install from VSIX…*).

> ℹ️ A listagem no **VS Code Marketplace** está **temporariamente indisponível** (em revisão junto ao suporte da Microsoft). Use o **Open VSX** ou o **`.vsix`** acima enquanto isso.

**Idiomas / Languages:** a interface segue o idioma do VS Code —
🇧🇷 **Português** (base), 🇺🇸 **English**, 🇪🇸 **Español**, 🇫🇷 **Français**, 🇩🇪 **Deutsch**.
Sem tradução para o idioma ativo, cai no português.

## Screenshots

Painel na aba **Sessão** (anel + barras de uso 5h/7d/contexto + fonte de dados) e a aba **Status** (status.claude.com):

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/01-painel-sessao.png" width="360" alt="Aba Sessão: anel de 71% da sessão de 5h, barras de uso de tokens, tempo, semana (7d) e contexto, modelo em uso, e o card 'Fonte de dados' mostrando a fonte ativa (oauth/usage — cota real)">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/02-status.png" width="360" alt="Aba Status: Todos os sistemas operacionais, incidentes ativos, componentes e histórico recente do status.claude.com">
</p>

Aba **Config** com **seções colapsáveis** (toggles, cores, alertas) e **Histórico** com projetos da sessão:

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/03-config.png" width="360" alt="Aba Config: seção Aparência aberta com o seletor visual de estilo (anel/barra/número/ícone), tema e cor do anel, lado e prioridade; demais seções recolhidas em cards colapsáveis (Fonte, Conta, Alertas, Status, Exportar uso)">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/04-historico.png" width="360" alt="Aba Histórico: sparkline dos últimos dias e barras de consumo por projeto na sessão de 5h">
</p>

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
  - **Sessão** — anel SVG + uso 5h/7d + tempo da sessão.
  - **Histórico** — sparkline dos últimos dias + **breakdown por projeto** do bloco de 5h
    ("Projetos nesta sessão"), mostrando quais projetos estão consumindo a janela atual.
  - **Status** — status da Anthropic (`status.claude.com`): geral, componentes, incidentes
    ativos e histórico. Avisa com badge ☁ na status bar e notificação quando há problema.
  - **Config** — edite todos os settings por controles visuais (toggles, selects, números,
    cor), com botões de comando e link para o `settings.json`.
  Clicar no item da status bar (ou _Claude Usage: Abrir painel_) revela essa view.

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
  - `Claude Usage: Alternar estilo da status bar`
  - `Claude Usage: Atualizar agora`

## Configurações

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.ccusageCommand` | `npx -y ccusage@latest blocks --active --json` | Comando do ccusage. Aponte p/ um binário global p/ evitar latência do npx. |
| `claudeUsageBar.ccusageRefreshSeconds` | `60` | Frequência de atualização do ccusage. |
| `claudeUsageBar.useOAuthUsage` | `true` | Usa `api/oauth/usage` (cota real, igual ao `/usage`) como fonte primária. |
| `claudeUsageBar.oauthRefreshSeconds` | `60` | Frequência de consulta ao endpoint oauth/usage. |
| `claudeUsageBar.accountType` | `auto` | `subscription` (custo = referência, sem teto/alerta) ou `api` (custo real). `auto` = assinatura. |
| `claudeUsageBar.mode` | `auto` | `auto` decide a fonte; `subscriber` força limites 5h/7d; `cost` força custo. |
| `claudeUsageBar.barStyle` | `ring` | Estilo na status bar: `ring`, `bar`, `number` ou `icon`. |
| `claudeUsageBar.statusBarValue` | `quota` | O que o número mostra: `quota` (cota/tempo), `today` (custo de hoje `$`) ou `session` (custo do bloco 5h `$`). |
| `claudeUsageBar.costCapUsd` | `5` | Teto de custo (USD) p/ colorir o indicador. `0` desativa. |
| `claudeUsageBar.monthlyBudgetUsd` | `0` | Orçamento mensal (USD). `>0` liga a barra de orçamento e o alerta (mês/projeção). `0` desativa. |
| `claudeUsageBar.monthlyBudgetAlertEnabled` | `true` | Alerta de orçamento mensal. Desligado por padrão em assinatura. |
| `claudeUsageBar.insightsEnabled` | `true` | Analisa os transcripts locais p/ o custo por modelo. Desligue p/ pular a leitura de disco. |
| `claudeUsageBar.costWindow` | `5h` | Janela das **quebras** na aba Custos: `5h`/`today`/`7d`/`30d` (também ajustável pelo seletor na aba). |
| `claudeUsageBar.tipsContextBigPct` | `25` | Dica de contexto: avisa quando turnos `>150k` somam ≥ esta % do custo. |
| `claudeUsageBar.tipsCacheReadPct` | `70` | Dica de cache: avisa quando a releitura (cache-read) passa desta % do input. |
| `claudeUsageBar.tipsOpusPct` | `70` | Dica de modelo: avisa quando o Opus concentra ≥ esta % do custo. |
| `claudeUsageBar.tipsMcpCalls` | `40` | Dica de MCP: avisa quando um servidor MCP passa deste nº de chamadas. |
| `claudeUsageBar.tipsSubagentPct` | `40` | Dica de subagentes: avisa quando somam ≥ esta % do custo. |
| `claudeUsageBar.stateFilePath` | `~/.claude/usage-state.json` | Caminho do arquivo da statusline. |
| `claudeUsageBar.warnThreshold` | `60` | % a partir do qual fica amarelo. |
| `claudeUsageBar.errorThreshold` | `85` | % a partir do qual fica vermelho. |
| `claudeUsageBar.alignment` | `right` | Lado da status bar (`right`/`left`). |
| `claudeUsageBar.priority` | `100` | Prioridade do item. |
| `claudeUsageBar.colorByProjection` | `true` | Colorir pela projeção de estouro (pior entre atual e projeção). |
| `claudeUsageBar.intenseTokensPerMin` | `50000` | Ritmo tokens/min = 100% na cor por projeção (assinatura no app). |
| `claudeUsageBar.sessionTokenCap` | `0` | Teto de tokens por sessão de 5h (ex: `150000000`). Projeta o estouro de tokens no ritmo atual. `0` desativa. |
| `claudeUsageBar.resetWarningMinutes` | `10` | Avisa quando faltar este tempo pro reset da sessão de 5h. `0` desativa. |
| `claudeUsageBar.lowQuotaThreshold` | `15` | Avisa quando restar menos que esta % de cota (5h ou 7d), só com cota real. `0` desativa. |
| `claudeUsageBar.burnRateAlertEnabled` | `true` | Liga/desliga o alerta de burn rate (projeção de estouro). |
| `claudeUsageBar.burnRateMaxPerHour` | `20` | Alerta de ritmo: `$/h` acima disso dispara (em assinatura, só se definido). |
| `claudeUsageBar.alertCooldownMinutes` | `15` | Tempo mínimo entre notificações de alerta. |
| `claudeUsageBar.ringTheme` | `semaforo` | Cor do anel: `semaforo`, `claude` (laranja), `mono`/`custom` (cor própria). Crítico sempre vermelho. |
| `claudeUsageBar.ringColor` | `#4caf78` | Cor hex usada quando `ringTheme` é `mono`/`custom`. |
| `claudeUsageBar.blockSummaryEnabled` | `true` | Mostra resumo do consumo quando a sessão de 5h fecha. |
| `claudeUsageBar.statusCheckEnabled` | `true` | Monitora o status da Anthropic (`status.claude.com`) e mostra a aba Status. |
| `claudeUsageBar.statusBadgeEnabled` | `true` | Badge ☁ na status bar quando há incidente. |
| `claudeUsageBar.statusNotifyEnabled` | `true` | Notifica (1× por incidente) novos problemas no ecossistema Anthropic. |
| `claudeUsageBar.statusRefreshSeconds` | `300` | Frequência de consulta ao status.claude.com. |
| `claudeUsageBar.staleAfterSeconds` | `900` | Janela em que o dado da statusline é considerado fresco. |
| `claudeUsageBar.exportStateEnabled` | `true` | Gravar o arquivo de uso para agentes/scripts. |
| `claudeUsageBar.exportStatePath` | `""` | Caminho do export (vazio = `~/.claude/usage-bar.json`). |

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
- Mostra a última sessão que escreveu o estado; várias sessões simultâneas compartilham
  o mesmo arquivo.

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
