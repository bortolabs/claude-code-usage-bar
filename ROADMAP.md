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
| Tooltip do hover resumido | Popover enxuto (sessão 5h + reset, alerta se houver) com link pro painel | 0.13 |
| Cota real via oauth/usage | Anel = cota real da sessão 5h (igual /usage) no app/IDE, via api/oauth/usage | 0.14 |
| Cross-platform (Win/Linux/mac) | Token lido de env / .credentials.json / Keychain; HTTP via https nativo | 0.14.1 |
| Tempo pela janela real | "Tempo da sessão 5h" calculado pelo reset do oauth (não pelo bloco fixo do ccusage) | 0.15 |
| Layout em cards | Sessão, histórico e controles em cards separados | 0.15 |
| Alerta de projeção em amarelo | Vermelho só p/ estouro consumado; projeção fica warning | 0.15.1 |
| "Atualizado há Xs" | Cronômetro vivo ao lado do botão Atualizar | 0.16 |
| Subtítulo do anel em 2 linhas | "sessão 5h" / "reseta Xh" sem estourar sobre o anel | 0.16.1 |
| Uso com "% · tokens" + card do alerta | 1ª barra mostra % e tokens; alerta em card próprio | 0.16.2 |
| Tema do anel | Cor configurável: semáforo / claude (laranja) / mono / custom; crítico sempre vermelho | 0.17 |
| Resumo ao fechar o bloco | Notifica o consumo (cota/tokens/custo) quando a sessão de 5h reseta | 0.18 |

## 💡 Próximas ideias

| # | Feature | O que faz | Esforço | Viável? |
| --- | --- | --- | --- | --- |
| 4 | **Breakdown por projeto** | Quais projetos/sessões consomem o bloco atual | Médio | ✅ `ccusage session` |
| 10 | **Multi-conta / perfis** | Alternar entre contas (pessoal vs trabalho) | Alto | ⚠️ depende do setup |

## Notas técnicas

- **Fontes, em ordem de prioridade**:
  1. **`api/oauth/usage`** (v0.14) — cota REAL do plano (5h/7d), igual ao `/usage`. Lê o
     token OAuth do Keychain (`Claude Code-credentials`, bloco `claudeAiOauth.accessToken`)
     e faz `GET https://api.anthropic.com/api/oauth/usage` com header `anthropic-beta: oauth-2025-04-20`.
     Campos: `five_hour.utilization`/`resets_at`, `seven_day`, `seven_day_sonnet`, `extra_usage`.
     macOS apenas. Resolveu a antiga limitação de não ter a cota real fora do terminal.
  2. **statusline** (`~/.claude/usage-state.json`) — só dispara no Claude Code TUI do terminal.
  3. **ccusage** (`blocks --active --json`) — sessão de 5h derivada dos transcripts; usada
     para a **barra de tempo** e como fallback. Funciona em qualquer ambiente.
- O **anel** mostra a cota real (oauth) quando disponível; a **barra de tempo** vem do ccusage.
- **Modelo atual**: lido do `.jsonl` mais recente em `~/.claude/projects/` (`src/transcript.ts`),
  porque o ccusage só expõe a lista de modelos do bloco inteiro (mistura opus/haiku/etc).
- **Custo**: em assinatura é só equivalente de preço de API (não cobrança). Setting `accountType`.
