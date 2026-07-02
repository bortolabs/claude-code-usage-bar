import { projectLimitPct } from "./projection";

/**
 * Previsão estatística de fim-de-cota (ROADMAP #12) — PURA, local, sem LLM.
 *
 * O alerta de burn rate (core/projection.ts) projeta LINEAR: assume que o ritmo
 * das próximas horas = ritmo médio até agora. Isso ignora que o uso tem forma
 * (você usa mais em certas horas/dias). Aqui a projeção pondera o tempo restante
 * pela CURVA HISTÓRICA de uso (heatmap semana×hora, 7×24, já persistido na 0.35):
 *
 *   rate  = uso% / (intensidade histórica das horas JÁ decorridas na janela)
 *   proj  = uso% + rate × (intensidade histórica das horas RESTANTES)
 *
 * Se as horas que vêm são historicamente mais pesadas que as já vividas, projeta
 * ACIMA do linear; se mais leves, ABAIXO. Com heatmap uniforme (ou sem sinal),
 * colapsa no linear — degradação graciosa. `nowMs` é injetável p/ testes.
 */

const WINDOW_MS = 5 * 3600 * 1000;

export type ForecastMethod = "heatmap" | "linear";
export type ForecastVerdict = "fits" | "tight" | "exhausts";

export interface ForecastInput {
  /** Utilização atual da janela de 5h (0..100), do oauth. */
  usedPct: number | null;
  /** Reset da janela de 5h em epoch ms (oauth). */
  fiveHourResetMs: number | null;
  /** Heatmap 7×24 (weekday × hora local) de tokens — de hourlyHeatmap(). */
  heatmap: number[][] | null;
  nowMs?: number;
}

export interface ForecastResult {
  /** % projetada no reset (>= usedPct, arredondada). */
  projectedPct: number;
  /** heatmap = ponderada pela curva; linear = fallback sem sinal histórico. */
  method: ForecastMethod;
  /** fits < 90 <= tight < 100 <= exhausts. */
  verdict: ForecastVerdict;
  /** Projeção linear pura, p/ referência/contraste (null se cedo demais). */
  linearPct: number | null;
}

/** Curva diurna: média (entre weekdays com dado) de tokens por hora local. */
function hourAverages(heat: number[][]): number[] {
  const avg = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    let n = 0;
    for (let wd = 0; wd < 7; wd++) {
      const v = heat[wd]?.[h] ?? 0;
      if (v > 0) {
        sum += v;
        n++;
      }
    }
    avg[h] = n > 0 ? sum / n : 0;
  }
  return avg;
}

/**
 * Peso de uma célula (weekday, hora): a intensidade histórica exata; se aquela
 * célula nunca teve uso, cai pra média diurna da hora; se nem isso, peso plano 1
 * (mantém os pesos positivos p/ não zerar a razão). O piso 1 só entra quando NÃO
 * há sinal nenhum pra aquela hora.
 */
function cellWeight(heat: number[][], hourAvg: number[], wd: number, h: number): number {
  const v = heat[wd]?.[h] ?? 0;
  if (v > 0) {
    return v;
  }
  const a = hourAvg[h] ?? 0;
  return a > 0 ? a : 1;
}

/**
 * Integra a intensidade histórica sobre [startMs, endMs), hora local a hora
 * local, cobrindo frações de hora nas bordas. Usa horário LOCAL (getDay/
 * getHours), coerente com como o heatmap foi construído (weekdayOf/hours locais).
 */
function intensityOverSpan(
  heat: number[][],
  hourAvg: number[],
  startMs: number,
  endMs: number
): number {
  if (endMs <= startMs) {
    return 0;
  }
  let total = 0;
  let cur = startMs;
  while (cur < endMs) {
    const d = new Date(cur);
    const wd = d.getDay();
    const h = d.getHours();
    // início da próxima hora local
    const next = new Date(cur);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    const segEnd = Math.min(next.getTime(), endMs);
    const frac = (segEnd - cur) / 3_600_000;
    total += cellWeight(heat, hourAvg, wd, h) * frac;
    cur = segEnd;
  }
  return total;
}

