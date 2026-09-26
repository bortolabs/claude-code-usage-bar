import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Turno atual: modelo em uso + uso da janela de contexto (ambos do transcript). */
export interface CurrentTurn {
  model: string | null;
  /** % da janela de contexto preenchida (0-100) ou null se desconhecido. */
  contextPct: number | null;
  /** Tokens de contexto do último turno (input + cache), ou null se desconhecido. */
  contextTokens: number | null;
  /** Janela de contexto do modelo (tokens), ou null se desconhecido. */
  contextWindow: number | null;
  /**
   * Nome da sessão de onde o turno veio (`/rename` ou o título gerado pelo Claude
   * Code), ou null. Com 2 chats no mesmo projeto, é o que diz de QUAL deles é o número.
   */
  sessionTitle: string | null;
  /**
   * A busca foi RESTRITA ao(s) projeto(s) do workspace? Quando true, um retorno
   * vazio significa "este projeto não tem transcript" — e quem consome NÃO deve
   * cair em fontes globais (statusline), sob pena de exibir o número de outro
   * projeto, que é justamente o que o escopo existe para evitar.
   */
  scoped: boolean;
}

const EMPTY: Omit<CurrentTurn, "scoped"> = {
  model: null,
  contextPct: null,
  contextTokens: null,
  contextWindow: null,
  sessionTitle: null,
};

/** Quantos candidatos (por mtime) disputam o "turno mais recente" dentro do projeto. */
const MAX_CANDIDATES = 3;
/** Bytes lidos do fim do arquivo para achar o último turno (senão cai na leitura inteira). */
const TAIL_BYTES = 512 * 1024;
/** Bytes lidos do começo do arquivo para achar a `cwd` de origem da sessão. */
const HEAD_BYTES = 256 * 1024;

/**
 * Nome da pasta de transcript correspondente a um caminho de workspace. O Claude
 * Code monta o diretório em `~/.claude/projects/` trocando cada caractere não
 * alfanumérico do `cwd` por `-` (`/Users/me/meu-app` → `-Users-me-meu-app`).
 *
 * O mapeamento é LOSSY (`my-app` e `my.app` geram o mesmo slug), por isso quem usa
 * confere depois a `cwd` de origem gravada no começo do arquivo.
 */
