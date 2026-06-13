# Claude Code Usage Bar

Um indicador na **status bar do VSCode** que dá feedback visual constante do uso da sessão
do [Claude Code](https://claude.com/claude-code) — um anel de progresso + número, sem você
precisar parar pra rodar `/usage`.

Funciona para **todos os tipos de conta** e se adapta automaticamente:

| Conta | O que mostra | Exemplo |
| --- | --- | --- |
| **Assinatura** (Pro/Max) | Limite do plano: anel = janela de **5h**, número = janela de **7d** (igual ao `/usage`) | `◑ 38% · 7d 41%` |
| **API / pay-as-you-go** | **Custo** acumulado da sessão (não há limite de plano); anel reflete o contexto | `◕ $2.47` |

A detecção é automática: se o Claude Code reporta limites de plano (`rate_limits`), entra no
modo assinante; se não (contas API), entra no modo custo. Dá pra forçar um modo nas configurações.

Passe o mouse para ver o breakdown completo: limites 5h/7d (ou custo vs teto), uso da janela
de contexto, tokens da última chamada, custo, modelo e sessão.

## Como funciona

O VSCode não consegue ler a sessão do Claude Code diretamente. A ponte é a **statusline**
do próprio Claude Code: a cada turno, o Claude Code envia um JSON com os dados da sessão
para o comando de statusline via stdin. Um pequeno trecho nesse comando grava esse estado
em `~/.claude/usage-state.json`, e esta extensão observa o arquivo e desenha o indicador.

```
Claude Code (CLI)
   │  stdin JSON a cada turno (rate_limits, context_window, cost…)
   ▼
statusline-command.sh ──grava──> ~/.claude/usage-state.json
                                          │ fs.watch
                                          ▼
                                 Claude Code Usage Bar (VSCode)
```

Os números são os mesmos que o Claude Code calcula. Em contas com assinatura, vêm de
`rate_limits.five_hour/seven_day.used_percentage` (os campos que alimentam o `/usage`).
Em contas API esses campos não existem, então o indicador usa `cost.total_cost_usd`, que
está sempre presente.

## Instalação

### 1. A extensão

- **Via VSIX:** baixe o `.vsix` em [Releases](https://github.com/bortolabs/claude-code-usage-bar/releases),
  então no VSCode: `Extensions` → menu `…` → `Install from VSIX…`.
- **Do código:** `npm install && npm run compile`, depois abra a pasta e tecle `F5`
  (Extension Development Host).

### 2. A bridge na statusline

A extensão precisa que a sua statusline grave o arquivo de estado. Há duas situações.

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

### 3. Pronto

Faça o Claude Code processar pelo menos uma resposta. O arquivo de estado é criado e o
indicador aparece. Os campos `rate_limits` só existem para assinantes **Pro/Max** e
**após a primeira resposta da API** na sessão — antes disso o indicador cai
automaticamente para o uso de contexto (mostrado com `~` na frente).

## Uso

- **Hover** → breakdown completo.
- **Clique** no item → abre o arquivo de estado.
- Paleta de comandos:
  - `Claude Usage: Atualizar agora`
  - `Claude Usage: Abrir arquivo de estado`

## Configurações

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.mode` | `auto` | `auto` detecta o tipo de conta; `subscriber` força 5h/7d; `cost` força custo $. |
| `claudeUsageBar.costCapUsd` | `5` | Teto de custo (USD) p/ colorir no modo custo / contas API. `0` desativa. |
| `claudeUsageBar.stateFilePath` | `~/.claude/usage-state.json` | Caminho do arquivo de estado. |
| `claudeUsageBar.warnThreshold` | `60` | % a partir do qual fica amarelo. |
| `claudeUsageBar.errorThreshold` | `85` | % a partir do qual fica vermelho. |
| `claudeUsageBar.alignment` | `right` | Lado da status bar (`right`/`left`). |
| `claudeUsageBar.priority` | `100` | Prioridade do item. |
| `claudeUsageBar.staleAfterSeconds` | `900` | Segundos sem atualização até esmaecer. |

## Limitações

- A status bar nativa do VSCode renderiza apenas texto + ícones (codicons), não SVG
  arbitrário. O "círculo" é o glifo de anel que mais se aproxima (`○ ◔ ◑ ◕ ●`).
- Em contas com assinatura, os campos `rate_limits` só aparecem **após a primeira resposta
  da API** na sessão — até lá, o indicador mostra o custo/contexto como nas contas API.
- Mostra a última sessão que escreveu o estado; várias sessões simultâneas compartilham
  o mesmo arquivo.

## Licença

MIT — veja [LICENSE](LICENSE).
