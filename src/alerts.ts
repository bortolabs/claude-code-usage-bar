import * as vscode from "vscode";
import { CcusageData } from "./ccusage";

export interface AlertInput {
  block: CcusageData | null;
  costCap: number;
  maxPerHour: number;
  /** Teto de tokens da sessão de 5h (0 = desativado). */
  tokenCap: number;
  /** Limites reais do plano (terminal), se disponíveis. */
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetsAt: number | null;
  sevenDayResetsAt: number | null;
}

export interface AlertResult {
  active: boolean;
  /** Mensagem curta para notificação/painel. */
  message: string;
  /** Razões individuais (para o painel listar). */
  reasons: string[];
  /** Chave estável p/ dedupe de notificação (muda quando o tipo de alerta muda). */
  key: string;
}

function fmtUsd(n: number): string {
  if (n >= 100) {
    return "$" + n.toFixed(0);
  }
  if (n >= 10) {
    return "$" + n.toFixed(1);
  }
  return "$" + n.toFixed(2);
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(0) + "k";
  }
  return String(Math.round(n));
}

/**
 * Projeta se um limite percentual (5h/7d) vai bater 100% antes do reset,
 * com base na velocidade média de consumo desde o início (assume uso linear).
 * Retorna a % projetada no momento do reset, ou null se não dá pra estimar.
 */
function projectLimitPct(
  usedPct: number | null,
  resetsAtSec: number | null,
  windowSeconds: number
): number | null {
  if (usedPct == null || !resetsAtSec) {
    return null;
  }
  const remainingMs = resetsAtSec * 1000 - Date.now();
  if (remainingMs <= 0) {
    return usedPct;
  }
  const remainingSec = remainingMs / 1000;
  const elapsedSec = windowSeconds - remainingSec;
  if (elapsedSec <= 60) {
    return null; // cedo demais pra projetar
  }
  const ratePerSec = usedPct / elapsedSec;
  return usedPct + ratePerSec * remainingSec;
}

