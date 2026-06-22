# Claude Code Usage & Status

Um indicador na **status bar do VSCode** que dá feedback visual constante do uso da sessão
do [Claude Code](https://claude.com/claude-code) — um anel de progresso + número, sem você
precisar parar pra rodar `/usage`.

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

## Alerta de burn rate

A extensão avisa quando o **ritmo de gasto** projeta estourar antes do reset — algo que o
`/usage` não mostra. Três gatilhos:

- **Projeção de custo** do bloco passa do teto (`costCapUsd`).
- **Ritmo alto**: `$/h` acima de `burnRateMaxPerHour`.
- **Limites do plano** (no terminal): projeção de 5h/7d atingir 100% antes do reset.

Quando dispara: notificação do VSCode (com "Silenciar 1h"), ícone ⚠ e vermelho na status
bar, e uma faixa no topo do painel. Desligue com `burnRateAlertEnabled: false`.

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
| `claudeUsageBar.costCapUsd` | `5` | Teto de custo (USD) p/ colorir o indicador. `0` desativa. |
| `claudeUsageBar.stateFilePath` | `~/.claude/usage-state.json` | Caminho do arquivo da statusline. |
| `claudeUsageBar.warnThreshold` | `60` | % a partir do qual fica amarelo. |
| `claudeUsageBar.errorThreshold` | `85` | % a partir do qual fica vermelho. |
| `claudeUsageBar.alignment` | `right` | Lado da status bar (`right`/`left`). |
| `claudeUsageBar.priority` | `100` | Prioridade do item. |
| `claudeUsageBar.colorByProjection` | `true` | Colorir pela projeção de estouro (pior entre atual e projeção). |
| `claudeUsageBar.intenseTokensPerMin` | `50000` | Ritmo tokens/min = 100% na cor por projeção (assinatura no app). |
| `claudeUsageBar.sessionTokenCap` | `0` | Teto de tokens por sessão de 5h (ex: `150000000`). Projeta o estouro de tokens no ritmo atual. `0` desativa. |
| `claudeUsageBar.resetWarningMinutes` | `10` | Avisa quando faltar este tempo pro reset da sessão de 5h. `0` desativa. |
| `claudeUsageBar.burnRateAlertEnabled` | `true` | Liga/desliga o alerta de burn rate (projeção de estouro). |
| `claudeUsageBar.burnRateMaxPerHour` | `20` | Alerta de ritmo: `$/h` acima disso dispara (em assinatura, só se definido). |
| `claudeUsageBar.alertCooldownMinutes` | `15` | Tempo mínimo entre notificações de alerta. |
| `claudeUsageBar.ringTheme` | `semaforo` | Cor do anel: `semaforo`, `claude` (laranja), `mono`/`custom` (cor própria). Crítico sempre vermelho. |
| `claudeUsageBar.ringColor` | `#4caf78` | Cor hex usada quando `ringTheme` é `mono`/`custom`. |
| `claudeUsageBar.blockSummaryEnabled` | `true` | Mostra resumo do consumo quando a sessão de 5h fecha. |
| `claudeUsageBar.statusCheckEnabled` | `true` | Monitora o status da Anthropic (`status.claude.com`) e mostra a aba Status. |
| `claudeUsageBar.statusBadgeEnabled` | `true` | Badge ☁ na status bar quando há incidente. |
| `claudeUsageBar.statusNotifyEnabled` | `true` | Notifica (1× por incidente) novos problemas no ecossistema Anthropic. |
| `claudeUsageBar.statusRefreshSeconds` | `120` | Frequência de consulta ao status.claude.com. |
| `claudeUsageBar.staleAfterSeconds` | `900` | Janela em que o dado da statusline é considerado fresco. |

## Limitações

- A status bar nativa do VSCode renderiza apenas texto + ícones (codicons), não SVG
  arbitrário. O "círculo" é o glifo de anel que mais se aproxima (`○ ◔ ◑ ◕ ●`).
- Em contas com assinatura, os campos `rate_limits` só aparecem **após a primeira resposta
  da API** na sessão — até lá, o indicador mostra o custo/contexto como nas contas API.
- Mostra a última sessão que escreveu o estado; várias sessões simultâneas compartilham
  o mesmo arquivo.

## Licença

MIT — veja [LICENSE](LICENSE).