export function projectSlug(fsPath: string): string {
  return fsPath.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Lê o TURNO ATUAL (modelo + % de contexto) do transcript .jsonl mais recente do
 * Claude Code. O ccusage só dá a lista de modelos do bloco inteiro (5h), que
 * mistura vários (opus, haiku de subagentes…); o transcript reflete o turno
 * corrente. O **contexto** vem dos tokens do último turno (input + cache) sobre a
 * janela do modelo — assim funciona no app/IDE sem depender da statusline.
 *
 * ESCOPO POR PROJETO: com `workspacePaths`, só olha os transcripts do(s) projeto(s)
 * daquele workspace. Sem isso, duas janelas do VS Code abertas em projetos
 * diferentes mostravam AMBAS o mesmo contexto — o da sessão que gravou por último,
 * fosse ela de qual projeto fosse. Sem `workspacePaths` (janela sem pasta aberta),
 * mantém o comportamento global.
 */
export function readCurrentTurn(workspacePaths?: string[]): CurrentTurn {
  try {
    const root = path.join(os.homedir(), ".claude", "projects");
    const paths = (workspacePaths ?? []).filter((p) => !!p);
    if (paths.length > 0) {
      const turn = mostRecentInProjects(root, paths);
      return { ...(turn ?? EMPTY), scoped: true };
    }
    const latest = mostRecentJsonl(root);
    if (!latest) {
      return { ...EMPTY, scoped: false };
    }
    const { ts: _ts, ...turn } = lastTurnInFile(latest);
    return { ...turn, sessionTitle: sessionTitleOf(latest), scoped: false };
  } catch {
    return { ...EMPTY, scoped: (workspacePaths ?? []).length > 0 };
  }
}

/**
 * Turno mais recente entre os projetos do workspace (multi-root: pega a sessão mais
 * recente entre todas as pastas).
 *
 * Dois cuidados, ambos achados com várias sessões abertas no mesmo projeto:
 * - A conferência anti-colisão de slug usa a `cwd` de ORIGEM da sessão (a do começo
 *   do arquivo, que é a que define a pasta), não a do último turno: o Claude Code
 *   grava a `cwd` do momento, e um `cd` para subpasta ou `/tmp` descartava a sessão
 *   ativa — o card caía numa sessão parada, com outro contexto.
 * - `mtime` não é sinal de turno: o Claude Code anexa metadados (`cost-state`,
 *   `bridge-session`, `last-prompt`…) a sessões ociosas. O mtime só pré-seleciona os
 *   `MAX_CANDIDATES` mais novos; entre eles vence o de `timestamp` de turno maior.
 */
function mostRecentInProjects(
  root: string,
  workspacePaths: string[]
): Omit<CurrentTurn, "scoped"> | null {
  const wanted = new Set(workspacePaths);
  const candidates: { file: string; mtime: number }[] = [];
  for (const wp of workspacePaths) {
    const dir = path.join(root, projectSlug(wp));
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue; // projeto sem transcript
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        candidates.push({ file: full, mtime: fs.statSync(full).mtimeMs });
      } catch {
        // ignora
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  let best: (TurnInFile & { file: string }) | null = null;
  let accepted = 0;
  for (const c of candidates) {
    if (accepted >= MAX_CANDIDATES) {
      break;
    }
    // `cwd` ausente (formato antigo) não invalida: o slug já apontou pra cá.
    const origin = originCwd(c.file);
    if (origin && !wanted.has(origin)) {
      continue;
    }
    const turn = lastTurnInFile(c.file);
    if (turn.model === null && turn.contextTokens === null) {
      continue;
    }
    accepted++;
    // Sem timestamp (formato antigo) em algum dos dois, fica a ordem do mtime.
    if (!best || (turn.ts !== null && best.ts !== null && turn.ts > best.ts)) {
      best = { ...turn, file: c.file };
    }
  }
  if (!best) {
    return null;
  }
  const { ts: _ts, file, ...turn } = best;
  return { ...turn, sessionTitle: sessionTitleOf(file) };
}

/** Lê até `bytes` do arquivo a partir de `start` (clampado ao tamanho). */
function readSlice(file: string, start: number, bytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const from = Math.max(0, Math.min(start, size));
    const len = Math.min(bytes, size - from);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** `cwd` da sessão ao nascer: a primeira gravada no arquivo (ou null). */
function originCwd(file: string): string | null {
  let head: string;
  try {
    head = readSlice(file, 0, HEAD_BYTES);
  } catch {
    return null;
  }
  // A última linha do trecho pode estar cortada: o JSON.parse falha e ela é pulada.
  for (const line of head.split("\n")) {
    if (!line || line.indexOf('"cwd"') === -1) {
      continue;
    }
    try {
      const o = JSON.parse(line);
      if (typeof o?.cwd === "string" && o.cwd) {
        return o.cwd;
      }
    } catch {
      // linha inválida — segue
    }
  }
  return null;
}

/**
 * Nome da sessão: o `/rename` mais recente (`custom-title`) vence o título gerado
 * (`ai-title`). Lê o arquivo inteiro — o `custom-title` pode estar em qualquer lugar —
 * por isso só é chamado para o arquivo já escolhido.
 */
function sessionTitleOf(file: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let custom: string | null = null;
  let ai: string | null = null;
  for (const line of content.split("\n")) {
    const isCustom = line.indexOf('"custom-title"') !== -1;
    if (!isCustom && line.indexOf('"ai-title"') === -1) {
      continue;
    }
    try {
      const o = JSON.parse(line);
      if (o?.type === "custom-title" && typeof o.customTitle === "string" && o.customTitle.trim()) {
        custom = o.customTitle.trim();
      } else if (o?.type === "ai-title" && typeof o.aiTitle === "string" && o.aiTitle.trim()) {
        ai = o.aiTitle.trim();
      }
    } catch {
      // linha inválida — segue
    }
  }
  return custom ?? ai;
}

/** Janela de contexto (tokens) por modelo. Haiku = 200k; demais 4.x = 1M. */
function contextWindowFor(model: string | null): number {
  if (model && /haiku/i.test(model)) {
    return 200_000;
  }
  return 1_000_000;
}

/** Contexto do turno a partir do `usage`: tokens usados, janela e % (0-100). */
export function contextFromUsage(
  usage: any,
  model: string | null,
): { tokens: number; window: number; pct: number } {
  const n = (k: string) =>
    usage && typeof usage[k] === "number" ? (usage[k] as number) : 0;
  const tokens =
    n("input_tokens") +
    n("cache_read_input_tokens") +
    n("cache_creation_input_tokens");
  const window = contextWindowFor(model);
  const pct = window > 0 ? Math.min(100, (tokens / window) * 100) : 0;
  return { tokens, window, pct };
}

/** Mapeia o id técnico para um nome curto amigável. */
export function prettyModel(id: string | null | undefined): string {
  if (!id) {
    return "";
  }
  const m = id.toLowerCase();
  if (m.includes("opus")) {
    return version(m, "Opus");
  }
  if (m.includes("sonnet")) {
    return version(m, "Sonnet");
  }
  if (m.includes("haiku")) {
    return version(m, "Haiku");
  }
  if (m.includes("fable")) {
    return "Fable";
  }
  return id;
}

function version(id: string, base: string): string {
  // extrai a versão tanto do id técnico ("claude-opus-4-8" → "4-8") quanto de
  // uma string já formatada vinda da statusline ("Opus 4.7 (1M context)" →
  // "4.7"). Por isso aceitamos hífen OU ponto entre os números.
  const match = id.match(/(\d+)[-.](\d+)/);
  return match ? `${base} ${match[1]}.${match[2]}` : base;
}

/** Acha o .jsonl mais recentemente modificado abaixo de root (1 nível de subdir). */
function mostRecentJsonl(root: string): string | null {
  let best: { file: string; mtime: number } | null = null;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(root, d.name));
  } catch {
    return null;
  }
  for (const dir of dirs) {
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        if (!best || st.mtimeMs > best.mtime) {
          best = { file: full, mtime: st.mtimeMs };
        }
      } catch {
        // ignora
      }
    }
  }
  return best?.file ?? null;
}