function verdictOf(pct: number): ForecastVerdict {
  if (pct >= 100) {
    return "exhausts";
  }
  if (pct >= 90) {
    return "tight";
  }
  return "fits";
}

/**
 * Projeção da janela de 5h ponderada pelo heatmap, com fallback linear.
 * null quando não dá pra estimar (sem uso%, sem reset, ou < 25% da janela
 * decorrida — cedo demais, o ritmo é ruidoso, mesma guarda do projectLimitPct).
 */
export function forecastFiveHour(input: ForecastInput): ForecastResult | null {
  const nowMs = input.nowMs ?? Date.now();
  const { usedPct, fiveHourResetMs, heatmap } = input;
  if (usedPct == null || !fiveHourResetMs) {
    return null;
  }
  const resetsAtSec = Math.floor(fiveHourResetMs / 1000);
  const linear = projectLimitPct(usedPct, resetsAtSec, WINDOW_MS / 1000, nowMs);
  const linearPct = linear == null ? null : Math.round(linear);

  const remainingMs = fiveHourResetMs - nowMs;
  if (remainingMs <= 0) {
    return {
      projectedPct: Math.round(usedPct),
      method: "linear",
      verdict: verdictOf(usedPct),
      linearPct: Math.round(usedPct),
    };
  }

  const startMs = fiveHourResetMs - WINDOW_MS;
  const elapsedMs = nowMs - startMs;
  if (elapsedMs < WINDOW_MS * 0.25) {
    return null; // cedo demais
  }

  const hasSignal = !!heatmap && heatmap.some((r) => r.some((v) => v > 0));
  if (hasSignal) {
    const hourAvg = hourAverages(heatmap!);
    const elapsedW = intensityOverSpan(heatmap!, hourAvg, startMs, nowMs);
    const remainingW = intensityOverSpan(heatmap!, hourAvg, nowMs, fiveHourResetMs);
    if (elapsedW > 0) {
      const projected = usedPct + (usedPct / elapsedW) * remainingW;
      const clamped = Math.max(Math.round(usedPct), Math.round(projected));
      return {
        projectedPct: clamped,
        method: "heatmap",
        verdict: verdictOf(clamped),
        linearPct,
      };
    }
  }

  if (linearPct == null) {
    return null;
  }
  return {
    projectedPct: linearPct,
    method: "linear",
    verdict: verdictOf(linearPct),
    linearPct,
  };
}

/**
 * "Melhor horário pra tarefa pesada": entre as próximas `withinHours` horas, a
 * de MENOR intensidade histórica (weekday × hora). Usa o valor bruto do heatmap
 * (0 = hora nunca usada = legitimamente a mais leve). null se não há sinal.
 */
export function lightestUpcomingHour(
  heatmap: number[][] | null,
  withinHours: number,
  nowMs?: number
): { weekday: number; hour: number } | null {
  const now = nowMs ?? Date.now();
  if (!heatmap || !heatmap.some((r) => r.some((v) => v > 0)) || withinHours < 1) {
    return null;
  }
  const hourAvg = hourAverages(heatmap);
  let best: { weekday: number; hour: number; intensity: number } | null = null;
  for (let i = 1; i <= withinHours; i++) {
    const d = new Date(now + i * 3_600_000);
    const wd = d.getDay();
    const h = d.getHours();
    // bruto (sem piso plano): heat exato → média diurna → 0.
    const intensity = (heatmap[wd]?.[h] ?? 0) || (hourAvg[h] ?? 0) || 0;
    if (!best || intensity < best.intensity) {
      best = { weekday: wd, hour: h, intensity };
    }
  }
  return best ? { weekday: best.weekday, hour: best.hour } : null;
}
