# Changelog

## 0.2.0

- **Suporte a todos os tipos de conta** com modo adaptativo automático:
  - Assinatura (Pro/Max): anel = janela 5h, número = janela 7d (limites do plano, igual ao `/usage`).
  - API/pay-as-you-go: número = custo $ acumulado, anel = uso de contexto (não há limite de plano).
- Novo setting `claudeUsageBar.mode` (`auto`/`subscriber`/`cost`) e `claudeUsageBar.costCapUsd`.
- Foco nos limites de plano e custo (o uso de contexto já é coberto pelo `/context`).
- Removido o comando de alternar métrica (substituído pela detecção automática de modo).

## 0.1.0

- Versão inicial.
- Indicador na status bar com anel de progresso + percentual.
- Métricas: janela de 5h, janela de 7d (limites do plano, igual ao `/usage`) e uso de contexto.
- Tooltip com breakdown completo: sessão 5h/7d, contexto, tokens da última chamada,
  custo estimado, modelo e sessão.
- Clique alterna a métrica primária.
- Lê o estado de `~/.claude/usage-state.json`, gravado pela statusline do Claude Code.
