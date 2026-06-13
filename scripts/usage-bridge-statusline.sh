#!/bin/sh
# Statusline pronta para o Claude Code Usage Bar (VSCode).
# Imprime uma status line enxuta E grava ~/.claude/usage-state.json para a extensão.
# Requer: jq.
#
# Uso no ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash ~/.claude/usage-bridge-statusline.sh" }

input=$(cat)

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

# --- status line visível (personalize à vontade) ---
cwd=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // ""')
dir=$(basename "$cwd")
branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null)
model=$(echo "$input" | jq -r '.model.display_name // ""')
five=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')

parts="$dir"
[ -n "$branch" ] && parts="$parts  $branch"
[ -n "$model" ] && parts="$parts  $model"
[ -n "$five" ] && parts="$parts  5h: $(printf '%.0f' "$five")%"

printf '%s' "$parts"
