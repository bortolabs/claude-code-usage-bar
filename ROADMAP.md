# Roadmap

Ideias de features para o Claude Code Usage Bar. Marcadas conforme o status.

## ✅ Feito

| Feature | O que faz | Versão |
| --- | --- | --- |
| Indicador na status bar | Anel/percentual da sessão, 4 estilos (ring/bar/number/icon) | 0.1–0.3 |
| Fonte ccusage | Sessão de 5h derivada dos transcripts (sempre disponível) | 0.4 |
| Painel com anel SVG | Círculo de progresso real estilo app do Claude | 0.3 |
| Ícone na Activity Bar | View dedicada na lateral esquerda | 0.6 |
| Alerta de burn rate | Avisa quando projeta estourar antes do reset | 0.5 |
| Liga/desliga do alerta | Toggle no painel, comando e botão na notificação | 0.8 |
| Custo correto p/ assinatura | `$` vira "equivalente API" (referência), sem teto/alerta | 0.7 |
| Cor por projeção | Anel colore pela projeção de estouro, não só valor atual | 0.9 |
| Sparkline de histórico | Mini-gráfico dos últimos dias no painel | 0.10 |
| Modelo atual correto | Lê o modelo do transcript (não o array misto do ccusage) | 0.10 |
| ETA até estourar | "no ritmo atual, 100% em ~Xmin" no painel/tooltip e na notificação | 0.11 |
| Aviso de fim de janela | Notifica quando falta pouco pro reset da sessão de 5h | 0.11 |
| Estouro de tokens da sessão | Projeta tokens (ritmo × tempo) vs teto configurável; cor + alerta + ETA | 0.12 |

## 💡 Próximas ideias

| # | Feature | O que faz | Esforço | Viável? |
| --- | --- | --- | --- | --- |
| 9 | **Resumo ao fechar o bloco** | Quando um bloco de 5h fecha: "essa sessão usou 42M tokens / ~$32 equivalente" | Médio | ✅ `ccusage blocks` |
| 5 | **Tema do anel** | Cor configurável (ex: laranja do Claude) em vez de verde/amarelo/vermelho | Baixo | ✅ |
| 4 | **Breakdown por projeto** | Quais projetos/sessões consomem o bloco atual | Médio | ✅ `ccusage session` |
| 10 | **Multi-conta / perfis** | Alternar entre contas (pessoal vs trabalho) | Alto | ⚠️ depende do setup |

## 🚫 Descartadas

| Feature | Por quê |
| --- | --- |
| rate_limits reais sem terminal | Só vêm dos headers da API; exigiria daemon com API key, gastaria token e seria frágil. A statusline (terminal) já cobre. |

## Notas técnicas

- **Fonte primária**: `ccusage blocks --active --json` (sessão de 5h derivada dos transcripts).
  Funciona em qualquer ambiente. A statusline (`~/.claude/usage-state.json`) só dispara no
  Claude Code TUI do terminal — quando fresca, dá os limites reais 5h/7d e tem prioridade.
- **Modelo atual**: lido do `.jsonl` mais recente em `~/.claude/projects/` (`src/transcript.ts`),
  porque o ccusage só expõe a lista de modelos do bloco inteiro (mistura opus/haiku/etc).
- **Custo**: em assinatura é só equivalente de preço de API (não cobrança). Setting `accountType`.
