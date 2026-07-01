---
name: tchau
description: Fecha a sessão desta extensão VS Code (Claude Code Usage & Status) — resume o que foi feito, grava docs/handoff/ e salva memória para a próxima sessão. Modo leve, sem registro de horas. Use `--deploy` para também fazer o release da extensão (bump version + CHANGELOG + tag + push; a CI publica).
user_invocable: true
---

# /tchau — Fechar Sessão

Variantes:

- **`/tchau`** (padrão) — só grava handoff + memória. Não commita nem dá push. O usuário faz
  isso manualmente depois.
- **`/tchau --deploy`** — grava os docs **e** já executa o release da extensão (bump de
  version, CHANGELOG, tag, push) na mesma execução.

Modo **leve**: não há registro de horas (`docs/hours/`) neste projeto. Não há modo
`--project` — a extensão é um projeto único.

Executar os passos abaixo em sequência. Não pular nenhum.

---

## Passo 0 — Detectar modo

Ler `ARGUMENTS`.

- Se contiver `--deploy` → **modo deploy** (afeta o Passo 6).
- Sem `--deploy` → modo padrão (só docs).

---

## Passo 2 — Gravar Arquivo de Handoff

(Não há Passo 1 de horas neste projeto — pulado por design.)

Criar o arquivo `docs/handoff/YYYY-MM-DD.md`. Se já existir um do dia, usar
`YYYY-MM-DD-2.md`, etc.

O arquivo deve conter **apenas** o prompt de handoff — curto, denso, sem redundância. Máximo
25 linhas.

Estrutura do arquivo:

```markdown
# Handoff — DD/MM/YYYY

**Chat:** `CCUB-S{N}_{YYYY-MM-DD}_{desc-curta}`
**Branch:** `nome-do-branch`
**Último commit:** `hash — mensagem`
**Release:** `vX.Y.Z` (se houve release nessa sessão)

## Feito
- Item 1
- Item 2

## Decisões
- Decisão A (motivo resumido)

## Arquivos principais
- `path/arquivo.ts` — o que mudou

## Próxima sessão
- [ ] Tarefa 1
- [ ] Tarefa 2

## Contexto importante
[Qualquer detalhe técnico ou de negócio não óbvio que o Claude precisará saber]

## RTK Gain (hoje)
[preenchido automaticamente pelo Passo 4.5 — omitir seção inteira se RTK ausente ou economia zero]
```

**No modo `--deploy`**, deixar **placeholders** nos campos:
- `Último commit:` → preencher depois do commit final no Passo 6
- `Release:` → preencher com `vX.Y.Z` depois da tag no Passo 6

No modo padrão, preencher com o `git log -1` atual e omitir o campo `Release:` se não houve
release.

Após gravar, exibir o conteúdo completo do arquivo ao usuário dentro de um bloco de código.

---

## Passo 3 — Salvar em Memória

Diretório de memória:
`/Users/brunobortolotto/.claude/projects/-Users-brunobortolotto-claude-code-usage-bar/memory/`.

Criar/atualizar `project_sessao_DDMM_estado.md` (um por sessão).

Campos obrigatórios:
- O que foi entregue
- Decisões tomadas
- Próxima sessão e foco
- Referência ao arquivo de handoff gravado

Atualizar o ponteiro em `MEMORY.md` (uma linha, sob 150 chars) com a entrada desta sessão.

---

## Passo 4 — Sugerir Nome do Chat (VS Code)

Sugerir um nome de chat que reflita o que esta sessão realmente entregou — o usuário aplica
manualmente no VS Code.

Formato: `CCUB-S{N}_{YYYY-MM-DD}_{desc-curta}`.

Como derivar:
- **`S{N}`**: ler o handoff anterior em `docs/handoff/`, ordenar por data e incrementar. Se
  atravessou meia-noite BRT, manter `S{N}` único — uma sessão lógica = um número
- **`YYYY-MM-DD`**: data BRT do **início** da sessão (não do último commit)
- **`desc-curta`**: 2-4 palavras em kebab-case capturando o tema dominante. Olhar os tipos de
  commit (feat/fix/chore) e o assunto:
  - 1 tema dominante → usar ele (`fix-creditos-extras-centavos`, `feat-heatmap-historico`)
  - 2-3 temas pequenos → combinar (`manutencao-ci-fixes-menores`)
  - Sessão de "limpeza" → `manutencao-{escopo}` ou `chore-{escopo}`

Se não houver handoff anterior em `docs/handoff/`, esta é a **S1**.

Exibir no formato:
> **Sugestão de nome do chat:** `CCUB-S{N}_{YYYY-MM-DD}_{desc-curta}` — aplique manualmente
> no VS Code (renomear o chat atual).

Se o nome aplicado no início da sessão (campo `Chat` do handoff) já estiver bom, dizer
explicitamente "já aplicado" em vez de sugerir outro.

---

## Passo 4.5 — Snapshot RTK Gain (telemetria de sessão)

