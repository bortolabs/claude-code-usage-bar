import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { HistoryStore, DaySnapshot } from "../src/history/store";
import {
  snapshotsFromStats,
  hourlyHeatmap,
  heatmapPeak,
  compareWindows,
} from "../src/history/aggregate";
import { DayStat, HourStat } from "../src/transcriptStats";

/**
 * Fixtures: HistoryStore usa fs de verdade (JSONL em disco), então cada teste
 * ganha um tmpdir próprio, limpo no afterEach. Nenhum mock de `vscode` é
 * necessário aqui — os módulos de history/aggregate não importam vscode.
 */

/** Monta um DaySnapshot terso, com hours[24] zerado por padrão. */
function snap(
  date: string,
  tokens: number,
  over: Partial<Omit<DaySnapshot, "date" | "tokens">> = {}
): DaySnapshot {
  return {
    date,
    tokens,
    costUSD: over.costUSD ?? tokens / 100,
    msgs: over.msgs ?? 1,
    hours: over.hours ?? new Array(24).fill(0),
  };
}

/** Gera N dias consecutivos a partir de `start` (YYYY-MM-DD), todos com `tokens`. */
function daysFrom(start: string, n: number, tokens: number): DaySnapshot[] {
  const d = new Date(`${start}T00:00:00`);
  const out: DaySnapshot[] = [];
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(snap(`${y}-${m}-${day}`, tokens));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-bar-history-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("HistoryStore", () => {
  it("readAll sem arquivo → []", () => {
    const store = new HistoryStore(dir);
    expect(store.readAll()).toEqual([]);
  });

  it("upsert então readAll faz roundtrip; upsert do mesmo dia substitui (last wins)", () => {
    const store = new HistoryStore(dir);
    store.upsert([snap("2026-06-30", 100)], 30);
    store.upsert([snap("2026-06-30", 999)], 30); // mesma data, valor novo
    const all = store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].date).toBe("2026-06-30");
    expect(all[0].tokens).toBe(999);
  });

  it("retenção: upsert com retentionDays=N mantém só os N dias mais recentes", () => {
    const store = new HistoryStore(dir);
    const days = daysFrom("2026-06-01", 10, 50); // 10 dias, 01..10
    store.upsert(days, 3);
    const all = store.readAll();
    expect(all).toHaveLength(3);
    expect(all.map((d) => d.date)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
    ]);
  });

  it("linha corrompida no meio do arquivo é ignorada sem lançar", () => {
    const store = new HistoryStore(dir);
    const file = path.join(dir, "history.jsonl");
    const lines = [
      JSON.stringify(snap("2026-06-28", 10)),
      '{"date": "2026-06-29", "tokens": ' /* linha quebrada, JSON incompleto */,
      JSON.stringify(snap("2026-06-30", 30)),
      "",
    ].join("\n");
    fs.writeFileSync(file, lines);

    expect(() => store.readAll()).not.toThrow();
    const all = store.readAll();
    expect(all.map((d) => d.date)).toEqual(["2026-06-28", "2026-06-30"]);
    expect(all.map((d) => d.tokens)).toEqual([10, 30]);
  });

  it("readRange(days) retorna só os últimos N dias, em ordem ascendente", () => {
    const store = new HistoryStore(dir);
    const days = daysFrom("2026-06-01", 10, 5);
    store.upsert(days, 30); // retenção ampla, não poda nada
    const range = store.readRange(4);
    expect(range.map((d) => d.date)).toEqual([
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
    ]);
  });
});

