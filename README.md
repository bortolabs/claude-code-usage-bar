# Claude Code Usage & Status

[![Open VSX](https://img.shields.io/open-vsx/v/bortolabs/claude-code-usage-bar?label=Open%20VSX&color=a60ee5)](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar)
[![Downloads](https://img.shields.io/open-vsx/dt/bortolabs/claude-code-usage-bar?label=downloads&color=2f81f7)](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar)
[![Release](https://img.shields.io/github/v/release/bortolabs/claude-code-usage-bar?label=release&color=4caf78)](https://github.com/bortolabs/claude-code-usage-bar/releases/latest)

**🌐 Language / Idioma:** **English** · [Português (Brasil)](https://github.com/bortolabs/claude-code-usage-bar/blob/master/README.pt-BR.md)

> ⚠️ **Community extension — unofficial.** Not affiliated with, endorsed by, or sponsored by **Anthropic**.
> "Claude" and "Claude Code" are trademarks of Anthropic, used here only for reference/interoperability.

A **VS Code status bar** indicator that gives you constant visual feedback on your
[Claude Code](https://claude.com/claude-code) session usage — a progress ring + number,
without stopping to run `/usage`.

## Support the project

This extension is **free and open source**, maintained in spare time. If it saves you time
(or API money 😄) and you'd like to give back, any coffee helps — **entirely optional, and
nothing is behind a paywall**.

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-support-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/bortolabs)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/bortolabs)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/bortolabs)

**Pix (Brazil):** `3a992bba-354b-406a-9d5a-40f9e18dab6f` (random key)

**Install:**
- **Open VSX** (VSCodium, Cursor, Windsurf and also VS Code): search for **"Claude Code Usage & Status"** or see the [Open VSX page](https://open-vsx.org/extension/bortolabs/claude-code-usage-bar).
- **`.vsix` (any VS Code):** download the file from the [latest GitHub release](https://github.com/bortolabs/claude-code-usage-bar/releases/latest) and install it with `code --install-extension <file>.vsix` (or *Extensions → ⋯ → Install from VSIX…*).

> ℹ️ The **VS Code Marketplace** listing is **temporarily unavailable** (under review with Microsoft support). Use **Open VSX** or the **`.vsix`** above in the meantime.

**Plugin UI languages:** 🇧🇷 **Português** (base), 🇺🇸 **English**, 🇪🇸 **Español**,
🇫🇷 **Français**, 🇩🇪 **Deutsch**. It follows your VS Code language by default, but you can
**force** a language with the **flags** under **Config → Language** (switches the whole
plugin UI instantly). With no translation for the active language, it falls back to Portuguese.

## Features by tab

- **Status bar** (the indicator) — ring/percentage of the **real 5h session quota** (same as `/usage`) + time to reset; 4 styles (ring/bar/number/icon), color by **overrun projection**, and a mode that shows **cost** instead of quota.
- **Session tab** — 5h and **weekly (7d)** quota, **7d quotas per model (Sonnet/Opus)** with their own reset, **live context** (% of the model's window), model in use, **extra credits** (if enabled on your account), optional **token goals** (5h/day), the active **data source** (oauth/statusline/ccusage) and why it fell back; **burn rate alert** with a **pace hint** (how long to pause/slow down to avoid running out before the reset); **🧭 Quota copilot** — local, continuous advice (no LLM): **Opus→Sonnet** suggestion when the Opus window gets tight, **what still fits before the reset** at your current pace, and the **best window** for heavy work.
- **Costs tab** — today/month/projection and a **monthly budget** with alerts; **sparklines** of cost and tokens per day; window selector (5h/Today/7d/30d) and **breakdowns** by model/project/**context size** (with cost per turn); **MCP/subagent** call counts; heuristic (local) **saving tips** and a **usage export in JSON** (for agents/scripts).
- **Status tab** — live Anthropic health (`status.claude.com`): overall indicator, components, active incidents and recently resolved ones; status bar **badge** and incident **notifications**.
- **Config tab** — edit settings visually (collapsible sections, toggles, file pickers), **language via flags** 🇧🇷🇺🇸🇪🇸🇫🇷🇩🇪 and adjustable **tip thresholds**.
- **Analytics dashboard** (editor tab, _Claude Usage: Open dashboard_) — **KPIs** (incl. **cache hit rate**), **cost composition by token type**, **chart over time** (stacked, hourly/daily, with a toggle), natural-language **insights**, **comparisons** ("today vs 7d average", "week vs previous"), a **week × hour heatmap** of when you use it most (from the **persistent local history**, which survives transcript cleanup), **tables** by model/period and **breakdowns** (model · project · session · context · skills · plugins · MCP · subagents); **Today/Week/Month/All** window, **`.html` export**, **CSV export** of the breakdowns and optional **AI advice** — an AI coaching report using **your own key** (a **paid API key, separate from your subscription**, or a **free local LLM** / **free tier**; see below).

> Everything is **local, no network and no LLM** — except the real quota (`api/oauth/usage`), the **Status** tab and **AI advice** (opt-in), which make external calls.

## Screenshots

The **status bar** (which gives the plugin its name) appears at the bottom of every shot — ring/percentage of the 5h session quota and time to reset, always in sight.

**Session** tab — 5h quota ring, token/time/week usage bars, **live context**, model and data source. At the top, the **pace hint** suggests how long to pause (or how much to slow down) to avoid running out before the reset:

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/01-sessao.png" width="340" alt="Session tab: 5h quota ring, usage bars for tokens, time and week (7d), live context, model in use, 'Data source' card, and the burn rate pace hint at the top">
</p>

**Costs** tab — today/month/projection, sparklines of cost and tokens per day, window selector (5h/Today/7d/30d) and breakdowns by model/project; further down, cost by **context size** (with cost per turn), **MCP/subagent** counts and the heuristic **saving tips**:

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/02-custos.png" width="340" alt="Costs tab: today/month/projection, sparklines of cost and tokens per day, 5h/Today/7d/30d window selector, and cost by model/project">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/03-custos-insights.png" width="340" alt="Costs tab (continued): cost by context size with cost per turn, MCP and subagent call counts, and heuristic saving tips">
</p>

**Status** tab (live Anthropic health) and **Config** tab (collapsible sections, language flags and adjustable tip thresholds):

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/04-status.png" width="340" alt="Status tab: live Anthropic status — active incidents, components and recently resolved">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/05-config.png" width="340" alt="Config tab: collapsible sections, Language card with flags, and adjustable cost tip thresholds">
</p>

**Analytics dashboard** (_Claude Usage: Open dashboard_) — opens an **editor tab** with a view built around **metrics and dimensions**: KPI cards (Cost, Messages, Input, Output, Cache miss/hit and **cache hit rate**), **cost composition by token type**, **chart over time** (stacked bars, hourly/daily, with a metric toggle), natural-language **insights**, **tables** by model/period and bar **breakdowns** (model · project · session · context · skills · plugins · MCP · subagents). **Today/Week/Month/All** window selector. You can **export a self-contained `.html`** (_Claude Usage: Export dashboard (HTML)_) and generate an optional **AI coaching report** (_AI advice_, BYO key):

<p align="center">
  <img src="https://raw.githubusercontent.com/bortolabs/claude-code-usage-bar/master/media/screenshots/06-dashboard.png" width="900" alt="Analytics dashboard in an editor tab: KPI cards (cost, messages, input, output, cache miss, cache hit, cache hit rate), cost composition bar by token type, stacked bar chart of usage over time, insight callouts, tables by model and by period, and bar breakdowns by model/project/session/context/skills/plugins/MCP/subagents">
</p>

### AI advice — which key to use (incl. free options)

**AI advice** uses **your own API key** (BYO). It does **not** use your Claude Code
subscription — it's a separate API call. The key is stored in **SecretStorage**.

**Step by step:**

1. Pick a provider below and **get the key** (or install the local LLM).
2. Run **_Claude Usage: Set AI advice key_** and paste the key.
3. Adjust the `claudeUsageBar.aiAdviceApiStyle`, `aiAdviceEndpoint` and `aiAdviceModel` settings as per the table.
4. In the dashboard, click **✦ AI advice** (or run _Claude Usage: AI advice_).

| Provider | Where to get the key | `aiAdviceApiStyle` | `aiAdviceEndpoint` | `aiAdviceModel` (e.g.) |
| --- | --- | --- | --- | --- |
| **Ollama** (local, free, private) | no key — install from [ollama.com](https://ollama.com) and `ollama pull llama3.3` (key = any text) | `openai` | `http://localhost:11434/v1/chat/completions` | `llama3.3` |
| **LM Studio** (local, free) | no key — download a model in the app | `openai` | `http://localhost:1234/v1/chat/completions` | (the loaded model) |
| **Google Gemini** (free tier) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `openai` | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-flash-latest` |
| **Groq** (free tier) | [console.groq.com/keys](https://console.groq.com/keys) | `openai` | `https://api.groq.com/openai/v1/chat/completions` | `llama-3.3-70b-versatile` |
| **OpenRouter** (`:free` models) | [openrouter.ai/keys](https://openrouter.ai/keys) | `openai` | `https://openrouter.ai/api/v1/chat/completions` | `meta-llama/llama-3.3-70b-instruct:free` |
| **Anthropic** (default, **paid**) | [console.anthropic.com](https://console.anthropic.com) | `anthropic` | (empty = `/v1/messages`) | `claude-opus-4-8` |

> Small/local models give simpler advice; for a sharper report, a bigger model helps. **Local (Ollama/LM Studio) is the most private — your data never leaves the machine.** Either way, the rest of the plugin is 100% local; only AI advice (opt-in) makes the call you configure.

It shows the **real session quota** — the same number as `/usage` — in **any environment**
(app, IDE or terminal). The ring is the 5h session usage; the time bar shows how much of the
window has already passed.

| In the ring | Example |
| --- | --- |
| **% of 5h session usage** (same as `/usage`) + time to reset | `◕ 17% · resets in 4h20` |

Hover for the summary; click to open the panel with the full breakdown
(5h/7d usage, session time, equivalent cost, tokens, model, history).

## How it works

The extension uses the best available source, in priority order:

1. **`api/oauth/usage`** (primary source) — the **same endpoint `/usage` queries**.
   Gives the **real quota** for the 5h session and the week (7d), with the official
   `resets_at`. It reads the OAuth token locally (env `CLAUDE_CODE_OAUTH_TOKEN`, or
   `~/.claude/.credentials.json`, or the macOS Keychain) and calls the endpoint — the token
   only ever goes to `api.anthropic.com`.
2. **statusline** (`~/.claude/usage-state.json`) — when you run Claude Code in the
   terminal/TUI, it exposes the same limits; used when oauth isn't available.
3. **ccusage** (`ccusage blocks --active`) — derives the 5h session from the transcripts;
   used for the **time bar** and as a usage fallback. Requires `npx`/`ccusage`.

```
   api/oauth/usage          statusline (terminal)        transcripts (.jsonl)
   (real 5h/7d quota)       ~/.claude/usage-state.json   ccusage blocks (time/fallback)
        │                          │                            │
        └──────────────►  Claude Code Usage Bar (VSCode)  ◄─────┘
                 (oauth > statusline > ccusage)
```

> The **ring** shows the real quota (oauth); the **time bar** comes from ccusage (real window
> anchored on the oauth reset). On a **subscription**, the `$` cost is only an "API
> equivalent" (a reference), not a charge — see the cost section below.

## Installation

### 1. The extension

- **Marketplace (recommended):** in VS Code → `Extensions` → search for
  **"Claude Code Usage & Status"** → `Install`. Or via the
  [Marketplace page](https://marketplace.visualstudio.com/items?itemName=bortolabs.claude-code-usage-bar).
- **Via VSIX:** download the `.vsix` from [Releases](https://github.com/bortolabs/claude-code-usage-bar/releases),
  then in VS Code: `Extensions` → `…` menu → `Install from VSIX…`.
- **From source:** `npm install && npm run compile`, then open the folder and hit `F5`
  (Extension Development Host).

### 2. ccusage (main source)

The extension calls `ccusage` automatically via `npx`. To avoid `npx` latency, install it
globally and point the `claudeUsageBar.ccusageCommand` setting at it:

```bash
npm i -g ccusage
# then, in settings.json:
# "claudeUsageBar.ccusageCommand": "ccusage blocks --active --json"
```

### 3. The statusline bridge (optional — only to get the real 5h/7d limits in the terminal)

Only needed if you use Claude Code in the **terminal** and want the plan's real percentages
(instead of the % of time). There are two situations.

**If you ALREADY have a statusline** (`statusLine` in your `~/.claude/settings.json`), add
this block to your statusline script, **before** the final `printf`/`echo`. It assumes the
stdin JSON is in an `input` variable (the standard in statusline scripts) and that `jq` is
installed:

```sh
# --- bridge for Claude Code Usage Bar (VSCode): writes usage state ---
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
# --- end bridge ---
```

**If you DON'T have a statusline yet**, copy the ready-made script from this repository
([`scripts/usage-bridge-statusline.sh`](https://github.com/bortolabs/claude-code-usage-bar/blob/master/scripts/usage-bridge-statusline.sh))
to `~/.claude/` and point `settings.json` at it:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/usage-bridge-statusline.sh"
  }
}
```

> The write is atomic (`.tmp` + `mv`), so the extension never reads a half-written file.
> `jq` must be available (`brew install jq` on macOS).

### 4. Done

With ccusage available, the indicator shows up as soon as there's an active session in the
transcripts. If you use the terminal and configured the bridge, the real 5h/7d limits take
over whenever they're fresh.

## Visuals: status bar + panel

You choose how to see it:

- **In the status bar** (always visible) — style configurable via `claudeUsageBar.barStyle`
  or the buttons in the panel:
  - `ring` → `◕ 6% · 4h42` (default)
  - `bar` → `█░░░░ 6% · 4h42`
  - `number` → `6% · 4h42`
  - `icon` → icon + number
- **Activity Bar icon** (left side) — opens the full panel, organized in **4 tabs** (the
  active tab is remembered):
  - **Session** — SVG ring + 5h/7d usage + session time + **live context** (from the transcript).
  - **Costs** — today/month/projection + cost/token sparklines per day + breakdowns (model,
    project, context, MCP/subagents) with an adjustable window (5h/today/7d/30d) + **Tips**.
  - **Status** — Anthropic status (`status.claude.com`): overall, components, active
    incidents and history. Warns with a ☁ badge in the status bar and a notification on issues.
  - **Config** — edit every setting with visual controls (toggles, selects, numbers, color),
    with command buttons and a link to `settings.json`.
  Clicking the status bar item (or _Claude Usage: Open panel_) reveals this view.
- **Dashboard (editor tab)** — _Claude Usage: Open dashboard_ (or the ⛶ button at the top of
  the panel) opens **everything at once** in a **wide grid** with sections expanded, instead
  of the narrow tabs. _Claude Usage: Export dashboard (HTML)_ (the ⬇ button) generates a
  **self-contained `.html`** (snapshot) to open in a browser or share.

## Cost: subscription vs API

The dollar figure from ccusage is the **API-price equivalent**. If you have a **subscription**
(Pro/Max), that is **not a charge** — as long as you stay within the plan limits (5h/7d), the
extra cost is zero. That's why, with `accountType: subscription` (or `auto`), the `$` shows
only as a reference ("~$X, your subscription covers it"), **with no cap and no cost alert**.
The focus stays on the **5h session time** and the **plan limits**.

If you use **API/pay-as-you-go**, set `accountType: api` — then the cost is real, with a cap
(`costCapUsd`) and an alert.

## "Costs" tab & Tips

The **Costs** tab gathers spending in one place: **today / month / projection** (ccusage
numbers), a **budget bar** (`monthlyBudgetUsd`, API only) and breakdowns **by model**, **by
project** (including the "subagents" group), **by context size** and the **count** of calls
per **MCP** server and per **subagent**. The cost breakdowns come from a **local price table**
applied to your transcripts — **local, no network, no LLM** — always labeled **"≈ approximate ·
table vX"**. The official cost is still ccusage's; the table only serves to **attribute** it.

The **Tips** card suggests savings from those numbers (e.g. a large context driving spend
→ `/compact`; heavy cache re-reads; Opus concentrating the cost → Sonnet/Haiku for light
tasks). Turn off all of this analysis (and the disk reads) with `insightsEnabled: false`.

## Burn rate alert

The extension warns you when your **spending pace** projects an overrun before the reset —
something `/usage` doesn't show. Three triggers:

- **Cost projection** for the block exceeds the cap (`costCapUsd`).
- **High pace**: `$/h` above `burnRateMaxPerHour`.
- **Plan limits** (in the terminal): the 5h/7d projection reaching 100% before the reset.

When it fires: a VS Code notification (with "Mute for 1h"), a ⚠ icon and red in the status
bar, and a banner at the top of the panel. Turn it off with `burnRateAlertEnabled: false`.

## Low quota alert

Beyond the burn rate (which watches the **pace**), there's a simple **remaining quota**
warning: when **less than X%** is left (`lowQuotaThreshold`, default **15%**) in the **5h**
session or the **7d** week, the extension notifies you with **how much is left** and, when
there's a reset, **how long until the window turns over** — with **"Open panel"** and
**"Mute for 1h"** buttons.

- Warns **once per window** and **re-arms itself** when the quota recovers.
- Only fires with **real quota** (oauth/usage or statusline) — **never** on the ccusage
  fallback, so it doesn't alarm you with an approximate number.
- `lowQuotaThreshold: 0` disables it. Ideal for anyone **not** using the
  [usage export](#usage-export-for-agentsscripts) (that's the recommended path for
  automations/agents).

> **oauth/usage robustness:** the endpoint has **its own rate limit** and may answer **429**
> for **too-frequent calls** — regardless of your quota being exhausted (it's common to see
> "Quota reached" without a full quota). Three defenses avoid this: **one call at a time**
> (collapsing the burst of startup triggers), **focus coalescing** (alt-tab doesn't redo the
> oauth call if it's already fresh — only local sources refresh) and **gentle exponential
> backoff** (the first failure backs off ~20s, escalating to 15 min only if the 429 persists,
> returning to normal on the first success). The **Config → Data source** tab shows the
> backoff in progress.

## Usage

- **Click** the item → opens the panel with the SVG ring.
- **Hover** → full breakdown in the tooltip.
- Command palette:
  - `Claude Usage: Open panel (SVG ring)`
  - `Claude Usage: Open dashboard`
  - `Claude Usage: Export dashboard (HTML)`
  - `Claude Usage: Toggle status bar style`
  - `Claude Usage: Refresh now`

## Settings

> **Language** is not a `settings.json` key: switch it with the flags under **Config →
> Language** (stored per machine, so the flags persist).

The groups below are the same ones you see in the **Config** tab of the panel, in the same
order — if you found a setting there, it is under the matching heading here.

### Source and refresh

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.useOAuthUsage` | `true` | Use `api/oauth/usage` (real quota, same as `/usage`) as the primary source. |
| `claudeUsageBar.oauthRefreshSeconds` | `60` | How often the oauth/usage endpoint is queried. |
| `claudeUsageBar.ccusageCommand` | `npx -y ccusage@latest blocks --active --json` | ccusage command. Point it at a global binary to avoid npx latency. |
| `claudeUsageBar.ccusageRefreshSeconds` | `60` | How often ccusage refreshes. |
| `claudeUsageBar.stateFilePath` | `~/.claude/usage-state.json` | Path to the statusline file. |
| `claudeUsageBar.staleAfterSeconds` | `900` | Window during which statusline data is considered fresh. |

### Account and limits

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.accountType` | `auto` | `subscription` (cost = reference, no cap/alert) or `api` (real cost). `auto` = subscription. |
| `claudeUsageBar.mode` | `auto` | `auto` picks the source; `subscriber` forces 5h/7d limits; `cost` forces cost. |
| `claudeUsageBar.costCapUsd` | `5` | Cost cap (USD) used to color the indicator. `0` disables it. |
| `claudeUsageBar.monthlyBudgetUsd` | `0` | Monthly budget (USD). `>0` enables the budget bar and the alert (month/projection). `0` disables it. |
| `claudeUsageBar.monthlyBudgetAlertEnabled` | `true` | Monthly budget alert. Off by default on a subscription. |
| `claudeUsageBar.insightsEnabled` | `true` | Analyze local transcripts for cost per model. Turn off to skip the disk reads. |
| `claudeUsageBar.sessionTokenCap` | `0` | Token cap per 5h session (e.g. `150000000`). Projects the token overrun at the current pace. `0` disables it. |
| `claudeUsageBar.intenseTokensPerMin` | `50000` | Tokens/min pace that counts as 100% in the projection color (subscription in the app). |

### Appearance

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.ringTheme` | `semaforo` | Ring color: `semaforo` (traffic light), `claude` (orange), `mono`/`custom` (your own color). Critical is always red. |
| `claudeUsageBar.ringColor` | `#4caf78` | Hex color used when `ringTheme` is `mono`/`custom`. |
| `claudeUsageBar.statusBarValue` | `quota` | What the number shows: `quota` (quota/time), `today` (today's cost `$`) or `session` (5h block cost `$`). |
| `claudeUsageBar.alignment` | `right` | Status bar side (`right`/`left`). |
| `claudeUsageBar.priority` | `100` | Item priority. |

### Alerts and colors

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.burnRateAlertEnabled` | `true` | Enables/disables the burn rate alert (overrun projection). |
| `claudeUsageBar.burnRateMaxPerHour` | `20` | Pace alert: `$/h` above this fires (on a subscription, only if set). |
| `claudeUsageBar.alertCooldownMinutes` | `15` | Minimum time between alert notifications. |
| `claudeUsageBar.colorByProjection` | `true` | Color by overrun projection (worst of current and projected). |
| `claudeUsageBar.resetWarningMinutes` | `10` | Warns when this much time is left before the 5h session reset. `0` disables it. |
| `claudeUsageBar.lowQuotaThreshold` | `15` | Warns when less than this % of quota is left (5h or 7d), real quota only. `0` disables it. |
| `claudeUsageBar.blockSummaryEnabled` | `true` | Shows a consumption summary when the 5h session closes. |
| `claudeUsageBar.warnThreshold` | `60` | % from which it turns yellow. |
| `claudeUsageBar.errorThreshold` | `85` | % from which it turns red. |

### Copilot & history

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.advisorEnabled` | `true` | Quota copilot: local advice on the Session tab (Opus→Sonnet switch, what fits until reset, best window). No LLM, no network. |
| `claudeUsageBar.advisorNotifyEnabled` | `false` | Native copilot notification (model-switch suggestion only). Off by default. |
| `claudeUsageBar.advisorCooldownHours` | `6` | Minimum interval (hours) between copilot notifications. |
| `claudeUsageBar.tokenGoalFiveHour` | `0` | Personal token goal per 5h window (`0` = off). Shows a progress bar and a copilot notice when exceeded. |
| `claudeUsageBar.tokenGoalDaily` | `0` | Personal token goal per day (`0` = off). Shows a progress bar and a copilot notice when exceeded. |
| `claudeUsageBar.historyEnabled` | `true` | Keeps a local usage history (per day/hour) that survives Claude Code transcript cleanup — powers the dashboard heatmap and comparisons. |
| `claudeUsageBar.historyRetentionDays` | `365` | Days of local history to keep (minimum 7). |
| `claudeUsageBar.weeklySummaryEnabled` | `false` | Weekly notification (Mondays) with the week's cost/tokens vs the previous one. |

### Cost tips

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.tipsContextBigPct` | `25` | Context tip: warns when turns `>150k` account for ≥ this % of the cost. |
| `claudeUsageBar.tipsCacheReadPct` | `70` | Cache tip: warns when re-reads (cache-read) exceed this % of the input. |
| `claudeUsageBar.tipsOpusPct` | `70` | Model tip: warns when Opus concentrates ≥ this % of the cost. |
| `claudeUsageBar.tipsMcpCalls` | `40` | MCP tip: warns when an MCP server exceeds this number of calls. |
| `claudeUsageBar.tipsSubagentPct` | `40` | Subagent tip: warns when they add up to ≥ this % of the cost. |

### Anomalies (waste)

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.anomalyDetectionEnabled` | `true` | Turns on the anomaly/waste detector (tool loop, inflated context, low cache hit, MCP spike). Shows up as a card in the panel and a section in the dashboard. |
| `claudeUsageBar.anomalyNotifyEnabled` | `false` | Notify with a native alert when there's a **critical** anomaly (e.g. tool loop). Off by default; re-arms itself per window. |
| `claudeUsageBar.anomalyCacheHitMinPct` | `50` | Cache anomaly: warns when the **cache hit rate** falls below this %. |
| `claudeUsageBar.anomalyMcpCallsMax` | `60` | MCP anomaly: warns when an MCP server is called **more than** this many times in the window (above the cost tip, which is 40). |
| `claudeUsageBar.anomalyCtxInflatedTurns` | `3` | Context anomaly: warns when there are **at least** this many turns with context above 200k. |
| `claudeUsageBar.anomalyToolLoopK` | `5` | Loop anomaly: warns when the **same tool call** repeats this many times in a row within a turn. |

### Anthropic status

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.statusCheckEnabled` | `true` | Monitors Anthropic status (`status.claude.com`) and shows the Status tab. |
| `claudeUsageBar.statusBadgeEnabled` | `true` | ☁ badge in the status bar during an incident. |
| `claudeUsageBar.statusNotifyEnabled` | `true` | Notifies (once per incident) about new issues in the Anthropic ecosystem. |
| `claudeUsageBar.statusRefreshSeconds` | `300` | How often status.claude.com is queried. |
| `claudeUsageBar.updateCheckEnabled` | `true` | Notifies when a new version is published on Open VSX (checks at most once a day). Especially useful if you installed from the `.vsix`, which never auto-updates. |

### AI advice (AI coaching)

Opt-in and BYO key — see **AI advice — which key to use** above for ready-made presets. The
API key itself lives in VS Code's secure store (SecretStorage), never in a setting.

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.aiAdviceApiStyle` | `anthropic` | AI advice API style: `anthropic` (`/v1/messages`) or `openai` (compatible). |
| `claudeUsageBar.aiAdviceEndpoint` | `""` | AI advice endpoint (empty = Anthropic `/v1/messages`). |
| `claudeUsageBar.aiAdviceModel` | `""` | AI advice model (empty = `claude-opus-4-8`). |
| `claudeUsageBar.aiAdvicePromptWindowDays` | `30` | AI advice: window (days) to sample your prompts. |
| `claudeUsageBar.aiAdviceMaxPrompts` | `40` | AI advice: maximum number of sampled prompts. |

### Export usage (for agents/scripts)

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.exportStateEnabled` | `true` | Write the usage file for agents/scripts. |
| `claudeUsageBar.exportStatePath` | `""` | Export path (empty = `~/.claude/usage-bar.json`). |

### Panel & dashboard

These four have no row in the Config tab — you change them straight from the UI (the window
selector in each tab, the status bar style command). They are still plain settings.

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsageBar.barStyle` | `ring` | Status bar style: `ring`, `bar`, `number` or `icon`. |
| `claudeUsageBar.costWindow` | `5h` | Window for the **breakdowns** in the Costs tab: `5h`/`today`/`7d`/`30d` (also adjustable via the selector in the tab). |
| `claudeUsageBar.dashboardWindow` | `today` | Analytics dashboard window (Today/Week/Month/All). |
| `claudeUsageBar.tooltipDetail` | `full` | Detail level of the status-bar **hover card**. `full` = rate limits + usage/tokens/models for the active window; `compact` = rate limits + link only. |

## Usage export (for agents/scripts)

The plugin writes a **local JSON** with the current usage on every refresh, for
**automations** to read — for example, an **agent in auto-mode** that should **stop/warn**
when the remaining quota gets low. It's **on by default** at **`~/.claude/usage-bar.json`**
(a cross-platform path; on Windows it resolves to `C:\Users\<you>\.claude\usage-bar.json`).
Turn it off or change the path under **Config → Export usage**.

> **Atomic** write (`.tmp` + rename), **no token** and **no external sending** — it's a
> local-only file with your usage.

Format (`v: 2`):

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
    { "project": "my-app", "tokens": 41200000, "costUSD": 64.10, "approximate": true }
  ],
  "byBranch": [
    { "branch": "feat/login", "project": "my-app", "tokens": 18300000, "costUSD": 28.40, "approximate": true }
  ]
}
```

- **`trustworthy`** is only `true` when the source is a **real quota** (`source` = `oauth` or
  `statusline`). On the `ccusage` fallback (which is **% of time**, not quota) it comes as
  `false` and the quota fields are `null` — **never** trust "remaining" when `trustworthy` is `false`.
- **`remainingPct`** = how much of the window is left (0–100). **`resetsAt`** = epoch ms.
- **`today`/`month`** come from **ccusage** (official cost). **`byModel`** is **`approximate`**
  (attributed via a local price table) — good for the ratio between models, not for billing.
  These are `v2` fields; the `v1` ones are unchanged.
- **`byProject`/`byBranch`** are **`approximate`** too. `byBranch` cross-references each turn's
  timestamp with the repo's git checkouts (`git reflog`) — it answers "how much did feature/PR X
  cost", but the attribution is time-based (two windows on different branches at the same time
  get mixed).

Example loop with a stop condition (Python):

```python
import json, time, os

PATH = os.path.expanduser("~/.claude/usage-bar.json")

def quota_ok(minimum=15):
    try:
        d = json.load(open(PATH))
    except FileNotFoundError:
        return True  # no data yet → don't block
    if not d.get("trustworthy"):
        return True  # approximate source → don't decide on quota
    fh = d.get("fiveHour") or {}
    return fh.get("remainingPct", 100) >= minimum

while quota_ok(minimum=15):
    run_next_agent_step()
    time.sleep(2)
print("5h quota below the minimum — pausing auto-mode.")
```

## Limitations

- The native VS Code status bar renders only text + icons (codicons), not arbitrary SVG. The
  "circle" is the closest ring glyph (`○ ◔ ◑ ◕ ●`).
- On subscription accounts, the `rate_limits` fields only appear **after the first API
  response** in the session — until then, the indicator shows cost/context like API accounts do.
- **Context** and **model** belong to the window's project (the lookup is restricted to that
  workspace's transcripts). The **quota** and the **5h block cost**, however, are account-wide —
  they can't be split per project. Two windows on the same project show its most recent session.
- The **JSON export** is a single file: with two windows on different projects, each one writes
  **its own** project's context to the same path, alternately. Use `exportStatePath` with
  distinct paths per workspace if you consume the export across multiple projects.

## Notice / Disclaimer

This is an **independent, community-maintained** extension. It is **unofficial** and has **no
affiliation, partnership, endorsement, or sponsorship from Anthropic.** "Anthropic", "Claude",
and "Claude Code" are trademarks of their respective owners, referenced here only to describe
interoperability with Claude Code. The extension reads usage data **locally** on your machine
and does not collect or send your data to the author.

## License

MIT — see [LICENSE](https://github.com/bortolabs/claude-code-usage-bar/blob/master/LICENSE).
