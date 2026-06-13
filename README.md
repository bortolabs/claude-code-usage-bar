# Claude Code Usage Bar

Um indicador na **status bar do VSCode** que mostra, em tempo real, o uso da sessão do
[Claude Code](https://claude.com/claude-code) — um anel de progresso + percentual, igual
ao que o comando `/usage` mostra dentro do CLI.

```
◕ 24% 5h
```

Passe o mouse para ver o breakdown completo: limite de 5 horas, limite semanal (7 dias),
uso da janela de contexto, tokens da última chamada, custo estimado, modelo e sessão.

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

Os números são os mesmos que o Claude Code calcula — incluindo
`rate_limits.five_hour.used_percentage` e `rate_limits.seven_day.used_percentage`, os
campos que alimentam o `/usage`.

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

- **Clique** no item → alterna a métrica primária (5h → 7d → contexto).
- **Hover** → breakdown completo.
- Paleta de comandos:
  - `Claude Usage: Atualizar agora`
  - `Claude Usage: Abrir arquivo de estado`
  - `Claude Usage: Alternar métrica primária`

## Configurações

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `claudeUsageBar.stateFilePath` | `~/.claude/usage-state.json` | Caminho do arquivo de estado. |
| `claudeUsageBar.primaryMetric` | `fiveHour` | Métrica do anel: `fiveHour`, `sevenDay` ou `context`. |
| `claudeUsageBar.warnThreshold` | `60` | % a partir do qual fica amarelo. |
| `claudeUsageBar.errorThreshold` | `85` | % a partir do qual fica vermelho. |
| `claudeUsageBar.alignment` | `right` | Lado da status bar (`right`/`left`). |
| `claudeUsageBar.priority` | `100` | Prioridade do item. |
| `claudeUsageBar.staleAfterSeconds` | `900` | Segundos sem atualização até esmaecer. |

## Limitações

- A status bar nativa do VSCode renderiza apenas texto + ícones (codicons), não SVG
  arbitrário. O "círculo" é o glifo de anel que mais se aproxima (`○ ◔ ◑ ◕ ●`).
- Mostra a última sessão que escreveu o estado; várias sessões simultâneas compartilham
  o mesmo arquivo.

## Licença

MIT — veja [LICENSE](LICENSE).
