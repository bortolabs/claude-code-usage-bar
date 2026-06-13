# Claude Code Usage Bar

Um indicador na **status bar do VSCode** que dá feedback visual constante do uso da sessão
do [Claude Code](https://claude.com/claude-code) — um anel de progresso + número, sem você
precisar parar pra rodar `/usage`.

Funciona para **todos os tipos de conta** e em **qualquer ambiente**, adaptando a fonte:

| Situação | O que mostra | Exemplo |
| --- | --- | --- |
| **App / IDE** (qualquer conta) | Sessão de **5h** via ccusage: % de tempo decorrido + tempo até resetar | `◑ 6% · 4h42` |
| **Terminal** (assinante Pro/Max) | Limite real do plano: janela **5h** + tempo até resetar (igual ao `/usage`) | `◕ 63% · 40m` |

A fonte é escolhida automaticamente: se a statusline do terminal tem dados frescos com os
limites do plano, usa eles; senão, usa o ccusage (sempre disponível).

Passe o mouse para ver o breakdown completo: limites 5h/7d (ou custo vs teto), uso da janela
de contexto, tokens da última chamada, custo, modelo e sessão.

## Como funciona

A extensão tem **duas fontes**, e usa a melhor disponível:

1. **ccusage** (sempre disponível) — calcula a **sessão de 5h** a partir dos transcripts
   do Claude Code (`ccusage blocks --active`). Dá o **% de tempo decorrido da sessão**,
   o **tempo até resetar** e o **custo real** do bloco. Funciona em qualquer ambiente
   (app, IDE ou terminal). Requer `npx`/`ccusage` disponível.
2. **statusline** (só no terminal/TUI) — quando você roda o Claude Code no terminal, a
   statusline expõe os **limites reais do plano** (`rate_limits.five_hour/seven_day`,
   os mesmos do `/usage`). Quando esse dado está fresco, ele tem prioridade.

```
   transcripts (.jsonl)            statusline (só no terminal TUI)
        │ ccusage blocks                  │ grava ~/.claude/usage-state.json
        ▼                                 ▼
        └──────────►  Claude Code Usage Bar (VSCode)  ◄──────────┘
                 (prefere statusline fresca; senão ccusage)
```

> **Por que duas fontes?** Os limites 5h/7d que o `/usage` mostra só existem nos headers
> HTTP da resposta da API e só são expostos pela **statusline — que só roda no terminal**.
> No app/IDE a statusline não dispara por turno, então a sessão de 5h é derivada dos
> transcripts pelo ccusage, garantindo feedback constante em qualquer lugar.

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
- **Painel com anel SVG real** (estilo app do Claude) — clique no item da status bar
  ou rode _Claude Usage: Abrir painel_. Mostra o círculo de progresso grande, barras
  de cada métrica e **botões para trocar o estilo da status bar**, tudo ao vivo.

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
| `claudeUsageBar.mode` | `auto` | `auto` decide a fonte; `subscriber` força limites 5h/7d; `cost` força custo. |
| `claudeUsageBar.barStyle` | `ring` | Estilo na status bar: `ring`, `bar`, `number` ou `icon`. |
| `claudeUsageBar.costCapUsd` | `5` | Teto de custo (USD) p/ colorir o indicador. `0` desativa. |
| `claudeUsageBar.stateFilePath` | `~/.claude/usage-state.json` | Caminho do arquivo da statusline. |
| `claudeUsageBar.warnThreshold` | `60` | % a partir do qual fica amarelo. |
| `claudeUsageBar.errorThreshold` | `85` | % a partir do qual fica vermelho. |
| `claudeUsageBar.alignment` | `right` | Lado da status bar (`right`/`left`). |
| `claudeUsageBar.priority` | `100` | Prioridade do item. |
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