Captura quanto o RTK (Rust Token Killer) economizou hoje neste projeto e anexa ao handoff.
Falha silenciosamente se RTK não estiver instalado/configurado.

### Pré-check

```bash
command -v rtk >/dev/null 2>&1 || SKIP_RTK=1
```

Se `SKIP_RTK=1`, pular este passo inteiro (não exibir nada, não escrever no handoff, não
mencionar no checklist).

### Coletar dados

RTK não suporta filtro temporal arbitrário nem agrega por sessão — só por dia. Pra reportar o
ganho **só desta sessão**, usamos o **baseline gravado pelo `/oi`** no Passo 5.6
(`.rtk/session-baseline.json`): o `total_saved`/`total_commands` acumulados no início da
sessão. O ganho da sessão é o delta entre agora e esse ponto-zero.

```bash
HOJE=$(date +%Y-%m-%d)

# (a) Tendência diária escopada por este projeto (cwd) — pra "acumulado 7d" e fallback
rtk gain --project --daily --format json 2>/dev/null

# (b) Acumulado global ATUAL — tem que casar com o escopo do baseline do /oi (ambos SEM --project)
rtk gain --format json 2>/dev/null
```

### Calcular ganho da sessão (delta vs baseline)

```bash
if [ -f .rtk/session-baseline.json ]; then
  rtk gain --format json 2>/dev/null | python3 -c "
import sys, json
agora = json.load(sys.stdin)['summary']
base = json.load(open('.rtk/session-baseline.json'))
saved = agora['total_saved'] - base['baseline_saved']
cmds  = agora['total_commands'] - base['baseline_commands']
print(json.dumps({'sessao_saved': max(0, saved), 'sessao_cmds': max(0, cmds)}))
"
fi
```

Parsear o resultado:
- **`sessao_saved`** = tokens economizados **só nesta sessão** (delta). É o número principal
  do bloco do handoff.
- **`sessao_cmds`** = comandos RTK nesta sessão (delta).
- Se `.rtk/session-baseline.json` **não existir** (sessão não começou com `/oi`, ou RTK
  recém-instalado), **fazer fallback** pro número do dia (`hoje_saved` abaixo) e marcar o
  rótulo como "(dia)" em vez de "(sessão)".
- Se `sessao_saved <= 0`, também cair no fallback do dia.

Estrutura do JSON retornado:

```json
{
  "summary": {
    "total_commands": 42,
    "total_saved": 68000,
    "avg_savings_pct": 85.0
  },
  "daily": [
    {"date": "2026-05-17", "total_saved": 45000, "total_commands": 28, "avg_savings_pct": 87.2}
  ]
}
```

Parsear o `--daily --project` (saída **a**) — usado pra acumulado 7d e fallback:
- **`hoje_saved`** = item do array `daily` onde `date == HOJE` (se ausente, 0). **Nota:** RTK
  pode bucketar a mesma sessão em 2 dias por fuso (UTC vs BRT) — se houver item de `HOJE` E
  de `HOJE+1`, **somar os dois** pro fallback de dia.
- **`hoje_cmds`** = `total_commands` do(s) mesmo(s) item(ns)
- **`acumulado_7d`** = soma de `total_saved` dos 7 itens mais recentes de `daily`

Decidir o número principal:
- Se `sessao_saved` (delta do baseline) **existe e > 0** → usar ele, rótulo **"(sessão)"**.
- Senão → fallback `hoje_saved`, rótulo **"(dia)"**.

Se o número escolhido `== 0` OU nenhum output for JSON parseável, pular este passo (não
anexar nada, não mencionar no checklist).

### Anexar ao handoff

Substituir o placeholder `## RTK Gain (hoje)` no arquivo de handoff (Passo 2) pelo bloco.

**Com baseline (caso normal — sessão começou com `/oi`):**

```markdown
## RTK Gain (sessão)
- Economizado nesta sessão: ~XX.Xk tokens (N comandos)
- Acumulado 7d (projeto): ~XXXk
```

**Sem baseline (fallback — sessão sem `/oi`):**

```markdown
## RTK Gain (dia)
- Economizado hoje (todas as sessões): ~XX.Xk tokens (N comandos)
- Acumulado 7d (projeto): ~XXXk
```

Se o placeholder não foi gravado (RTK pulou no Passo 2), não criar seção nova — pular
inteiro.

Formatação:
- Tokens em milhares (k) com 1 casa decimal se < 100k, sem casas se ≥ 100k (ex.: 45.2k, 230k)
- Se `acumulado_7d == 0`, omitir a linha "Acumulado 7d"
- **Limpar o baseline ao fim:** `rm -f .rtk/session-baseline.json` depois de anexar — evita
  que um `/tchau` futuro sem `/oi` no meio reuse um ponto-zero velho.

### Exibir no checklist final

Adicionar uma linha ao checklist do Passo 5 (ou 7 se for `--deploy`):

```
✅ RTK Gain anexado ao handoff (~XX.Xk tokens / sessão)   ← ou "/ dia" no fallback
```

Se o passo foi pulado, **não** exibir nada sobre RTK no checklist.

