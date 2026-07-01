# CLAUDE.md

## Sobre

Extensão VS Code (`bortolabs.claude-code-usage-bar`, "Claude Code Usage & Status") que monitora
uso/cota/custo do Claude Code, lendo transcripts locais (`~/.claude/projects/`) e a API
`oauth/usage` da Anthropic. Código-fonte em `src/`. Dois arquivos são grandes —
`extension.ts` (~100KB) e `panel.ts` (~85KB) — **nunca ler inteiros**: usar `offset`/`limit`.

## RTK / economia de tokens

Esta máquina tem o **RTK (Rust Token Killer)** ativo globalmente (hook `PreToolUse` →
`rtk hook claude` em `~/.claude/settings.json`), que reescreve/comprime saída de comandos Bash.
**Prefixar comandos shell com `rtk`** quando fizer sentido (`rtk grep`, `rtk npm`, `rtk read`).
Economia de tokens é prioridade contínua: preferir ferramentas dedicadas de busca a
`cat`/`grep` manuais; ler só o trecho necessário de arquivos grandes; delegar trabalho
mecânico a subagentes mais baratos (Sonnet/Haiku).

## Build/test

`npm run typecheck` (tsc --noEmit) · `npm test` (vitest, em `test/*.test.ts`) ·
`npm run bundle` (esbuild `src/extension.ts` → `out/extension.js`).

## Release

Versão é a do `package.json` (fonte da verdade). Fluxo: bump da `version` + entrada no topo
do `CHANGELOG.md` (formato `## X.Y.Z`, a CI extrai as notas dela) + commit + `git tag vX.Y.Z`
(tag **tem** que casar com a version, senão a CI falha) + `git push && git push --tags`.
A CI (`.github/workflows/publish.yml`) empacota o `.vsix`, cria GitHub Release e publica no
**Open VSX**; o passo do VS Marketplace fica em `continue-on-error` (publisher `bortolabs`
bloqueado pela Microsoft). Branch principal: `master`.

## Skills

- `/oi` — retoma a sessão pelo handoff mais recente em `docs/handoff/`
- `/tchau` — fecha a sessão (handoff + memória); `--deploy` faz o release acima

## Commits

Fechar com: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