/** Igual ao CurrentTurn (sem título), mais o instante do turno (p/ desempatar sessões). */
interface TurnInFile extends Omit<CurrentTurn, "scoped" | "sessionTitle"> {
  /** `timestamp` (epoch ms) do turno de onde veio o contexto, quando presente. */
  ts: number | null;
}

const EMPTY_TURN: TurnInFile = {
  model: null,
  contextPct: null,
  contextTokens: null,
  contextWindow: null,
  ts: null,
};

/**
 * Último modelo válido + contexto do último turno da CONVERSA PRINCIPAL (ignora
 * sidechains/subagentes). Lê primeiro só o fim do arquivo (`TAIL_BYTES`) — os
 * transcripts passam de MBs e isto roda a cada refresh, na thread do host — e cai na
 * leitura inteira quando o trecho não tem turno com contexto.
 */
function lastTurnInFile(file: string): TurnInFile {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return EMPTY_TURN;
  }
  if (size > TAIL_BYTES) {
    try {
      const tail = scanTurn(readSlice(file, size - TAIL_BYTES, TAIL_BYTES));
      if (tail.contextTokens !== null) {
        return tail;
      }
    } catch {
      // cai na leitura inteira
    }
  }
  try {
    return scanTurn(fs.readFileSync(file, "utf8"));
  } catch {
    return EMPTY_TURN;
  }
}

/**
 * Varre o texto de trás pra frente. Modelo e contexto podem vir de linhas
 * diferentes; para no primeiro de cada. Uma linha cortada (começo de um trecho
 * lido pelo fim) falha no JSON.parse e é pulada.
 */
function scanTurn(content: string): TurnInFile {
  const lines = content.trimEnd().split("\n");
  let model: string | null = null;
  let contextPct: number | null = null;
  let contextTokens: number | null = null;
  let contextWindow: number | null = null;
  let ts: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.indexOf('"model"') === -1) {
      continue;
    }
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // linha parcial/inválida — segue
    }
    const m = o?.message?.model;
    const valid = typeof m === "string" && m && m !== "<synthetic>";
    if (!valid) {
      continue;
    }
    if (model === null) {
      model = m;
    }
    // Contexto: tokens do último turno da conversa principal (sem subagentes).
    if (contextPct === null && o?.isSidechain !== true) {
      const u = o?.message?.usage;
      if (u) {
        const c = contextFromUsage(u, m);
        if (c.tokens > 0) {
          contextPct = c.pct;
          contextTokens = c.tokens;
          contextWindow = c.window;
          const t = typeof o?.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
          ts = Number.isFinite(t) ? t : null;
        }
      }
    }
    if (model !== null && contextPct !== null) {
      break;
    }
  }
  return { model, contextPct, contextTokens, contextWindow, ts };
}
