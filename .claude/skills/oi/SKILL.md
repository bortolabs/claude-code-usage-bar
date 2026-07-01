---
name: oi
description: Retoma o contexto da última sessão desta extensão VS Code (Claude Code Usage & Status), lendo o handoff mais recente de docs/handoff/, o CHANGELOG.md, o ROADMAP.md e a pasta de memória.
user_invocable: true
---

# /oi — Retomar Sessão

Lê o arquivo de handoff mais recente e injeta o contexto na conversa atual. Modo único
(leve) — sem `--project`, sem registro de horas.

---

## Processamento

### 1. Encontrar o handoff mais recente

```bash
ls -t docs/handoff/*.md 2>/dev/null | head -1
```

Glob **não-recursivo** por design.

Se não existir handoff em `docs/handoff/`, avisar:
> "Nenhum handoff encontrado em `docs/handoff/` — parece ser a primeira sessão. Dá uma
> olhada no `README.md` e no `ROADMAP.md` pra pegar o contexto do projeto. Rode `/tchau` ao
> final desta sessão para ativar o fluxo de handoff."

Encerrar aqui nesse caso.

### 2. Ler e exibir o arquivo

Ler o arquivo encontrado e exibir o conteúdo completo ao usuário, dentro de um bloco de código.

### 3. Confirmar o estado do branch

```bash
git branch --show-current
git log --oneline -3
```

Comparar o branch atual com o `Branch` registrado no handoff. Se forem diferentes, alertar:
> "⚠️ Branch atual é `X`, mas o handoff foi gravado em `Y`. Confirme qual branch usar antes
> de continuar."

Branch principal do projeto: `master`.

### 4. Ler CHANGELOG.md e ROADMAP.md

Ler o topo do `CHANGELOG.md` (última(s) entrada(s) `## X.Y.Z`) e o `ROADMAP.md` (seção
"✅ Feito" mais recente e "💡 Próximas ideias"). Usar isso para checar se a versão/entregas do
handoff já batem com o que está publicado, e para embasar o roadmap sugerido no passo 6.

### 5. Sugerir nome do chat atual

Extrair o campo `Chat` do handoff (linha `**Chat:** \`CCUB-S{N}_{YYYY-MM-DD}_{desc}\``).

Se presente, calcular sugestão de nome pra esta sessão:
- Manter o prefixo `CCUB-`
- Incrementar `S{N}` (ex.: `S5` → `S6`)
- Substituir data pela data de hoje (`YYYY-MM-DD`)
- Manter `{desc}` como `<descrição-curta>` placeholder pro usuário completar

Exibir no formato:
> **Sugestão de nome do chat:** `CCUB-S6_2026-05-01_<descrição-curta>` — aplique manualmente
> no VS Code.

Se o handoff anterior não tiver o campo `Chat`, pular esta etapa silenciosamente.

### 5.1. Resumir em linguagem natural

Após exibir o arquivo, fazer um parágrafo curto de 2-4 linhas resumindo:
- O que foi feito na última sessão
- O que está pendente
- Qual é o foco sugerido para agora

### 5.5. Telemetria RTK (tendência)

Mostra tendência de economia de tokens dos últimos 7 dias **filtrada por este projeto** (flag
`-p`/`--project` do RTK, que escopa por cwd). Falha silenciosamente se RTK não estiver
disponível.

```bash
command -v rtk >/dev/null 2>&1 || SKIP_RTK=1
```

Se `SKIP_RTK=1`, pular silenciosamente.

Caso contrário, coletar:

```bash
rtk gain --project --daily --format json 2>/dev/null
```

Estrutura esperada:

```json
{
  "summary": {
    "total_saved": 68000,
    "avg_savings_pct": 85.0,
    "total_commands": 42
  },
  "daily": [
    {"date": "2026-05-17", "total_saved": 45000, "avg_savings_pct": 87.2}
  ]
}
```

Parsear:
- **`hoje_saved`** = item do `daily` onde `date == hoje` (ou 0 se ausente)
- **`media_7d`** = média de `total_saved` dos 7 itens mais recentes de `daily`
- **`total_install`** = `summary.total_saved` (acumulado desde install)

Exibir bloco curto após o resumo natural:

```
## RTK Gain (últimos 7 dias)
- Hoje: ~XX.Xk tokens
- Média 7d: ~XX.Xk/dia
- Total desde install: ~X.XM tokens
```

