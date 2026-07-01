import { DayStat, HourStat } from "../transcriptStats";
import { DaySnapshot } from "./store";

/**
 * Agregações PURAS sobre o histórico persistente (testáveis em unidade):
 * conversão TranscriptStats→snapshots, heatmap semana×hora e comparativos.
 */

/** Converte byDay/byHour do transcriptStats em snapshots por dia (hours[24]). */
export function snapshotsFromStats(
  byDay: DayStat[],
  byHour: HourStat[]
): DaySnapshot[] {
  const hoursByDay = new Map<string, number[]>();
  for (const h of byHour) {
    // chave "YYYY-MM-DD HH:00" (local)
    const date = h.hour.slice(0, 10);
    const hh = Number(h.hour.slice(11, 13));
    if (isNaN(hh)) {
      continue;
    }
    const arr = hoursByDay.get(date) ?? new Array(24).fill(0);
    arr[hh] += h.tokens;
    hoursByDay.set(date, arr);
  }
  return byDay.map((d) => ({
    date: d.date,
    tokens: d.tokens,
    costUSD: d.costUSD,
    msgs: d.messages,
    hours: hoursByDay.get(d.date) ?? new Array(24).fill(0),
  }));
}

/** Dia da semana LOCAL (0=domingo) de uma data "YYYY-MM-DD". */
function weekdayOf(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return new Date(y, m - 1, d).getDay();
}

/** Heatmap semana×hora: tokens somados por [dia-da-semana 0..6][hora 0..23]. */
export function hourlyHeatmap(days: DaySnapshot[]): number[][] {
  const heat: number[][] = Array.from({ length: 7 }, () =>
    new Array(24).fill(0)
  );
  for (const d of days) {
    const wd = weekdayOf(d.date);
    for (let h = 0; h < 24 && h < d.hours.length; h++) {
      heat[wd][h] += d.hours[h] || 0;
    }
  }
  return heat;
}

/** Célula de pico do heatmap (null se tudo zero). */
export function heatmapPeak(
  heat: number[][]
): { weekday: number; hour: number; tokens: number } | null {
  let best: { weekday: number; hour: number; tokens: number } | null = null;
  for (let wd = 0; wd < heat.length; wd++) {
    for (let h = 0; h < heat[wd].length; h++) {
      if (heat[wd][h] > 0 && (!best || heat[wd][h] > best.tokens)) {
        best = { weekday: wd, hour: h, tokens: heat[wd][h] };
      }
    }
  }
  return best;
}

export interface WindowDelta {
  /** Variação percentual (ex.: +35 → 35% acima). null = sem base de comparação. */
  tokensPct: number | null;
  costPct: number | null;
  current: { tokens: number; costUSD: number };
  baseline: { tokens: number; costUSD: number };
}
export interface Comparisons {
  /** Hoje vs média dos 7 dias anteriores (exclui hoje). */
  todayVsAvg: WindowDelta | null;
  /** Últimos 7 dias (incluindo hoje) vs os 7 anteriores. */
  weekVsPrev: WindowDelta | null;
}

function pctDelta(cur: number, base: number): number | null {
  if (!(base > 0)) {
    return null;
  }
  return ((cur - base) / base) * 100;
}

/** Comparativos de janelas (ROADMAP #14) a partir dos snapshots diários. */
export function compareWindows(
  days: DaySnapshot[],
  todayKey: string
): Comparisons {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const past = sorted.filter((d) => d.date < todayKey);
  const today = sorted.find((d) => d.date === todayKey) ?? null;

  let todayVsAvg: WindowDelta | null = null;
  const base7 = past.slice(-7);
  if (today && base7.length >= 3) {
    const avgTok = base7.reduce((a, d) => a + d.tokens, 0) / base7.length;
    const avgCost = base7.reduce((a, d) => a + d.costUSD, 0) / base7.length;
    todayVsAvg = {
      tokensPct: pctDelta(today.tokens, avgTok),
      costPct: pctDelta(today.costUSD, avgCost),
      current: { tokens: today.tokens, costUSD: today.costUSD },
      baseline: { tokens: Math.round(avgTok), costUSD: avgCost },
    };
  }

  let weekVsPrev: WindowDelta | null = null;
  const upToToday = sorted.filter((d) => d.date <= todayKey);
  const last7 = upToToday.slice(-7);
  const prev7 = upToToday.slice(-14, -7);
  if (last7.length >= 4 && prev7.length >= 4) {
    const sum = (arr: DaySnapshot[], f: (d: DaySnapshot) => number) =>
      arr.reduce((a, d) => a + f(d), 0);
    const curTok = sum(last7, (d) => d.tokens);
    const prevTok = sum(prev7, (d) => d.tokens);
    const curCost = sum(last7, (d) => d.costUSD);
    const prevCost = sum(prev7, (d) => d.costUSD);
    weekVsPrev = {
      tokensPct: pctDelta(curTok, prevTok),
      costPct: pctDelta(curCost, prevCost),
      current: { tokens: curTok, costUSD: curCost },
      baseline: { tokens: prevTok, costUSD: prevCost },
    };
  }

  return { todayVsAvg, weekVsPrev };
}
