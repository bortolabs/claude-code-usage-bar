import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { HistoryStore, DaySnapshot } from "../src/history/store";
import { createHistoryRecorder, HistoryRecorderDeps } from "../src/history/recorder";
import { DayStat } from "../src/transcriptStats";

/**
 * O recorder junta o que não dá pra errar na gravação do histórico: uma varredura
 * por vez, nada gravado depois do descarte e nunca rejeitar. A varredura é falsa
 * (promise controlada pelo teste); o store é o de verdade, num tmpdir por teste.
 */

type Scanned = Awaited<ReturnType<HistoryRecorderDeps["scan"]>>;

const dayStat = (date: string, tokens: number): DayStat => ({
  date,
  tokens,
  costUSD: tokens / 100,
  messages: 1,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
const stored = (date: string, tokens: number): DaySnapshot => ({
  date,
  tokens,
  costUSD: tokens / 100,
  msgs: 1,
  hours: new Array(24).fill(0),
});
const scanned = (...days: DayStat[]): Scanned => ({ byDay: days, byHour: [] });

/** Promise que o teste resolve/rejeita quando quiser. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// "Agora" fixo: 10/07/2026 ao meio-dia LOCAL → os dias recentes são 08, 09 e 10.
const NOW = new Date(2026, 6, 10, 12, 0).getTime();

let dir: string;
let store: HistoryStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-bar-recorder-test-"));
  store = new HistoryStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function setup(over: Partial<HistoryRecorderDeps> = {}) {
  const onWritten = vi.fn();
  const scan = vi.fn<HistoryRecorderDeps["scan"]>(async () => scanned());
  const recorder = createHistoryRecorder({
    store,
    scan,
    isEnabled: () => true,
    retentionDays: () => 365,
    onWritten,
    now: () => NOW,
    ...over,
  });
  return { recorder, scan: (over.scan as typeof scan) ?? scan, onWritten };
}
const tokensByDate = () =>
  Object.fromEntries(store.readAll().map((d) => [d.date, d.tokens]));

describe("createHistoryRecorder", () => {
  it("varre da meia-noite local de N dias atrás até agora", async () => {
    const { recorder, scan } = setup();
    await recorder.run(90);
    expect(scan).toHaveBeenCalledTimes(1);
    const [start, end] = scan.mock.calls[0];
    expect(start).toBe(new Date(2026, 6, 10 - 90).getTime());
    expect(end).toBe(NOW);
  });

  it("preenche dias ausentes, regrava os recentes e preserva o antigo já gravado", async () => {
    store.upsert([stored("2026-07-01", 111), stored("2026-07-09", 5)], 365);
    const { recorder, onWritten } = setup({
      scan: async () =>
        scanned(
          dayStat("2026-07-01", 999), // antigo e já gravado: fica como está
          dayStat("2026-07-02", 200), // antigo e ausente: entra
          dayStat("2026-07-09", 300), // recente: regrava
          dayStat("2026-07-10", 400)
        ),
    });
    await recorder.run(90);
    expect(tokensByDate()).toEqual({
      "2026-07-01": 111,
      "2026-07-02": 200,
      "2026-07-09": 300,
      "2026-07-10": 400,
    });
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it("varredura sem nada a gravar não toca o store nem avisa", async () => {
    store.upsert([stored("2026-07-01", 111)], 365);
    const { recorder, onWritten } = setup({
      scan: async () => scanned(dayStat("2026-07-01", 999)),
    });
    await recorder.run(90);
    expect(tokensByDate()).toEqual({ "2026-07-01": 111 });
    expect(onWritten).not.toHaveBeenCalled();
  });

  it("uma varredura por vez: a que chega no meio de outra é pulada", async () => {
    const first = deferred<Scanned>();
    const scan = vi
      .fn<HistoryRecorderDeps["scan"]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(scanned(dayStat("2026-07-10", 2)));
    const { recorder } = setup({ scan });

    const running = recorder.run(90);
    await recorder.run(2); // pulada: não varre de novo
    expect(scan).toHaveBeenCalledTimes(1);

    first.resolve(scanned(dayStat("2026-07-10", 1)));
    await running;
    expect(tokensByDate()).toEqual({ "2026-07-10": 1 });

    await recorder.run(2); // a guarda foi solta
    expect(scan).toHaveBeenCalledTimes(2);
    expect(tokensByDate()).toEqual({ "2026-07-10": 2 });
  });

  it("descartado no meio da varredura: avisa o scan e não grava", async () => {
    const pending = deferred<Scanned>();
    const scan = vi.fn<HistoryRecorderDeps["scan"]>(() => pending.promise);
    const { recorder, onWritten } = setup({ scan });

    const running = recorder.run(90);
    const shouldStop = scan.mock.calls[0][2];
    expect(shouldStop()).toBe(false);
    recorder.dispose();
    expect(shouldStop()).toBe(true);
    expect(recorder.isDisposed()).toBe(true);

    // Mesmo que a varredura ainda devolva dados, nada vai pro disco.
    pending.resolve(scanned(dayStat("2026-07-10", 1)));
    await running;
    expect(store.readAll()).toEqual([]);
    expect(onWritten).not.toHaveBeenCalled();

    await recorder.run(2); // descartado não varre mais
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("varredura interrompida (null) não grava", async () => {
    const { recorder, onWritten } = setup({ scan: async () => null });
    await recorder.run(90);
    expect(store.readAll()).toEqual([]);
    expect(onWritten).not.toHaveBeenCalled();
  });

  it("historyEnabled desligado: nem varre", async () => {
    const { recorder, scan } = setup({ isEnabled: () => false });
    await recorder.run(90);
    expect(scan).not.toHaveBeenCalled();
  });

  it("historyEnabled desligado DURANTE a varredura: não grava", async () => {
    let enabled = true;
    const pending = deferred<Scanned>();
    const { recorder } = setup({
      isEnabled: () => enabled,
      scan: () => pending.promise,
    });
    const running = recorder.run(90);
    enabled = false;
    pending.resolve(scanned(dayStat("2026-07-10", 1)));
    await running;
    expect(store.readAll()).toEqual([]);
  });

  it("varredura que rejeita não vaza a exceção nem trava a próxima", async () => {
    const scan = vi
      .fn<HistoryRecorderDeps["scan"]>()
      .mockRejectedValueOnce(new Error("disco sumiu"))
      .mockResolvedValue(scanned(dayStat("2026-07-10", 7)));
    const { recorder } = setup({ scan });
    await expect(recorder.run(90)).resolves.toBeUndefined();
    await recorder.run(2);
    expect(tokensByDate()).toEqual({ "2026-07-10": 7 });
  });
});