Regras:
- Se `total_install == 0`, pular silenciosamente
- Se `daily.length <= 2`, omitir "Média 7d" — mostrar só "Hoje" + "Total"
- Tokens em milhares (k) com 1 casa decimal se < 100k, sem casas se ≥ 100k; em milhões (M)
  com 1 casa se ≥ 1M
- Não comentar/interpretar os números — só mostrar

### 5.6. Baseline RTK da sessão (pro /tchau calcular ganho só desta sessão)

O `rtk gain` só agrega por **dia inteiro** — não sabe o que é "sessão". Pra que o `/tchau`
consiga reportar o ganho **só desta sessão**, gravamos aqui um marcador de ponto-zero: o
`total_saved` e `total_commands` acumulados **agora**, no início da sessão.

Reaproveitar o JSON já coletado no passo 5.5 (não chamar `rtk` de novo). Se `SKIP_RTK=1`,
pular silenciosamente — não grava baseline.

```bash
# .rtk/ é gitignored (config local per-dev). Baseline mora lá → não viaja entre PCs,
# o que é correto: a sessão é local da máquina.
mkdir -p .rtk
rtk gain --format json 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin)['summary']; print(json.dumps({'baseline_saved': d['total_saved'], 'baseline_commands': d['total_commands']}))" \
  > .rtk/session-baseline.json 2>/dev/null
```

Notas:
- Usar `rtk gain --format json` **sem** `--project` aqui — o baseline tem que casar com o
  mesmo escopo que o `/tchau` vai ler (ambos sem `--project`, acumulado global).
- Sobrescrever sempre (`>`): cada `/oi` reinicia o ponto-zero. Se o usuário rodar `/oi` duas
  vezes no mesmo dia, a 2ª vira o novo baseline.
- Não exibir nada ao usuário sobre o baseline — é infra silenciosa pro `/tchau`.

**Continuidade entre N sessões no mesmo dia:** o par `/oi` (grava ponto-zero) + `/tchau` (lê
delta, depois **apaga** o baseline) garante que cada sessão conta só o seu próprio trecho.
Pré-condição: **cada sessão deve começar com `/oi`**. Se pular, o `/tchau` cai no fallback
"dia inteiro".

### 6. Sugestão de roadmap da sessão

Com base na seção `## Próxima sessão` e `## Contexto importante` do handoff, cruzando com a
seção "💡 Próximas ideias" do `ROADMAP.md`, propor um roadmap em formato todo list pra esta
sessão. Ordenar por prioridade (do que destrava mais → cosméticos).

Formato:

```
## Roadmap sugerido pra hoje

- [ ] **(P0, ~Xmin)** Tarefa que destrava ou valida entrega anterior — _por quê é P0_
- [ ] **(P1, ~Xh)** Próxima entrega de valor — _o que muda pro usuário_
- [ ] **(P2, ~Xmin)** Pendência menor / cosmético — _baixo risco_
- [ ] **(Backlog)** Item do ROADMAP.md sem urgência clara
```

Regras:
- Não inventar tasks que não estão no handoff, no ROADMAP.md ou inferíveis deles
- Se o handoff tinha validação pós-release aguardando (ex.: checar publish da CI), sempre
  subir como P0
- Máximo 6 itens — o resto vira "Backlog mencionado no ROADMAP" em uma linha

Encerrar com: **"Pronto para continuar. O que atacamos primeiro?"**

---

## Regras

- Nunca modificar o arquivo de handoff — apenas lê
- Modo único, sem `--project`: lê só `docs/handoff/*.md` (glob não-recursivo)
- Se houver mais de um arquivo no mesmo dia (ex.: `2026-04-06-2.md`), sempre usar o mais
  recente (`ls -t | head -1`)
- Memória (`/Users/brunobortolotto/.claude/projects/-Users-brunobortolotto-claude-code-usage-bar/memory/`)
  é local da máquina e complementar — o handoff (versionado) é o mecanismo portátil de
  retomada. Se algo essencial parecer faltar, o problema é um handoff incompleto na origem
  (`/tchau`), não falta de leitura de memória aqui
- Manter o resumo em linguagem natural **curto** — o arquivo já foi exibido acima
- O roadmap é uma **sugestão**, não plano fechado — o usuário reordena/descarta livremente