describe("snapshotsFromStats", () => {
  it("combina byDay + byHour em snapshots com hours[24]; dia sem byHour vira zeros", () => {
    const byDay: DayStat[] = [
      {
        date: "2026-07-01",
        tokens: 100,
        costUSD: 1,
        messages: 5,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      {
        date: "2026-07-02",
        tokens: 20,
        costUSD: 0.2,
        messages: 2,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    ];
    const byHour: HourStat[] = [
      {
        hour: "2026-07-01 10:00",
        tokens: 60,
        costUSD: 0.6,
        messages: 3,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      {
        hour: "2026-07-01 14:00",
        tokens: 40,
        costUSD: 0.4,
        messages: 2,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    ];
    const snaps = snapshotsFromStats(byDay, byHour);
    expect(snaps).toHaveLength(2);

    const d1 = snaps.find((s) => s.date === "2026-07-01")!;
    expect(d1.tokens).toBe(100);
    expect(d1.hours).toHaveLength(24);
    expect(d1.hours[10]).toBe(60);
    expect(d1.hours[14]).toBe(40);
    expect(d1.hours.filter((_, i) => i !== 10 && i !== 14).every((v) => v === 0)).toBe(
      true
    );

    // dia sem entradas em byHour → 24 zeros
    const d2 = snaps.find((s) => s.date === "2026-07-02")!;
    expect(d2.hours).toEqual(new Array(24).fill(0));
  });
});

describe("hourlyHeatmap / heatmapPeak", () => {
  it("dois snapshots no mesmo dia-da-semana acumulam na mesma linha", () => {
    // 2026-07-01 é quarta-feira (weekday index 3); +7 dias cai na mesma quarta.
    const hoursA = new Array(24).fill(0);
    hoursA[9] = 30;
    const hoursB = new Array(24).fill(0);
    hoursB[9] = 20;

    const days: DaySnapshot[] = [
      snap("2026-07-01", 30, { hours: hoursA }),
      snap("2026-07-08", 20, { hours: hoursB }),
    ];
    const heat = hourlyHeatmap(days);
    expect(heat).toHaveLength(7);
    expect(heat[3][9]).toBe(50); // acumulado na quarta, hora 9
  });

  it("heatmapPeak retorna a célula máxima; tudo-zero → null", () => {
    const hours = new Array(24).fill(0);
    hours[9] = 50;
    hours[20] = 5;
    const days: DaySnapshot[] = [snap("2026-07-01", 55, { hours })];
    const heat = hourlyHeatmap(days);
    const peak = heatmapPeak(heat);
    expect(peak).toEqual({ weekday: 3, hour: 9, tokens: 50 });

    const zeroHeat = hourlyHeatmap([]);
    expect(heatmapPeak(zeroHeat)).toBeNull();
  });
});

describe("compareWindows", () => {
  it("menos de 3 dias passados → todayVsAvg null", () => {
    const days = [...daysFrom("2026-06-29", 2, 100), snap("2026-07-01", 200)];
    const cmp = compareWindows(days, "2026-07-01");
    expect(cmp.todayVsAvg).toBeNull();
  });

  it("menos de 4+4 dias → weekVsPrev null", () => {
    // só 5 dias no total, não dá pra formar last7(>=4) + prev7(>=4)
    const days = daysFrom("2026-06-27", 5, 100);
    const cmp = compareWindows(days, "2026-07-01");
    expect(cmp.weekVsPrev).toBeNull();
  });

  it("hoje 200 tokens vs 7 dias anteriores de 100 cada → todayVsAvg.tokensPct ≈ 100", () => {
    const past = daysFrom("2026-06-24", 7, 100); // 06-24..06-30
    const today = snap("2026-07-01", 200);
    const cmp = compareWindows([...past, today], "2026-07-01");
    expect(cmp.todayVsAvg).not.toBeNull();
    expect(cmp.todayVsAvg!.tokensPct).toBeCloseTo(100, 6);
    expect(cmp.todayVsAvg!.current.tokens).toBe(200);
    expect(cmp.todayVsAvg!.baseline.tokens).toBe(100);
  });

  it("soma dos últimos 7 vs 7 anteriores calcula o percentual corretamente", () => {
    // prev7: 06-18..06-24 com 100 tokens/dia = soma 700
    // last7: 06-25..07-01 com 150 tokens/dia = soma 1050 (+50%)
    const prev7 = daysFrom("2026-06-18", 7, 100);
    const last7 = daysFrom("2026-06-25", 7, 150);
    const cmp = compareWindows([...prev7, ...last7], "2026-07-01");
    expect(cmp.weekVsPrev).not.toBeNull();
    expect(cmp.weekVsPrev!.current.tokens).toBe(1050);
    expect(cmp.weekVsPrev!.baseline.tokens).toBe(700);
    expect(cmp.weekVsPrev!.tokensPct).toBeCloseTo(50, 6);
  });

  it("baseline zero (dias passados todos com 0 tokens) → tokensPct null", () => {
    const past = daysFrom("2026-06-24", 7, 0);
    const today = snap("2026-07-01", 200);
    const cmp = compareWindows([...past, today], "2026-07-01");
    expect(cmp.todayVsAvg).not.toBeNull();
    expect(cmp.todayVsAvg!.tokensPct).toBeNull();
  });
});
