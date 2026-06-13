import { CcusageData } from "./ccusage";

export interface AlertInput {
  block: CcusageData | null;
  costCap: number;
  maxPerHour: number;
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

export function evaluateAlerts(input: AlertInput): AlertResult {
  const reasons: string[] = [];
  const keys: string[] = [];

  // 1. Projeção de custo do bloco > teto
  if (input.block && input.costCap > 0 && input.block.projectedCost != null) {
    if (input.block.projectedCost > input.costCap) {
      reasons.push(
        `Nesse ritmo: ${fmtUsd(input.block.projectedCost)} até o reset (teto ${fmtUsd(
          input.costCap
        )})`
      );
      keys.push("cost");
    }
  }

  // 2. Ritmo alto ($/h)
  if (
    input.block &&
    input.maxPerHour > 0 &&
    input.block.burnCostPerHour != null &&
    input.block.burnCostPerHour > input.maxPerHour
  ) {
    reasons.push(
      `Ritmo alto: ${fmtUsd(input.block.burnCostPerHour)}/h (limite ${fmtUsd(
        input.maxPerHour
      )}/h)`
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
    reasons.push(`Sessão 5h projeta atingir 100% antes do reset`);
    keys.push("plan5h");
  }
  const proj7d = projectLimitPct(
    input.sevenDay,
    input.sevenDayResetsAt,
    7 * 24 * 3600
  );
  if (proj7d != null && proj7d >= 100) {
    reasons.push(`Limite semanal projeta atingir 100% antes do reset`);
    keys.push("plan7d");
  }

  return {
    active: reasons.length > 0,
    message: reasons[0] ?? "",
    reasons,
    key: keys.sort().join("+"),
  };
}
