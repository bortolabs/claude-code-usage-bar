import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as realOs from "os";
import * as path from "path";

/**
 * Fixtures em disco: monta um "home" temporário com
 * `<home>/.claude/projects/<proj>/<sessão>.jsonl` e aponta os.homedir() pra lá.
 * Cada teste usa um tmpdir próprio → a assinatura de cache nunca colide.
 * (vi.mock em vez de spyOn: módulos builtin não são reconfiguráveis em ESM.)
 */
let home: string;

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const patched = { ...actual, homedir: () => home };
  return { ...patched, default: patched };
});

import { readTranscriptStats } from "../src/transcriptStats";

const line = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";

/** Turno de assistant com usage (formato real do transcript do Claude Code). */
const turn = (over: {
  ts: string;
  model?: string;
  cwd?: string;
  isSidechain?: boolean;
  usage?: Record<string, number>;
  content?: unknown[];
}) =>
  line({
    timestamp: over.ts,
    cwd: over.cwd ?? "/Users/me/meu-projeto",
    isSidechain: over.isSidechain ?? false,
    message: {
      model: over.model ?? "claude-opus-4-8",
      usage: over.usage ?? {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 300,
      },
      content: over.content ?? [],
    },
  });

function writeSession(proj: string, session: string, content: string) {
  const dir = path.join(home, ".claude", "projects", proj);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, session + ".jsonl"), content);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(realOs.tmpdir(), "usage-bar-test-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const T0 = Date.parse("2026-07-01T10:00:00.000Z");
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60000).toISOString();
// Janela ampla cobrindo os fixtures. mtime dos arquivos é "agora" (recém-escritos),
// então nenhum é pulado pela otimização de mtime.
const WIN_START = T0 - 3600_000;
const WIN_END = T0 + 3600_000;

describe("readTranscriptStats", () => {
  it("sem diretório de transcripts → stats vazias, sem lançar", () => {
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.totalTokens).toBe(0);
    expect(s.turns).toBe(0);
  });

  it("agrega tokens/custo por modelo, projeto, dia e sessão", () => {
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-a",
      turn({ ts: iso(0) }) + turn({ ts: iso(5), model: "claude-sonnet-5" })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.turns).toBe(2);
    // 1000 in + 500 out + 2000 cache-read + 300 cache-write = 3800 por turno.
    expect(s.totalTokens).toBe(7600);
    expect(s.byModel.map((m) => m.model).sort()).toEqual([
      "Opus 4.8",
      "Sonnet",
    ]);
    expect(s.byProject).toHaveLength(1);
    expect(s.byProject[0].project).toBe("meu-projeto");
    expect(s.bySession[0].messages).toBe(2);
    expect(s.byDay).toHaveLength(1);
    expect(s.tokenTotals).toEqual({
      input: 2000,
      output: 1000,
      cacheRead: 4000,
      cacheWrite: 600,
    });
  });

  it("turnos fora da janela e modelo <synthetic> ficam de fora", () => {
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-b",
      turn({ ts: iso(0) }) +
        turn({ ts: new Date(WIN_END + 3600_000).toISOString() }) + // futuro
        turn({ ts: iso(1), model: "<synthetic>" })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.turns).toBe(1);
  });

  it("sidechain vai pro projeto sintético 'subagentes'", () => {
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-c",
      turn({ ts: iso(0) }) + turn({ ts: iso(1), isSidechain: true })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    const projs = s.byProject.map((p) => p.project).sort();
    expect(projs).toEqual(["meu-projeto", "subagentes"]);
  });

  it("conta MCP, subagentes, skills e plugins a partir dos tool_use", () => {
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-d",
      turn({
        ts: iso(0),
        content: [
          { type: "tool_use", name: "mcp__supabase__execute_sql", input: {} },
          { type: "tool_use", name: "mcp__supabase__list_tables", input: {} },
          { type: "tool_use", name: "Task", input: { subagent_type: "Explore" } },
          { type: "tool_use", name: "Skill", input: { skill: "commit-commands:commit" } },
          { type: "tool_use", name: "Skill", input: { skill: "verify" } },
        ],
      })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.byMcpServer).toEqual([{ name: "supabase", calls: 2 }]);
    expect(s.bySubagent).toEqual([{ name: "Explore", calls: 1 }]);
    expect(s.bySkill.map((x) => x.name).sort()).toEqual([
      "commit-commands:commit",
      "verify",
    ]);
    // plugin de 'plugin:skill' + '(built-in)' pra skill sem namespace.
    expect(s.byPlugin.map((x) => x.name).sort()).toEqual([
      "(built-in)",
      "commit-commands",
    ]);
  });

  it("subagents/agent-*.jsonl rola pra sessão-mãe", () => {
    const dir = path.join(
      home, ".claude", "projects", "-Users-me-meu-projeto",
      "sessao-e", "subagents"
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "agent-1.jsonl"),
      turn({ ts: iso(0), isSidechain: true })
    );
    writeSession("-Users-me-meu-projeto", "sessao-e", turn({ ts: iso(1) }));
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.bySession).toHaveLength(1);
    expect(s.bySession[0].session).toBe("sessao-e");
    expect(s.bySession[0].messages).toBe(2);
  });

  it("linhas corrompidas não derrubam a agregação", () => {
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-f",
      '{"quebrado": "usage" \n' + turn({ ts: iso(0) })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.turns).toBe(1);
  });

  // Contexto (input+cache_read) acima de 200k conta como turno "inflado".
  const bigCtx = { input_tokens: 250_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  it("ctxInflatedTurns conta só os turnos com contexto > 200k", () => {
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-ctx",
      turn({ ts: iso(0), usage: bigCtx }) +
        turn({ ts: iso(1), usage: bigCtx }) +
        turn({ ts: iso(2) }) // normal (~3k de contexto)
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.ctxInflatedTurns).toBe(2);
  });

  it("maxToolRunLength: chamadas IDÊNTICAS seguidas contam como run", () => {
    const bash = { type: "tool_use", name: "Bash", input: { command: "ls" } };
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-loop",
      turn({ ts: iso(0), content: [bash, bash, bash, bash, bash] })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.maxToolRunLength).toBe(5);
    expect(s.toolLoopName).toBe("Bash");
  });

  it("chamadas da MESMA tool com input diferente NÃO viram run (sem falso positivo)", () => {
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-parallel",
      turn({
        ts: iso(0),
        content: [
          { type: "tool_use", name: "Read", input: { file: "a.ts" } },
          { type: "tool_use", name: "Read", input: { file: "b.ts" } },
          { type: "tool_use", name: "Read", input: { file: "c.ts" } },
        ],
      })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.maxToolRunLength).toBe(1);
  });

  it("o run NÃO atravessa turnos (é por turno)", () => {
    const bash = { type: "tool_use", name: "Bash", input: { command: "ls" } };
    writeSession(
      "-Users-me-meu-projeto",
      "sessao-cross",
      turn({ ts: iso(0), content: [bash] }) + turn({ ts: iso(1), content: [bash] })
    );
    const s = readTranscriptStats(WIN_START, WIN_END);
    expect(s.maxToolRunLength).toBe(1);
  });
});
