import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as realOs from "os";
import * as path from "path";

/** Home temporário por teste (mesmo padrão de transcriptStats.test.ts). */
let home: string;

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const patched = { ...actual, homedir: () => home };
  return { ...patched, default: patched };
});

import { contextFromUsage, projectSlug, readCurrentTurn } from "../src/transcript";

const turnLine = (o: {
  cwd: string;
  model?: string;
  tokens?: number;
  isSidechain?: boolean;
}) =>
  JSON.stringify({
    cwd: o.cwd,
    isSidechain: o.isSidechain ?? false,
    message: {
      model: o.model ?? "claude-opus-4-8",
      usage: { input_tokens: o.tokens ?? 100_000 },
    },
  }) + "\n";

/** Grava uma sessão no projeto do `cwd` e fixa o mtime (ordena os candidatos). */
function writeProject(cwd: string, session: string, content: string, mtimeSec: number) {
  const dir = path.join(home, ".claude", "projects", projectSlug(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, session + ".jsonl");
  fs.writeFileSync(file, content);
  fs.utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

const PROJ_A = "/Users/me/projeto-a";
const PROJ_B = "/Users/me/projeto-b";

describe("contextFromUsage", () => {
  it("soma input + cache_read + cache_creation; janela 1M p/ Opus", () => {
    const r = contextFromUsage(
      {
        input_tokens: 1_000,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 41_500,
      },
      "claude-opus-4-8",
    );
    expect(r.tokens).toBe(142_500);
    expect(r.window).toBe(1_000_000);
    expect(r.pct).toBeCloseTo(14.25, 5);
  });

  it("janela 200k p/ Haiku", () => {
    const r = contextFromUsage({ input_tokens: 50_000 }, "claude-haiku-4-5");
    expect(r.window).toBe(200_000);
    expect(r.pct).toBeCloseTo(25, 5);
  });

  it("clampa em 100% quando o usado passa da janela", () => {
    const r = contextFromUsage(
      { input_tokens: 250_000 },
      "claude-haiku-4-5",
    );
    expect(r.tokens).toBe(250_000);
    expect(r.pct).toBe(100);
  });

  it("usage vazio/ausente → 0 tokens (UI esconde o card)", () => {
    expect(contextFromUsage({}, "claude-opus-4-8").tokens).toBe(0);
    expect(contextFromUsage(null, "claude-opus-4-8").tokens).toBe(0);
    expect(contextFromUsage(undefined, null).pct).toBe(0);
  });

  it("modelo desconhecido cai na janela padrão (1M)", () => {
    const r = contextFromUsage({ input_tokens: 10_000 }, null);
    expect(r.window).toBe(1_000_000);
  });
});

describe("projectSlug", () => {
  it("troca cada caractere não alfanumérico por '-'", () => {
    expect(projectSlug("/Users/me/meu-app")).toBe("-Users-me-meu-app");
    expect(projectSlug("/Users/me/Claude Code/app")).toBe("-Users-me-Claude-Code-app");
    expect(projectSlug("/Users/me/my.app")).toBe("-Users-me-my-app");
  });
});

describe("readCurrentTurn — escopo por projeto", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(realOs.tmpdir(), "usage-bar-ctx-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("com 2 projetos, devolve o do WORKSPACE — não o globalmente mais recente", () => {
    writeProject(PROJ_A, "sa", turnLine({ cwd: PROJ_A, tokens: 111_000 }), 1000);
    // Projeto B é o mais recente da máquina (era o que vazava pra todas as janelas).
    writeProject(PROJ_B, "sb", turnLine({ cwd: PROJ_B, tokens: 999_000 }), 2000);

    const a = readCurrentTurn([PROJ_A]);
    expect(a.scoped).toBe(true);
    expect(a.contextTokens).toBe(111_000);

    const b = readCurrentTurn([PROJ_B]);
    expect(b.contextTokens).toBe(999_000);
  });

  it("projeto sem transcript → tudo null e scoped=true (card some)", () => {
    writeProject(PROJ_B, "sb", turnLine({ cwd: PROJ_B }), 2000);
    const r = readCurrentTurn([PROJ_A]);
    expect(r.scoped).toBe(true);
    expect(r.model).toBeNull();
    expect(r.contextTokens).toBeNull();
    expect(r.contextPct).toBeNull();
  });

  it("sem workspacePaths → global mais recente, como antes (scoped=false)", () => {
    writeProject(PROJ_A, "sa", turnLine({ cwd: PROJ_A, tokens: 111_000 }), 1000);
    writeProject(PROJ_B, "sb", turnLine({ cwd: PROJ_B, tokens: 999_000 }), 2000);
    for (const arg of [undefined, [] as string[]]) {
      const r = readCurrentTurn(arg);
      expect(r.scoped).toBe(false);
      expect(r.contextTokens).toBe(999_000);
    }
  });

  it("multi-root: pega a sessão mais recente entre as pastas do workspace", () => {
    writeProject(PROJ_A, "sa", turnLine({ cwd: PROJ_A, tokens: 111_000 }), 1000);
    writeProject(PROJ_B, "sb", turnLine({ cwd: PROJ_B, tokens: 222_000 }), 2000);
    const r = readCurrentTurn([PROJ_A, PROJ_B]);
    expect(r.contextTokens).toBe(222_000);
  });

  it("colisão de slug: cwd de dentro não casa → não usa aquele transcript", () => {
    // "/Users/me/my.app" e "/Users/me/my-app" geram o MESMO slug.
    writeProject("/Users/me/my.app", "s1", turnLine({ cwd: "/Users/me/my.app" }), 1000);
    const r = readCurrentTurn(["/Users/me/my-app"]);
    expect(r.scoped).toBe(true);
    expect(r.contextTokens).toBeNull();
  });

  it("dentro do projeto, ignora sidechain e pega a sessão mais recente", () => {
    writeProject(PROJ_A, "velha", turnLine({ cwd: PROJ_A, tokens: 50_000 }), 1000);
    writeProject(
      PROJ_A,
      "nova",
      turnLine({ cwd: PROJ_A, tokens: 900_000, isSidechain: true }) +
        turnLine({ cwd: PROJ_A, tokens: 300_000 }),
      2000
    );
    const r = readCurrentTurn([PROJ_A]);
    expect(r.contextTokens).toBe(300_000);
  });
});
