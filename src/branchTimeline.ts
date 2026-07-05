import * as fs from "fs";
import { execFileSync } from "child_process";

/**
 * Atribuição de custo POR BRANCH (≈ aproximada).
 *
 * O Claude Code não grava em que branch você estava a cada turno. Reconstruímos
 * isso cruzando o TIMESTAMP de cada turno do transcript com o histórico de
 * checkouts do git (`git reflog`), que registra cada troca de branch com a hora.
 *
 * Tudo local, sem rede. É "≈ aproximado" porque: o reflog expira (~90 dias) e é
 * por-repo; e se você tem duas janelas do Claude Code em branches diferentes ao
 * mesmo tempo, a atribuição por hora não distingue as duas. Bom o bastante pra
 * "quanto custou cada feature/PR" — rotulado como aproximação na UI.
 */

/** Intervalo em que um branch esteve ativo (HEAD apontava pra ele). */
export interface BranchInterval {
  start: number; // epoch ms, inclusivo
  end: number; // epoch ms, exclusivo (Infinity p/ o último)
  branch: string;
}

/** Resolve (cwd, timestamp) → nome do branch ativo naquele instante, ou null. */
export type BranchResolver = (cwd: string | undefined, ts: number) => string | null;

/** Runner de git injetável (facilita teste). Retorna stdout ou null em erro. */
export type GitRunner = (args: string[], cwd: string) => string | null;

/** SHA cru (detached HEAD) — não é um nome de branch de verdade. */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/** Normaliza o alvo de um checkout: SHA cru (detached) vira rótulo legível. */
function labelBranch(name: string): string {
  return SHA_RE.test(name) ? "(detached)" : name;
}

/**
 * Parseia `git reflog --date=unix --format='%gd%x09%gs'` e devolve os eventos de
 * checkout (troca de branch) em ordem CRONOLÓGICA ascendente. Cada linha vem como
 * `HEAD@{<unix-seconds>}\t<subject>`; só interessam os `checkout: moving from A to B`.
 */
export function parseCheckouts(
  reflogText: string
): { ts: number; from: string; to: string }[] {
  const out: { ts: number; from: string; to: string }[] = [];
  for (const raw of reflogText.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) {
      continue;
    }
    const m = /^HEAD@\{(\d+)\}\t(.*)$/.exec(line);
    if (!m) {
      continue;
    }
    const c = /^checkout: moving from (.+) to (.+)$/.exec(m[2]);
    if (!c) {
      continue;
    }
    out.push({ ts: Number(m[1]) * 1000, from: c[1], to: c[2] });
  }
  // reflog vem do mais novo p/ o mais antigo → ordena cronológico asc.
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/**
 * Constrói a linha do tempo de branches a partir dos checkouts e do branch atual
 * (fallback quando o reflog não tem nenhum checkout). Antes do 1º checkout, HEAD
 * estava no `from` dele; depois de cada checkout, no `to`.
 */
export function buildIntervals(
  checkouts: { ts: number; from: string; to: string }[],
  currentBranch: string | null
): BranchInterval[] {
  if (!checkouts.length) {
    return currentBranch
      ? [{ start: 0, end: Infinity, branch: labelBranch(currentBranch) }]
      : [];
  }
  const intervals: BranchInterval[] = [
    { start: 0, end: checkouts[0].ts, branch: labelBranch(checkouts[0].from) },
  ];
  for (let i = 0; i < checkouts.length; i++) {
    const end = i + 1 < checkouts.length ? checkouts[i + 1].ts : Infinity;
    intervals.push({ start: checkouts[i].ts, end, branch: labelBranch(checkouts[i].to) });
  }
  return intervals;
}

/** Branch ativo em `ts` segundo a linha do tempo (ou null se fora de tudo). */
export function branchAt(intervals: BranchInterval[], ts: number): string | null {
  for (const iv of intervals) {
    if (ts >= iv.start && ts < iv.end) {
      return iv.branch;
    }
  }
  return null;
}

/** Runner real: roda `git` no cwd. Guarda contra cwd inexistente (não spawna). */
function realGit(args: string[], cwd: string): string | null {
  try {
    if (!fs.existsSync(cwd)) {
      return null;
    }
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Cria um resolvedor `(cwd, ts) → branch`. Resolve o repo (git toplevel) e lê o
 * reflog UMA vez por repo, memoizando — as chamadas de git são preguiçosas (só na
 * 1ª vez que um cwd/repo é visto). `run` é injetável para teste.
 */
export function buildBranchResolver(run: GitRunner = realGit): BranchResolver {
  const cwdToRoot = new Map<string, string | null>();
  const rootToIntervals = new Map<string, BranchInterval[]>();

  const rootFor = (cwd: string): string | null => {
    if (cwdToRoot.has(cwd)) {
      return cwdToRoot.get(cwd) ?? null;
    }
    const out = run(["rev-parse", "--show-toplevel"], cwd);
    const root = out ? out.trim() || null : null;
    cwdToRoot.set(cwd, root);
    return root;
  };

  const intervalsFor = (root: string): BranchInterval[] => {
    const cached = rootToIntervals.get(root);
    if (cached) {
      return cached;
    }
    const reflog = run(["reflog", "--date=unix", "--format=%gd%x09%gs"], root);
    const checkouts = reflog ? parseCheckouts(reflog) : [];
    let current: string | null = null;
    if (!checkouts.length) {
      const head = run(["rev-parse", "--abbrev-ref", "HEAD"], root);
      current = head ? head.trim() : null;
      // "HEAD" = detached sem histórico de checkout → sem atribuição confiável.
      if (current === "HEAD" || current === "") {
        current = null;
      }
    }
    const intervals = buildIntervals(checkouts, current);
    rootToIntervals.set(root, intervals);
    return intervals;
  };

  return (cwd, ts) => {
    if (!cwd || typeof cwd !== "string") {
      return null;
    }
    const root = rootFor(cwd);
    if (!root) {
      return null;
    }
    return branchAt(intervalsFor(root), ts);
  };
}
