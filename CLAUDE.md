# CLAUDE.md

Guia para quem for mexer neste repositório — humano ou agente de IA. Comentários, commits e
documentação em **pt-BR**; a UI do plugin é traduzida (ver *i18n*).

## Sobre

Extensão VS Code (`bortolabs.claude-code-usage-bar`, "Claude Code Usage & Status") que monitora
uso/cota/custo do Claude Code, lendo transcripts locais (`~/.claude/projects/`) e a API
`oauth/usage` da Anthropic. Código-fonte em `src/`. Dois arquivos são grandes —
`extension.ts` (~110KB) e `panel.ts` (~90KB) — **nunca ler inteiros**: usar `offset`/`limit`.

## Mapa do código

| Arquivo | Responsabilidade |
| --- | --- |
| `extension.ts` | `activate`, orquestração dos refreshes/ticks, status bar, alertas, export JSON |
| `panel.ts` | Webview do painel (abas Sessão/Custos/Status/Config). O HTML/JS vive em template string |
| `dashboard.ts` | Dashboard de analytics (aba do editor) + export `.html` |
| `transcriptStats.ts` | Agregação **local** dos transcripts: custo por modelo/projeto/branch/dia/contexto |
| `transcript.ts` | Turno atual (modelo + contexto), **escopado no projeto da janela** |
| `branchTimeline.ts` | Cruza timestamp do turno com `git reflog` → branch ativo (custo por branch) |
| `pricing.ts` | Tabela de preços local (`tabela vX`) — só para **atribuir** custo |
| `ccusage.ts` · `oauthUsage.ts` · `status.ts` | Fontes externas (custo oficial · cota real · status) |
| `alerts.ts` · `anomalies.ts` · `advisor.ts` · `insights.ts` | Heurísticas locais (sem LLM) |
| `aiAdvice.ts` · `updateCheck.ts` | Chamadas de rede opt-in (BYO key · versão nova no Open VSX) |
| `i18n.ts` | `tr()` com override de idioma; lê os bundles de `l10n/` |
| `core/` · `history/` | Projeção/previsão · histórico persistente (sobrevive à limpeza de transcripts) |

**Fontes de dados, em ordem de prioridade:** `api/oauth/usage` (cota real) → statusline
(`~/.claude/usage-state.json`) → ccusage (fallback e barra de tempo).

## Convenções que não se quebram

1. **Local por padrão.** Nada de rede sem opt-in explícito. As únicas saídas são: `oauth/usage`
   (com consentimento em `globalState`), `status.claude.com`, `open-vsx.org` (checagem de
   versão) e o AI advice (BYO key). Toda nova chamada externa precisa de setting e de um
   caminho de falha silenciosa.
2. **A tabela de preços local nunca contradiz o ccusage.** Ela **atribui** custo (por modelo,
   projeto, branch) e é sempre rotulada **"≈ aproximado"**. O número oficial de custo é o do
   ccusage. Se uma quebra divergir do total oficial, é bug.
3. **Toda string de UI passa por `tr()`** e entra nos **5 bundles** de `l10n/`
   (`bundle.l10n.json` é a fonte em pt; en/es/fr/de são traduções). Descrição de setting é
   outra coisa: vai nos `package.nls*.json` (também 5).
4. **Transcripts são append-only e barulhentos.** Turnos se repetem (snapshots de streaming
   com o mesmo `message.id`+`requestId`, `output_tokens` crescendo) — a agregação deduplica
   ficando com a **última** ocorrência. Ao mexer nessa pipeline, valide o total contra
   `ccusage daily --json`; eles têm que bater.
5. **Contexto/modelo são do projeto da janela**, cota e custo são da conta. Fontes globais
   (statusline) não podem vazar para um valor escopado por projeto.

## Adicionar um setting: 5 lugares

Esquecer um deles produz um setting que existe mas não aparece (ou aparece vazio) na aba
Config — ou que ninguém descobre, porque não está documentado:

1. `package.json` → `contributes.configuration.properties` (com `%config.<key>.desc%`)
2. `package.nls.json` + as 4 traduções → texto de `config.<key>.desc`
3. `panel.ts` → rótulo em `L.cfg.<key>` **e** o item na seção correspondente da aba Config
4. `extension.ts` → `SETTING_DEFAULTS` **e** a lista de chaves em `collectSettings`
5. `README.md` **e** `README.pt-BR.md` → linha na tabela do grupo correspondente. Os grupos
   dos READMEs espelham o `SETTINGS_SCHEMA` do `panel.ts`, então é o mesmo grupo do passo 3.
   Reuse o texto do passo 2 em vez de escrever descrição nova. `test/settingsDocs.test.ts`
   quebra a CI se faltar (ou se os dois READMEs divergirem entre si).

## Build/test

`npm run typecheck` (tsc --noEmit) · `npm test` (vitest, em `test/*.test.ts`) ·
`npm run bundle` (esbuild `src/extension.ts` → `out/extension.js`).

Padrão de teste: funções puras são testadas direto; qualquer coisa que leia `~/.claude` usa
fixture em disco com `vi.mock("os")` apontando `homedir` para um tmpdir por teste (ver
`test/transcriptStats.test.ts` e `test/transcript.test.ts`). Nada de teste que dependa dos
transcripts reais da máquina.

## Documentação

O **`README.md` é em inglês** (é o que o Open VSX renderiza, e o alcance é mundial) e o
**`README.pt-BR.md`** é a versão brasileira. Os dois se linkam no topo. **Mudou um, muda o
outro** — links entre eles devem ser URLs absolutas do GitHub, porque link relativo quebra na
página do Open VSX.

## Release

Versão é a do `package.json` (fonte da verdade). Fluxo: bump da `version` + entrada no topo
do `CHANGELOG.md` (formato `## X.Y.Z`, a CI extrai as notas dela) + commit + `git tag vX.Y.Z`
(tag **tem** que casar com a version, senão a CI falha) + `git push && git push --tags`.
A CI (`.github/workflows/publish.yml`) empacota o `.vsix`, cria GitHub Release e publica no
**Open VSX**; o passo do VS Marketplace fica em `continue-on-error` (publisher `bortolabs`
bloqueado pela Microsoft). Branch principal: `master`.

## Economia de tokens

Prioridade contínua: preferir ferramentas dedicadas de busca a `cat`/`grep` manuais; ler só o
trecho necessário dos arquivos grandes; delegar trabalho mecânico a modelos mais baratos.

> Opcional, específico da máquina do mantenedor: existe um **RTK (Rust Token Killer)** ativo
> via hook `PreToolUse` global, que comprime a saída de comandos Bash — daí o prefixo `rtk` em
> alguns comandos do histórico. Se você não tem o `rtk`, **ignore o prefixo**; todos os
> comandos deste guia funcionam sem ele.

## Skills

- `/oi` — retoma a sessão pelo handoff mais recente em `docs/handoff/`
- `/tchau` — fecha a sessão (handoff + memória); `--deploy` faz o release acima

## Commits

Fechar com o trailer do **modelo da sessão**, não de um modelo fixo:
`Co-Authored-By: Claude <Modelo> (1M context) <noreply@anthropic.com>`.
Ex. na sessão atual: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
