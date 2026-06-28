# Roadmap

Ideias de features para o Claude Code Usage & Status. Marcadas conforme o status.

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
| Painel em abas | Sessão · Histórico · Config (aba ativa persiste) | 0.19 |
| Breakdown por projeto | Card "Projetos nesta sessão (5h)" — uso por projeto, dos transcripts | 0.19 |
| Aba de Configurações visual | Edita os settings + botões de comando + link settings.json | 0.19 |
| Aba Status + aviso de incidentes | status.claude.com: status geral, componentes, incidentes, histórico; badge + notificação | 0.20 |
| Fix: Config salva de verdade | Form só remonta ao entrar na aba — não pisa mais no foco/edições em andamento | 0.20.1 |
| Multi-idioma (i18n) | Segue o idioma do VS Code: pt (base) + en/es/fr/de, em todo o painel/notificações/manifesto | 0.21 |
| Screenshots no Marketplace/README | Galeria do painel (Sessão/Status/Config/Histórico) + bandeiras de idioma | 0.21.1 |
| Fixes de robustez | "Silenciar 1h" absoluto; refetch ao focar/abrir; botão ↻ enxuto; disclaimer de não-afiliação | 0.21.2 |
| Fonte de dados visível | Mostra a fonte ativa (oauth/statusline/ccusage) e o motivo do fallback; ccusage rotulado "≈ tempo"; publica no **Open VSX** | 0.21.3 |
| Export de uso (p/ agentes) | JSON local com cota restante/fonte/confiabilidade — pra um agente parar/avisar quando a cota cair | 0.22 |
| Alerta nativo de cota baixa | Avisa quando resta < X% (5h/7d), só com cota real; 1×/janela, re-arma sozinho | 0.23 |
| Backoff no oauth/usage | Corrige o "Quota reached" falso (429 de rate-limit, não de cota) com recuo exponencial | 0.23.1 |
| Fim do 429 ao reabrir o VS Code | Mata o burst de startup (guard de concorrência + coalescência de foco + backoff gentil); painel reorganizado | 0.24 |
| Config repaginada | Cards de seção colapsáveis, booléanos viram toggle, file picker (📁), placeholders | 0.25 |
| Créditos no rodapé da Sessão | Linha discreta com a versão + link do repositório | 0.25.1 |
| Fix do tooltip de reset | Tooltip usa o reset do oauth (não a statusline velha) — fim do "reseta em 0m" divergente | 0.25.2 |
| **Motor de custo + custos hoje/mês** | Tabela de preços local (`pricing.ts`); custo de hoje/mês/projeção (ccusage); orçamento mensal com alerta; modo "custo" na status bar | 0.26 |
| **Aba "Custos" + Insights/Dicas** | Quebra por modelo/projeto/contexto + contagem de MCP/subagentes; dicas de economia heurísticas (local, sem LLM); export v2 | 0.27 |
| Performance do agregador | Cache por mtime (tick ocioso ~230ms → ~0,3ms) + fim de uma varredura de disco redundante | 0.27.1 |
| Contexto ao vivo do transcript | Contexto% calculado direto do último turno (tokens ÷ janela do modelo), não mais preso na statusline velha | 0.28.1 |
| Janela configurável das quebras | Seletor **5h · Hoje · 7d · 30d** para as quebras (modelo/projeto/contexto, MCP/subagentes, dicas); comando dedicado `setCostWindow` | 0.28.1 |
| Sparklines de custo e tokens/dia | Mini-gráficos de `$`/dia e tokens/dia na aba Custos, com tooltip de valor absoluto | 0.28.1 |
| Limiares das Dicas como settings | Os 5 gatilhos do motor de dicas viram settings (`tipsContextBigPct`, `tipsCacheReadPct`, `tipsOpusPct`, `tipsMcpCalls`, `tipsSubagentPct`) | 0.28.1 |
| Cor da status bar = uso, não tempo | No fallback do ccusage a cor reflete custo/uso de tokens, nunca o tempo decorrido (tempo acabando é bom: vem reset) | 0.28.2 |
| Custo por turno por contexto | Cada faixa de tamanho de contexto mostra o custo médio `~$X/turno`, não só o total | 0.28.2 |
| Cards colapsáveis em tudo | Todos os cards de conteúdo recolhem/expandem e lembram o estado — aba Custos bem mais enxuta | 0.28.2 |
| Idioma por bandeiras 🇧🇷🇬🇧🇪🇸🇫🇷🇩🇪 | Card "Idioma" troca o idioma de todo o plugin na hora, independente do VS Code; persiste no globalState | 0.29.0 |
| Dica de ritmo no alerta | Quando projeta estourar a sessão 5h / teto de custo, o banner sugere quanto pausar ou reduzir o ritmo (local, sem rede) | 0.29.3 |
| Tooltips dos gráficos no webview | Tooltip flutuante próprio (o `title` nativo não renderiza) com o valor absoluto do dia | 0.29.2 |
| Alertas seguem a bandeira | Banner de burn rate (e a dica de ritmo) migrados pro `tr()` — seguem o idioma escolhido, não o do VS Code | 0.29.4 |
| **Dashboard completo + export HTML** | Comando que abre **tudo de uma vez** numa aba do editor (grid responsivo, seções expandidas, ao vivo) + export de um **`.html` autocontido** pro navegador (snapshot com tema próprio) | 0.30.0 |

