import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Turno atual: modelo em uso + % de uso da janela de contexto (ambos do transcript). */
export interface CurrentTurn {
  model: string | null;
  /** % da janela de contexto preenchida (0-100) ou null se desconhecido. */
  contextPct: number | null;
}

/**
 * Lê o TURNO ATUAL (modelo + % de contexto) do transcript .jsonl mais recente do
 * Claude Code. O ccusage só dá a lista de modelos do bloco inteiro (5h), que
 * mistura vários (opus, haiku de subagentes…); o transcript reflete o turno
 * corrente. O **contexto** vem dos tokens do último turno (input + cache) sobre a
 * janela do modelo — assim funciona no app/IDE sem depender da statusline.
 */
export function readCurrentTurn(): CurrentTurn {
  try {
    const root = path.join(os.homedir(), ".claude", "projects");
    const latest = mostRecentJsonl(root);
    if (!latest) {
      return { model: null, contextPct: null };
    }
    return lastTurnInFile(latest);
  } catch {
    return { model: null, contextPct: null };
  }
}

/** Janela de contexto (tokens) por modelo. Haiku = 200k; demais 4.x = 1M. */
function contextWindowFor(model: string | null): number {
  if (model && /haiku/i.test(model)) {
    return 200_000;
  }
  return 1_000_000;
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

/**
 * Lê o arquivo de trás pra frente e retorna o último modelo válido + a % de
 * contexto do último turno da CONVERSA PRINCIPAL (ignora sidechains/subagentes).
 * Modelo e contexto podem vir de linhas diferentes; para no primeiro de cada.
 */
function lastTurnInFile(file: string): CurrentTurn {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return { model: null, contextPct: null };
  }
  const lines = content.trimEnd().split("\n");
  let model: string | null = null;
  let contextPct: number | null = null;
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
        const n = (k: string) => (typeof u[k] === "number" ? u[k] : 0);
        const ctx =
          n("input_tokens") +
          n("cache_read_input_tokens") +
          n("cache_creation_input_tokens");
        if (ctx > 0) {
          contextPct = Math.min(100, (ctx / contextWindowFor(m)) * 100);
        }
      }
    }
    if (model !== null && contextPct !== null) {
      break;
    }
  }
  return { model, contextPct };
}