---

## Passo 5 — Confirmar ao Usuário (modo padrão)

**Pular este passo se modo `--deploy` ativo — vai direto pro Passo 6.**

Exibir checklist final:

```
✅ Handoff gravado em docs/handoff/YYYY-MM-DD.md
✅ Memória atualizada (project_sessao_DDMM_estado.md)
✅ Nome do chat sugerido — CCUB-S{N}… (aplique no VS Code)
```

Encerrar aqui.

---

## Passo 6 — Release da extensão (apenas no modo `--deploy`)

Substitui todo o fluxo de PR/merge/deploy do projeto de origem — aqui o "deploy" é publicar
uma nova versão da extensão via CI (Open VSX + tentativa de Marketplace + GitHub Release).

Executar na ordem. **Falha em qualquer etapa = parar e reportar.**

### 6.1 — Gate de qualidade

```bash
npm run typecheck
npm test
```

Se qualquer um falhar, **abortar o release** (mas manter o handoff/memória já gravados nos
passos anteriores) e reportar o erro ao usuário.

### 6.2 — Bump de versão

Ler a `version` atual em `package.json`. Inferir o tipo de bump pelas mudanças da sessão
(olhar `git log` e o conteúdo do handoff/CHANGELOG a gravar):
- **patch** (`X.Y.Z+1`) — fix, ajuste pequeno, sem feature nova
- **minor** (`X.Y+1.0`) — feature nova, não-breaking

Se ambíguo, perguntar ao usuário antes de decidir. Editar `version` em `package.json`.

### 6.3 — Entrada no CHANGELOG.md

Adicionar no **topo** do `CHANGELOG.md` uma nova seção `## X.Y.Z` (a CI extrai as notas de
release dela), descrevendo o que mudou nesta sessão em prosa densa, no mesmo estilo das
entradas existentes.

### 6.3.1 — Atualizar ROADMAP.md (itens concluídos)

Se a sessão concluiu algum item que estava na seção **"💡 Próximas ideias"** do `ROADMAP.md`,
movê-lo para a tabela **"✅ Feito"** com a versão `X.Y.Z` desta release (toda linha de "Feito"
tem versão) e removê-lo da tabela de ideias. Descrever em 1 linha o que a feature faz, no
estilo das entradas existentes. Se nada de roadmap foi concluído, pular este passo.

### 6.4 — Commit

```bash
git add package.json CHANGELOG.md ROADMAP.md <demais arquivos da sessão>
git commit -m "$(cat <<'EOF'
<tipo>: <descrição curta> (vX.Y.Z)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 6.5 — Tag + push

```bash
git tag vX.Y.Z
git push
git push --tags
```

A tag **tem** que casar exatamente com a `version` do `package.json`, senão a CI
(`.github/workflows/publish.yml`) falha na validação.

### 6.6 — CI cuida do resto

A CI empacota o `.vsix`, cria o GitHub Release e publica no Open VSX (o passo do VS
Marketplace roda em `continue-on-error`, publisher `bortolabs` ainda bloqueado pela
Microsoft). **A skill não publica à mão, não roda `vsce`/`ovsx` diretamente.**

### 6.7 — Atualizar handoff com o release

Voltar ao arquivo de handoff (Passo 2) e preencher:
- `Último commit:` → hash do commit do Passo 6.4
- `Release:` → `vX.Y.Z`

### 6.8 — Checklist final (modo `--deploy`)

```
✅ Handoff gravado em docs/handoff/YYYY-MM-DD.md (com hash + release)
✅ Memória atualizada (project_sessao_DDMM_estado.md + MEMORY.md)
✅ Nome do chat sugerido — CCUB-S{N}… (aplique no VS Code)
✅ typecheck + test verdes
✅ vX.Y.Z taggeada e pushada — CI publica (Open VSX + GitHub Release)
```

---

## Regras

- Executar todos os passos, mesmo em sessões curtas
- Modo padrão **não commita, não pusha**. Modo `--deploy` faz o ciclo completo até a tag
- Não há registro de horas neste projeto (modo leve) — não criar `docs/hours/`
- O arquivo de handoff é a fonte de verdade para o `/oi`
- **Handoff auto-suficiente:** tudo que é necessário pra retomar a sessão vai no handoff
  (versionado no git, viaja entre PCs). A memória
  (`~/.claude/projects/-Users-brunobortolotto-claude-code-usage-bar/memory/`) é **local, não
  sincroniza entre máquinas** — complemento, não mecanismo de retomada
- Seção "Contexto importante" só incluir se houver algo não óbvio
- **Campo `Chat`**: usar o nome aplicado pelo usuário no VS Code nesta sessão (taxonomia
  `CCUB-S{N}_{YYYY-MM-DD}_{desc-curta}`). Se Claude não tiver certeza, perguntar antes de
  gravar
- **Nunca** usar `--no-verify`, `--force` ou amend em commits já pushados
- Branch principal: `master`. Não há modo `--project`/mini-projeto neste repositório