/** Minutos → rótulo curto ("3 min", "1h05"). Mínimo de 1 min. */
function fmtMins(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}h${String(rm).padStart(2, "0")}` : `${h}h`;
  }
  return `${m} min`;
}

/**
 * Dica de ritmo: dado o "fôlego" até o teto (headroom, na mesma unidade de
 * ritmo×tempo), o ritmo de consumo por minuto e os minutos até o reset, calcula
 * quanto PAUSAR (idle) ou quanto REDUZIR o ritmo pra NÃO estourar antes do reset.
 *
 * `runwayMin` = quanto o fôlego dura no ritmo atual. Se já dura até o reset
 * (>= remainingMin), não há estouro previsto → null (sem dica). Senão:
 *  - pausar `remainingMin - runwayMin` empata o ritmo médio com o tempo;
 *  - reduzir o ritmo em `(1 - runwayMin/remainingMin)` faz o fôlego durar o resto.
 * É a mesma ideia do alerta: enquanto uso% <= tempo%, não estoura.
 */
function pacingHint(
  headroom: number,
  ratePerMin: number,
  remainingMin: number
): { waitMin: number; reducePct: number } | null {
  if (!(headroom > 0) || !(ratePerMin > 0) || !(remainingMin > 0)) {
    return null;
  }
  const runwayMin = headroom / ratePerMin;
  if (runwayMin >= remainingMin) {
    return null; // o ritmo atual já cabe até o reset
  }
  return {
    waitMin: remainingMin - runwayMin,
    reducePct: (1 - runwayMin / remainingMin) * 100,
  };
}

/**
 * Dica de ritmo p/ um limite percentual do plano (5h), no MESMO modelo do alerta
 * (ritmo médio desde o início): fôlego = 100 - uso%; ritmo = uso% / minutos
 * decorridos. Só devolve algo quando projeta estourar antes do reset.
 */
function planPacingHint(
  usedPct: number | null,
  resetsAtSec: number | null,
  windowSeconds: number
): { waitMin: number; reducePct: number } | null {
  if (usedPct == null || !resetsAtSec) {
    return null;
  }
  const remainingMs = resetsAtSec * 1000 - Date.now();
  if (remainingMs <= 0) {
    return null;
  }
  const remainingMin = remainingMs / 60000;
  const elapsedMin = (windowSeconds * 1000 - remainingMs) / 60000;
  if (elapsedMin <= 1) {
    return null; // cedo demais
  }
  return pacingHint(100 - usedPct, usedPct / elapsedMin, remainingMin);
}

export function evaluateAlerts(input: AlertInput): AlertResult {
  const reasons: string[] = [];
  const keys: string[] = [];

  // 1. Projeção de custo do bloco > teto
  if (input.block && input.costCap > 0 && input.block.projectedCost != null) {
    if (input.block.projectedCost > input.costCap) {
      reasons.push(
        vscode.l10n.t(
          "Nesse ritmo: {0} até o reset (teto {1})",
          fmtUsd(input.block.projectedCost),
          fmtUsd(input.costCap)
        )
      );
      keys.push("cost");
    }
  }

  // 1b. Projeção de TOKENS da sessão > teto de tokens (ritmo de uso vs tempo)
  if (
    input.block &&
    input.tokenCap > 0 &&
    input.block.projectedTokens != null &&
    input.block.projectedTokens > input.tokenCap
  ) {
    reasons.push(
      vscode.l10n.t(
        "Nesse ritmo: {0} tokens até o reset (teto {1})",
        fmtTok(input.block.projectedTokens),
        fmtTok(input.tokenCap)
      )
    );
    keys.push("tokens");
  }

  // 2. Ritmo alto ($/h)
  if (
    input.block &&
    input.maxPerHour > 0 &&
    input.block.burnCostPerHour != null &&
    input.block.burnCostPerHour > input.maxPerHour
  ) {
    reasons.push(
      vscode.l10n.t(
        "Ritmo alto: {0}/h (limite {1}/h)",
        fmtUsd(input.block.burnCostPerHour),
        fmtUsd(input.maxPerHour)
      )
    );
    keys.push("rate");
  }

  // 3. Projeção dos limites do plano (terminal)
  const proj5h = projectLimitPct(
    input.fiveHour,
    input.fiveHourResetsAt,
    5 * 3600
  );
  if (proj5h != null && proj5h >= 100) {
    reasons.push(
      vscode.l10n.t("Sessão 5h projeta atingir 100% antes do reset")
    );
    keys.push("plan5h");
  }
  const proj7d = projectLimitPct(
    input.sevenDay,
    input.sevenDayResetsAt,
    7 * 24 * 3600
  );
  if (proj7d != null && proj7d >= 100) {
    reasons.push(
      vscode.l10n.t("Limite semanal projeta atingir 100% antes do reset")
    );
    keys.push("plan7d");
  }

  // Dica de ritmo (💡): só quando ALGO projeta estouro antes do reset. Prioriza a
  // projeção 5h do plano (ritmo médio); no modo custo, usa o $/h vs o teto. Vira
  // uma sub-linha do alerta — NÃO entra na `key` de dedupe (não é um tipo novo de
  // alerta, então não dispara notificação por si só).
  let pacing = planPacingHint(input.fiveHour, input.fiveHourResetsAt, 5 * 3600);
  if (
    !pacing &&
    input.block &&
    input.costCap > 0 &&
    input.block.burnCostPerHour
  ) {
    pacing = pacingHint(
      input.costCap - input.block.costUSD,
      input.block.burnCostPerHour / 60,
      input.block.remainingMinutes
    );
  }
  if (pacing && reasons.length > 0) {
    reasons.push(
      vscode.l10n.t(
        "💡 Pra não estourar: pause ~{0} ou reduza o ritmo ~{1}%",
        fmtMins(pacing.waitMin),
        String(Math.max(1, Math.round(pacing.reducePct)))
      )
    );
  }

  return {
    active: reasons.length > 0,
    message: reasons[0] ?? "",
    reasons,
    key: keys.sort().join("+"),
  };
}
