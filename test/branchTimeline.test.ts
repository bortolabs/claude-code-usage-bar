import { describe, expect, it } from "vitest";
import {
  parseCheckouts,
  buildIntervals,
  branchAt,
  buildBranchResolver,
  GitRunner,
} from "../src/branchTimeline";

// reflog vem do mais novo p/ o mais antigo; formato '%gd\t%gs' com --date=unix.
const REFLOG = [
  "HEAD@{2000}\tcheckout: moving from feat/a to feat/b",
  "HEAD@{1500}\tcommit: trabalho no meio",
  "HEAD@{1000}\tcheckout: moving from master to feat/a",
  "HEAD@{500}\tcommit: inicial",
].join("\n");

describe("parseCheckouts", () => {
  it("extrai só os checkouts, em ordem cronológica asc, ignorando commits", () => {
    const c = parseCheckouts(REFLOG);
    expect(c).toEqual([
      { ts: 1000_000, from: "master", to: "feat/a" },
      { ts: 2000_000, from: "feat/a", to: "feat/b" },
    ]);
  });

  it("ignora linhas fora do formato e vazias", () => {
    expect(parseCheckouts("lixo\n\nHEAD@{x}\tcheckout: moving from a to b")).toEqual([]);
  });
});

describe("buildIntervals + branchAt", () => {
  const intervals = buildIntervals(parseCheckouts(REFLOG), null);

  it("antes do 1º checkout → branch de origem (from)", () => {
    expect(branchAt(intervals, 500_000)).toBe("master");
  });
  it("no instante exato do checkout já conta o novo branch", () => {
    expect(branchAt(intervals, 1000_000)).toBe("feat/a");
  });
  it("entre checkouts → branch do intervalo", () => {
    expect(branchAt(intervals, 1500_000)).toBe("feat/a");
  });
  it("após o último checkout → branch final, até o infinito", () => {
    expect(branchAt(intervals, 2000_000)).toBe("feat/b");
    expect(branchAt(intervals, 9_999_999_000)).toBe("feat/b");
  });

  it("sem checkouts + branch atual → um único intervalo cobrindo tudo", () => {
    const iv = buildIntervals([], "main");
    expect(branchAt(iv, 0)).toBe("main");
    expect(branchAt(iv, 5_000_000)).toBe("main");
  });
  it("sem checkouts + sem branch atual → nada", () => {
    expect(buildIntervals([], null)).toEqual([]);
  });

  it("alvo de checkout que é SHA cru (detached) vira '(detached)'", () => {
    const iv = buildIntervals(
      parseCheckouts("HEAD@{1000}\tcheckout: moving from main to 9f8e7d6c5b4a3210"),
      null
    );
    expect(branchAt(iv, 2000_000)).toBe("(detached)");
  });
});

describe("buildBranchResolver", () => {
  it("resolve o branch pelo timestamp, memoizando git por repo", () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const run: GitRunner = (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return cwd.startsWith("/repo") ? "/repo\n" : null;
      }
      if (args[0] === "reflog") {
        return REFLOG;
      }
      return null;
    };
    const resolve = buildBranchResolver(run);

    expect(resolve("/repo/src", 1500_000)).toBe("feat/a");
    expect(resolve("/repo/src", 2500_000)).toBe("feat/b");
    expect(resolve("/repo/src", 700_000)).toBe("master");

    // Memoização: reflog lido UMA vez só (o repo é o mesmo).
    const reflogCalls = calls.filter((c) => c.args[0] === "reflog").length;
    expect(reflogCalls).toBe(1);
  });

  it("cwd fora de repo git → null (sem atribuição)", () => {
    const run: GitRunner = () => null;
    const resolve = buildBranchResolver(run);
    expect(resolve("/qualquer/coisa", 1500_000)).toBe(null);
    expect(resolve(undefined, 1500_000)).toBe(null);
  });

  it("repo sem checkouts no reflog → usa o branch atual (HEAD)", () => {
    const run: GitRunner = (args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return "/r2\n";
      }
      if (args[0] === "reflog") {
        return "HEAD@{1000}\tcommit: só commits, nenhum checkout";
      }
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return "main\n";
      }
      return null;
    };
    const resolve = buildBranchResolver(run);
    expect(resolve("/r2", 1234_000)).toBe("main");
  });
});
