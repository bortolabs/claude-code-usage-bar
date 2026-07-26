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
};

/**
 * Nome da pasta de transcript correspondente a um caminho de workspace. O Claude
 * Code monta o diretório em `~/.claude/projects/` trocando cada caractere não
 * alfanumérico do `cwd` por `-` (`/Users/me/meu-app` → `-Users-me-meu-app`).
 *
 * O mapeamento é LOSSY (`my-app` e `my.app` geram o mesmo slug), por isso quem usa
 * confere depois a `cwd` gravada dentro do arquivo escolhido.
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
    return { ...(latest ? lastTurnInFile(latest) : EMPTY), scoped: false };
  } catch {
    return { ...EMPTY, scoped: (workspacePaths ?? []).length > 0 };
  }
}

/**
 * Turno mais recente entre os projetos do workspace (multi-root: pega a sessão mais
 * recente entre todas as pastas). Percorre os candidatos do mais novo pro mais velho
 * e aceita o primeiro cuja `cwd` case com o workspace — assim uma colisão de slug
 * não faz a janela exibir o contexto do projeto errado.
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
  for (const c of candidates) {
    const turn = lastTurnInFile(c.file);
    // `cwd` ausente (formato antigo) não invalida: o slug já apontou pra cá.
    if (turn.cwd && !wanted.has(turn.cwd)) {
      continue;
    }
    if (turn.model !== null || turn.contextTokens !== null) {
      return turn;
    }
  }
  return null;
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

/** Igual ao CurrentTurn, mais a `cwd` do turno (p/ conferir o projeto). */
interface TurnInFile extends Omit<CurrentTurn, "scoped"> {
  /** `cwd` gravada no transcript, quando presente. */
  cwd: string | null;
}

/**
 * Lê o arquivo de trás pra frente e retorna o último modelo válido + a % de
 * contexto do último turno da CONVERSA PRINCIPAL (ignora sidechains/subagentes).
 * Modelo e contexto podem vir de linhas diferentes; para no primeiro de cada.
 */
function lastTurnInFile(file: string): TurnInFile {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return { ...EMPTY, cwd: null };
  }
  const lines = content.trimEnd().split("\n");
  let model: string | null = null;
  let contextPct: number | null = null;
  let contextTokens: number | null = null;
  let contextWindow: number | null = null;
  let cwd: string | null = null;
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
    if (cwd === null && typeof o?.cwd === "string" && o.cwd) {
      cwd = o.cwd;
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
        }
      }
    }
    if (model !== null && contextPct !== null && cwd !== null) {
      break;
    }
  }
  return { model, contextPct, contextTokens, contextWindow, cwd };
}
