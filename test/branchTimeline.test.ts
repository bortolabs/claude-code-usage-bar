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

/** Deixa a fila de git (assíncrona) esvaziar: o runner fake resolve na hora. */
const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

/** Runner fake: `/repo*` é repo com REFLOG; o resto não é repo. Conta as chamadas. */
function fakeGit(reflog = () => REFLOG) {
  const calls: { args: string[]; cwd: string }[] = [];
  const run: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd });
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return cwd.startsWith("/repo") ? "/repo\n" : null;
    }
    if (args[0] === "reflog") {
      return reflog();
    }
    return null;
  };
  return { run, calls };
}

describe("buildBranchResolver", () => {
  it("1ª consulta devolve null e carrega em 2º plano; depois resolve pelo timestamp", async () => {
    const { run, calls } = fakeGit();
    const resolve = buildBranchResolver(run);
    let updates = 0;
    resolve.onUpdate!(() => updates++);

    // Quem pergunta nunca espera o git.
    expect(resolve("/repo/src", 1500_000)).toBe(null);
    await settle();
    expect(updates).toBe(1);
    expect(resolve.version!()).toBe(1);

    expect(resolve("/repo/src", 1500_000)).toBe("feat/a");
    expect(resolve("/repo/src", 2500_000)).toBe("feat/b");
    expect(resolve("/repo/src", 700_000)).toBe("master");
    await settle();

    // Memoização: reflog lido UMA vez só (o repo é o mesmo).
    expect(calls.filter((c) => c.args[0] === "reflog").length).toBe(1);
  });

  it("consultas repetidas antes de o git responder viram um único git", async () => {
    const { run, calls } = fakeGit();
    const resolve = buildBranchResolver(run);
    for (let i = 0; i < 50; i++) {
      resolve("/repo/src", 1500_000);
    }
    await settle();
    expect(calls.filter((c) => c.args[1] === "--show-toplevel").length).toBe(1);
    expect(calls.filter((c) => c.args[0] === "reflog").length).toBe(1);
  });

  it("roda um git por vez (fila serial), mesmo com vários cwds", async () => {
    let running = 0;
    let peak = 0;
    const run: GitRunner = async (args, cwd) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 0));
      running--;
      return args[1] === "--show-toplevel" ? cwd + "\n" : REFLOG;
    };
    const resolve = buildBranchResolver(run);
    for (const cwd of ["/a", "/b", "/c", "/d"]) {
      resolve(cwd, 1500_000);
    }
    await settle();
    await settle();
    expect(peak).toBe(1);
    expect(resolve("/c", 1500_000)).toBe("feat/a");
  });

  it("cwd fora de repo git → null, sem avisar novidade", async () => {
    const { run } = fakeGit();
    const resolve = buildBranchResolver(run);
    let updates = 0;
    resolve.onUpdate!(() => updates++);
    expect(resolve("/qualquer/coisa", 1500_000)).toBe(null);
    expect(resolve(undefined, 1500_000)).toBe(null);
    await settle();
    expect(resolve("/qualquer/coisa", 1500_000)).toBe(null);
    expect(updates).toBe(0);
    expect(resolve.version!()).toBe(0);
  });

  it("repo sem checkouts no reflog → usa o branch atual (HEAD)", async () => {
    const run: GitRunner = async (args) => {
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
    resolve("/r2", 1234_000);
    await settle();
    expect(resolve("/r2", 1234_000)).toBe("main");
  });

  it("linha do tempo expira: relê o reflog servindo a antiga; só avisa se um checkout mudou algo", async () => {
    let reflog = REFLOG;
    const { run, calls } = fakeGit(() => reflog);
    let clock = 0;
    const resolve = buildBranchResolver(run, () => clock);
    resolve("/repo", 2500_000);
    await settle();
    expect(resolve.version!()).toBe(1);

    // Passou a validade, e só entrou commit no reflog: relê, mas não avisa.
    clock = 61_000;
    reflog = "HEAD@{3000}\tcommit: mais um\n" + REFLOG;
    expect(resolve("/repo", 2500_000)).toBe("feat/b"); // serve a antiga enquanto relê
    await settle();
    expect(calls.filter((c) => c.args[0] === "reflog").length).toBe(2);
    expect(resolve.version!()).toBe(1);

    // Um checkout novo muda a linha do tempo: agora avisa.
    clock = 122_000;
    reflog = "HEAD@{3000}\tcheckout: moving from feat/b to feat/c\n" + REFLOG;
    resolve("/repo", 3500_000);
    await settle();
    expect(resolve.version!()).toBe(2);
    expect(resolve("/repo", 3500_000)).toBe("feat/c");
  });

  it("'não é repo' expira e o git é perguntado de novo", async () => {
    const { run, calls } = fakeGit();
    let clock = 0;
    const resolve = buildBranchResolver(run, () => clock);
    resolve("/fora", 1);
    await settle();
    resolve("/fora", 1);
    await settle();
    expect(calls.length).toBe(1);
    clock = 11 * 60_000;
    resolve("/fora", 1);
    await settle();
    expect(calls.length).toBe(2);
  });
});
