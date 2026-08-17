import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isCheckDue,
  isNewer,
  parseLatestVersion,
  runUpdateCheck,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_LAST_CHECK_KEY,
  UPDATE_LAST_FAILED_KEY,
  UPDATE_NOTIFIED_KEY,
  UPDATE_OPT_OUT_KEY,
  UPDATE_RETRY_INTERVAL_MS,
  type UpdateCheckDeps,
  type UpdateNoticeChoice,
} from "../src/updateCheck";

describe("compareVersions", () => {
  it("compara major/minor/patch", () => {
    expect(compareVersions("0.41.0", "0.40.0")).toBeGreaterThan(0);
    expect(compareVersions("0.40.0", "0.41.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.40.1", "0.40.0")).toBeGreaterThan(0);
  });

  it("versões iguais → 0 (inclusive com prefixo 'v' e espaços)", () => {
    expect(compareVersions("0.40.0", "0.40.0")).toBe(0);
    expect(compareVersions("v0.40.0", " 0.40.0 ")).toBe(0);
  });

  it("segmentos faltando contam como zero", () => {
    expect(compareVersions("0.41", "0.41.0")).toBe(0);
    expect(compareVersions("1", "0.99.99")).toBeGreaterThan(0);
  });

  it("não compara por ordem de string (10 > 9)", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
});

describe("isNewer", () => {
  it("true só quando a publicada é maior", () => {
    expect(isNewer("0.41.0", "0.40.0")).toBe(true);
    expect(isNewer("0.40.0", "0.40.0")).toBe(false);
    expect(isNewer("0.39.0", "0.40.0")).toBe(false);
  });

  it("valores ausentes/vazios nunca disparam o aviso", () => {
    expect(isNewer(null, "0.40.0")).toBe(false);
    expect(isNewer("", "0.40.0")).toBe(false);
    expect(isNewer("0.41.0", "")).toBe(false);
  });
});

describe("parseLatestVersion", () => {
  it("lê `version` do payload do Open VSX", () => {
    // Recorte do corpo real de GET /api/bortolabs/claude-code-usage-bar/latest
    // (só os campos que importam aqui; o payload completo tem ~18 chaves).
    const body = JSON.stringify({
      namespace: "bortolabs",
      name: "claude-code-usage-bar",
      version: "0.41.1",
      versionAlias: ["latest"],
      preRelease: false,
      downloadCount: 1337,
    });
    expect(parseLatestVersion(body)).toBe("0.41.1");
  });

  it("nunca lança: formato ruim vira null", () => {
    expect(parseLatestVersion("<html>502 Bad Gateway</html>")).toBeNull();
    expect(parseLatestVersion("")).toBeNull();
    expect(parseLatestVersion("{}")).toBeNull();
    expect(parseLatestVersion("null")).toBeNull();
  });

  it("`version` não-string ou vazia vira null (não vira aviso bizarro)", () => {
    expect(parseLatestVersion(JSON.stringify({ version: 41 }))).toBeNull();
    expect(parseLatestVersion(JSON.stringify({ version: "" }))).toBeNull();
    expect(parseLatestVersion(JSON.stringify({ version: null }))).toBeNull();
    expect(parseLatestVersion(JSON.stringify({ version: ["0.41.1"] }))).toBeNull();
  });
});

const NOW = 1_700_000_000_000;

describe("isCheckDue", () => {
  it("primeira vez (sem carimbo) sempre checa", () => {
    expect(isCheckDue(undefined, false, NOW)).toBe(true);
  });

  it("checagem que deu certo segura por 24h", () => {
    expect(isCheckDue(NOW - UPDATE_CHECK_INTERVAL_MS + 1, false, NOW)).toBe(false);
    expect(isCheckDue(NOW - UPDATE_CHECK_INTERVAL_MS, false, NOW)).toBe(true);
  });

  it("checagem que FALHOU segura só 1h — offline não custa o dia inteiro", () => {
    const meiaHora = NOW - 30 * 60 * 1000;
    expect(isCheckDue(meiaHora, true, NOW)).toBe(false);
    expect(isCheckDue(NOW - UPDATE_RETRY_INTERVAL_MS, true, NOW)).toBe(true);
    // O mesmo carimbo, se a checagem tivesse dado certo, ainda estaria segurando.
    expect(isCheckDue(NOW - UPDATE_RETRY_INTERVAL_MS, false, NOW)).toBe(false);
  });

  it("relógio andando pra trás não trava a checagem para sempre", () => {
    expect(isCheckDue(NOW + 10 * UPDATE_CHECK_INTERVAL_MS, false, NOW)).toBe(true);
  });
});

/** Monta as deps com um `globalState` de mentira, expondo o que foi gravado. */
function makeDeps(opts: {
  state?: Record<string, unknown>;
  latest?: string | null;
  choice?: UpdateNoticeChoice;
  now?: number;
}) {
  const state: Record<string, unknown> = { ...(opts.state ?? {}) };
  const calls = { fetch: 0, notice: 0, openReleases: 0 };
  const deps: UpdateCheckDeps = {
    now: () => opts.now ?? NOW,
    getState: <T,>(key: string) => state[key] as T | undefined,
    setState: async (key, value) => {
      state[key] = value;
    },
    fetchLatest: async () => {
      calls.fetch++;
      return opts.latest ?? null;
    },
    showNotice: async () => {
      calls.notice++;
      return opts.choice ?? "dismissed";
    },
    openReleases: () => {
      calls.openReleases++;
    },
  };
  return { deps, state, calls };
}

describe("runUpdateCheck", () => {
  it("avisa quando o Open VSX tem versão maior", async () => {
    const { deps, calls } = makeDeps({ latest: "0.41.2", choice: "release" });
    expect(await runUpdateCheck("0.41.1", deps)).toBe("notified-release");
    expect(calls.notice).toBe(1);
    expect(calls.openReleases).toBe(1);
  });

  it("nada a fazer quando já se está na última", async () => {
    const { deps, calls } = makeDeps({ latest: "0.41.1" });
    expect(await runUpdateCheck("0.41.1", deps)).toBe("up-to-date");
    expect(calls.notice).toBe(0);
  });

  it("opt-out não checa nem rede", async () => {
    const { deps, calls } = makeDeps({
      state: { [UPDATE_OPT_OUT_KEY]: true },
      latest: "0.41.2",
    });
    expect(await runUpdateCheck("0.41.1", deps)).toBe("opt-out");
    expect(calls.fetch).toBe(0);
  });

  // ── As duas regressões que motivaram esta refatoração ────────────────────────

  it("REGRESSÃO: aviso fechado sem escolher NÃO marca a versão como avisada", async () => {
    // Era o bug: `updateNotifiedVersion` gravado antes de mostrar o toast. Um aviso
    // perdido (reload, usuário em outro app) queimava a única chance por versão.
    const { deps, state, calls } = makeDeps({ latest: "0.41.2", choice: "dismissed" });
    expect(await runUpdateCheck("0.41.1", deps)).toBe("notified-dismissed");
    expect(calls.notice).toBe(1);
    expect(state[UPDATE_NOTIFIED_KEY]).toBeUndefined();

    // …e por isso ele volta na próxima checagem, em vez de sumir para sempre.
    const segunda = makeDeps({
      state,
      latest: "0.41.2",
      choice: "release",
      now: NOW + UPDATE_CHECK_INTERVAL_MS,
    });
    expect(await runUpdateCheck("0.41.1", segunda.deps)).toBe("notified-release");
    expect(segunda.calls.notice).toBe(1);
  });

  it("respondeu (release ou nunca mais) marca a versão e não repete o aviso", async () => {
    for (const choice of ["release", "never"] as const) {
      const { deps, state } = makeDeps({ latest: "0.41.2", choice });
      await runUpdateCheck("0.41.1", deps);
      expect(state[UPDATE_NOTIFIED_KEY]).toBe("0.41.2");

      const segunda = makeDeps({
        state,
        latest: "0.41.2",
        now: NOW + UPDATE_CHECK_INTERVAL_MS,
      });
      const esperado = choice === "never" ? "opt-out" : "already-notified";
      expect(await runUpdateCheck("0.41.1", segunda.deps)).toBe(esperado);
      expect(segunda.calls.notice).toBe(0);
    }
  });

  it("REGRESSÃO: fetch que falhou não consome a janela de 24h", async () => {
    // Era o bug: `updateLastCheckMs` carimbado antes do fetch. Estar offline naquele
    // segundo significava só tentar de novo no dia seguinte.
    const { deps, state } = makeDeps({ latest: null });
    expect(await runUpdateCheck("0.41.1", deps)).toBe("fetch-failed");
    expect(state[UPDATE_LAST_FAILED_KEY]).toBe(true);

    // 1h depois já tenta de novo — e agora a rede voltou.
    const comRede = makeDeps({
      state,
      latest: "0.41.2",
      choice: "release",
      now: NOW + UPDATE_RETRY_INTERVAL_MS,
    });
    expect(await runUpdateCheck("0.41.1", comRede.deps)).toBe("notified-release");
    expect(comRede.state[UPDATE_LAST_FAILED_KEY]).toBe(false);
  });

  // ── Checagem pedida na mão (comando da paleta) ──────────────────────────────

  it("force fura as três guardas da checagem automática", async () => {
    // Cenário do usuário que já viu (e perdeu) o aviso, disse "não avisar mais" e
    // acabou de checar: pela via automática nada aconteceria.
    const state = {
      [UPDATE_LAST_CHECK_KEY]: NOW,
      [UPDATE_OPT_OUT_KEY]: true,
      [UPDATE_NOTIFIED_KEY]: "0.41.2",
    };
    const auto = makeDeps({ state, latest: "0.41.2" });
    expect(await runUpdateCheck("0.41.1", auto.deps)).toBe("opt-out");
    expect(auto.calls.notice).toBe(0);

    const manual = makeDeps({ state, latest: "0.41.2", choice: "release" });
    expect(await runUpdateCheck("0.41.1", manual.deps, { force: true })).toBe(
      "notified-release"
    );
    expect(manual.calls.notice).toBe(1);
  });

  it("force não muda a regra de gravação: fechar sem escolher não marca", async () => {
    const { deps, state } = makeDeps({ latest: "0.41.2", choice: "dismissed" });
    await runUpdateCheck("0.41.1", deps, { force: true });
    expect(state[UPDATE_NOTIFIED_KEY]).toBeUndefined();
  });

  it("force ainda distingue 'já está na última' de 'não consegui verificar'", async () => {
    // O comando precisa dos dois desfechos separados: eles viram mensagens diferentes.
    const igual = makeDeps({ latest: "0.41.1" });
    expect(await runUpdateCheck("0.41.1", igual.deps, { force: true })).toBe("up-to-date");
    const offline = makeDeps({ latest: null });
    expect(await runUpdateCheck("0.41.1", offline.deps, { force: true })).toBe(
      "fetch-failed"
    );
  });

  it("checagem bem-sucedida segura as próximas 24h (não martela o Open VSX)", async () => {
    const { deps, state } = makeDeps({ latest: "0.41.1" });
    await runUpdateCheck("0.41.1", deps);
    expect(state[UPDATE_LAST_CHECK_KEY]).toBe(NOW);

    const logoDepois = makeDeps({ state, latest: "0.41.1", now: NOW + 60_000 });
    expect(await runUpdateCheck("0.41.1", logoDepois.deps)).toBe("not-due");
    expect(logoDepois.calls.fetch).toBe(0);
  });
});
