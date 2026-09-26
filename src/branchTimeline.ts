import * as fs from "fs";
import { execFile } from "child_process";

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

/**
 * Resolve (cwd, timestamp) → nome do branch ativo naquele instante, ou null.
 * Síncrono de propósito (roda por turno dentro da agregação); o resolver real
 * responde do cache e carrega o git em segundo plano — `version` muda e `onUpdate`
 * avisa quando um carregamento trouxe novidade, para quem agregou refazer a conta.
 */
export type BranchResolver = ((cwd: string | undefined, ts: number) => string | null) & {
  version?: () => number;
  onUpdate?: (cb: () => void) => () => void;
};

/** Runner de git injetável (facilita teste). Resolve com o stdout, ou null em erro. */
export type GitRunner = (args: string[], cwd: string) => Promise<string | null>;

/** Por quanto tempo "este cwd não é repo" vale antes de perguntar ao git de novo. */
const NO_REPO_TTL_MS = 10 * 60_000;
/** Por quanto tempo a linha do tempo de um repo vale antes de reler o reflog. */
const INTERVALS_TTL_MS = 60_000;

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

/**
 * Runner real: roda `git` no cwd, FORA da thread do extension host (`execFile`
 * assíncrono — o `execFileSync` antigo travava o host a cada cwd). Guarda contra
 * cwd inexistente (não spawna).
 */
function realGit(args: string[], cwd: string): Promise<string | null> {
  return fs.promises.access(cwd).then(
    () =>
      new Promise<string | null>((resolve) => {
        try {
          const child = execFile(
            "git",
            args,
            { cwd, encoding: "utf8", timeout: 3000, maxBuffer: 16 * 1024 * 1024 },
            (err, stdout) => resolve(err ? null : stdout)
          );
          child.stdin?.end();
        } catch {
          resolve(null);
        }
      }),
    () => null
  );
}

/**
 * Cria um resolvedor `(cwd, ts) → branch`. Resolve o repo (git toplevel) e lê o
 * reflog, memoizando por cwd/repo. Quem pergunta nunca espera: cache hit responde
 * na hora; miss enfileira o git e devolve null (o turno fica sem branch nesta
 * passada). A fila roda um git por vez; quando esvazia com novidade, `version`
 * sobe e os `onUpdate` são avisados uma vez só pelo lote.
 *
 * Validade: repo achado é permanente; "não é repo" expira em `NO_REPO_TTL_MS`; a
 * linha do tempo expira em `INTERVALS_TTL_MS` e é relida em segundo plano servindo
 * a antiga — sem isso, um resolver que vive a sessão inteira não veria checkout novo.
 * `run` e `now` são injetáveis para teste.
 */
export function buildBranchResolver(
  run: GitRunner = realGit,
  now: () => number = Date.now
): BranchResolver {
  const cwdToRoot = new Map<string, { root: string | null; at: number }>();
  const rootToIntervals = new Map<string, { intervals: BranchInterval[]; sig: string; at: number }>();
  const inFlight = new Set<string>();
  const queue: (() => Promise<void>)[] = [];
  const listeners = new Set<() => void>();
  let version = 0;
  let changed = false;
  let draining = false;

  const drain = async () => {
    draining = true;
    while (queue.length) {
      await queue.shift()!();
    }
    draining = false;
    if (changed) {
      changed = false;
      version++;
      for (const cb of Array.from(listeners)) {
        try {
          cb();
        } catch {
          // ouvinte com defeito não derruba a fila
        }
      }
    }
  };

  const enqueue = (key: string, job: () => Promise<void>) => {
    if (inFlight.has(key)) {
      return;
    }
    inFlight.add(key);
    queue.push(async () => {
      try {
        await job();
      } catch {
        // git falhou: fica o que já havia no cache
      } finally {
        inFlight.delete(key);
      }
    });
    if (!draining) {
      void drain();
    }
  };

  const loadIntervals = async (root: string) => {
    const reflog = await run(["reflog", "--date=unix", "--format=%gd%x09%gs"], root);
    const checkouts = reflog ? parseCheckouts(reflog) : [];
    let current: string | null = null;
    if (!checkouts.length) {
      const head = await run(["rev-parse", "--abbrev-ref", "HEAD"], root);
      current = head ? head.trim() : null;
      // "HEAD" = detached sem histórico de checkout → sem atribuição confiável.
      if (current === "HEAD" || current === "") {
        current = null;
      }
    }
    const intervals = buildIntervals(checkouts, current);
    // Commit também escreve no reflog; só checkout muda a linha do tempo.
    const sig = JSON.stringify(intervals);
    const prev = rootToIntervals.get(root);
    rootToIntervals.set(root, { intervals, sig, at: now() });
    if (!prev || prev.sig !== sig) {
      changed = true;
    }
  };

  const loadRoot = async (cwd: string) => {
    const out = await run(["rev-parse", "--show-toplevel"], cwd);
    const root = out ? out.trim() || null : null;
    cwdToRoot.set(cwd, { root, at: now() });
    if (root && !rootToIntervals.has(root)) {
      enqueue("root:" + root, () => loadIntervals(root));
    }
  };

  const resolve: BranchResolver = (cwd, ts) => {
    if (!cwd || typeof cwd !== "string") {
      return null;
    }
    const r = cwdToRoot.get(cwd);
    if (!r || (r.root === null && now() - r.at > NO_REPO_TTL_MS)) {
      enqueue("cwd:" + cwd, () => loadRoot(cwd));
    }
    const root = r?.root;
    if (!root) {
      return null;
    }
    const iv = rootToIntervals.get(root);
    if (!iv || now() - iv.at > INTERVALS_TTL_MS) {
      enqueue("root:" + root, () => loadIntervals(root));
    }
    return iv ? branchAt(iv.intervals, ts) : null;
  };
  resolve.version = () => version;
  resolve.onUpdate = (cb) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  return resolve;
}

let shared: BranchResolver | null = null;

/**
 * Resolver único do processo, com o git real. Vive a sessão inteira para a
 * memoização valer entre refreshes — antes cada agregação criava um novo e
 * repetia todos os `git` de todos os cwds.
 */
export function sharedBranchResolver(): BranchResolver {
  if (!shared) {
    shared = buildBranchResolver();
  }
  return shared;
}