## 💡 Próximas ideias

| # | Feature | O que faz | Esforço | Viável? |
| --- | --- | --- | --- | --- |
| 14 | **Comparativo de janelas** | "Esta semana vs. anterior", "hoje vs. média dos últimos N dias" — delta de custo/tokens na aba Custos. Reusa `ccusage daily`, não toca em oauth/credenciais | Baixo | ✅ |
| 15 | **Quebra por dia da semana / hora** | Heatmap ou barras de quando você mais gasta (por dia-da-semana ou faixa horária). Reusa o agregador (`transcriptStats.ts`) | Médio | ✅ |
| 16 | **Orçamento/meta por token** | Hoje o orçamento é só por `$`/mês; expor um teto por **tokens** (5h/dia/semana) com alerta, complementando o de custo | Baixo | ✅ |
| 17 | **Resumo semanal de custo** | Notificação opt-in com o resumo da semana (custo, top modelo/projeto, delta vs. anterior) — reusa o resumo de fim de bloco | Baixo | ✅ |
| 18 | **Export de custo em CSV** | Botão pra exportar a quebra (por dia/modelo/projeto) em CSV, além do JSON v2 que já existe | Baixo | ✅ |
| 10 | **Multi-conta / perfis** | Alternar entre contas (pessoal vs trabalho): token/transcripts por perfil. Mexe em fonte de dados, oauth e persistência — fechar escopo antes | Alto | ⚠️ depende do setup |

## 🌐 Externo / operacional (fora do código)

- **VS Code Marketplace:** publisher `bortolabs` em revisão pela Microsoft. Enquanto isso, a
  publicação no Marketplace falha de propósito (passo `continue-on-error`) e a instalação no
  VS Code é via **`.vsix` da Release** do GitHub. Depende do appeal junto à Microsoft.
- **Open VSX:** ✅ ativo (namespace `bortolabs`), publicação automática a cada release.

## Notas técnicas

- **Fontes, em ordem de prioridade**:
  1. **`api/oauth/usage`** (v0.14) — cota REAL do plano (5h/7d), igual ao `/usage`. Lê o
     token OAuth (env / `.credentials.json` / Keychain do macOS, bloco `claudeAiOauth.accessToken`)
     e faz `GET https://api.anthropic.com/api/oauth/usage` com header `anthropic-beta: oauth-2025-04-20`.
     Campos: `five_hour.utilization`/`resets_at`, `seven_day`, `seven_day_sonnet`, `extra_usage`.
     Cross-platform desde a 0.14.1 (antes era só macOS). Resolveu a antiga limitação de não ter a cota real fora do terminal.
  2. **statusline** (`~/.claude/usage-state.json`) — só dispara no Claude Code TUI do terminal.
  3. **ccusage** (`blocks --active --json`) — sessão de 5h derivada dos transcripts; usada
     para a **barra de tempo** e como fallback. Funciona em qualquer ambiente.
- O **anel** mostra a cota real (oauth) quando disponível; a **barra de tempo** vem do ccusage.
- **Modelo atual**: lido do `.jsonl` mais recente em `~/.claude/projects/` (`src/transcript.ts`),
  porque o ccusage só expõe a lista de modelos do bloco inteiro (mistura opus/haiku/etc).
- **Custo**: em assinatura é só equivalente de preço de API (não cobrança). Setting `accountType`.
  Os números de custo de hoje/mês vêm do **ccusage** (oficiais); a quebra por modelo/projeto/contexto
  vem de uma **tabela de preços local** (`src/pricing.ts`, `tabela vX`), sempre rotulada
  **"≈ aproximado"** — atribuição, nunca contradiz o número oficial do ccusage.
- **Insights/Dicas** (`src/transcriptStats.ts`): agregação **local, sem rede e sem LLM** dos
  transcripts, com **cache por mtime** e gate por `insightsEnabled`.
