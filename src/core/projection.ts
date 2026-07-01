import { CcusageData } from "../ccusage";

/**
 * Funções PURAS de projeção/ETA da janela de cota — extraídas do extension.ts
 * (e da variante duplicada do alerts.ts) para serem testáveis em unidade.
 * `nowMs` é injetável nos testes; em produção fica o Date.now() padrão.
 */

/**
 * Projeta a % de um limite (5h/7d) no momento do reset, assumindo ritmo linear
 * desde o início da janela. Retorna null se cedo demais pra estimar.
 * Exige >= 25% da janela decorrida: cedo demais, o ritmo é ruidoso e a
 * projeção linear vira alarmista (ex.: 20% em 1h projetaria 100%).
 */
export function projectLimitPct(
  usedPct: number | null,
  resetsAtSec: number | null,
  windowSeconds: number,
  nowMs: number = Date.now()
): number | null {
  if (usedPct == null || !resetsAtSec) {
    return null;
  }
  const remainingMs = resetsAtSec * 1000 - nowMs;
  if (remainingMs <= 0) {
    return usedPct;
  }
  const remainingSec = remainingMs / 1000;
  const elapsedSec = windowSeconds - remainingSec;
  if (elapsedSec < windowSeconds * 0.25) {
    return null;
  }
  return usedPct + (usedPct / elapsedSec) * remainingSec;
}

/**
 * ETA (em minutos) até um limite percentual atingir 100%, no ritmo atual.
 * Retorna null se não dá pra estimar ou se NÃO estoura antes do reset.
 */
export function etaToLimitMin(
  usedPct: number | null,
  resetsAtSec: number | null,
  windowSeconds: number,
  nowMs: number = Date.now()
): number | null {
  if (usedPct == null || !resetsAtSec || usedPct >= 100) {
    return usedPct != null && usedPct >= 100 ? 0 : null;
  }
  const remainingMs = resetsAtSec * 1000 - nowMs;
  if (remainingMs <= 0) {
    return null;
  }
  const remainingSec = remainingMs / 1000;
  const elapsedSec = windowSeconds - remainingSec;
  if (elapsedSec < windowSeconds * 0.25) {
    return null; // cedo demais p/ taxa confiável
  }
  const ratePerSec = usedPct / elapsedSec; // %/s
  if (ratePerSec <= 0) {
    return null;
  }
  const secsToFull = (100 - usedPct) / ratePerSec;
  // Só interessa se estoura ANTES do reset.
  if (secsToFull >= remainingSec) {
    return null;
  }
  return Math.max(0, Math.round(secsToFull / 60));
}

/**
 * % de tempo decorrido da janela de 5h. Usa o reset REAL (oauth) como âncora:
 * decorrido = 5h - tempo_restante. Cai no timePct do ccusage só se não houver
 * reset do oauth. Evita a divergência logo após o reset (bloco fixo do ccusage).
 */
export function sessionTimePct(
  fiveHourResetMs: number | null,
  block: CcusageData | null,
  nowMs: number = Date.now()
): number | null {
  const WINDOW_MS = 5 * 3600 * 1000;
  if (fiveHourResetMs) {
    const remaining = fiveHourResetMs - nowMs;
    const elapsed = WINDOW_MS - remaining;
    return Math.max(0, Math.min(100, (elapsed / WINDOW_MS) * 100));
  }
  return block ? block.timePct : null;
}
