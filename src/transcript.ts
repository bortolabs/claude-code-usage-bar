import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Lê o MODELO ATUAL em uso, a partir do transcript .jsonl mais recente do
 * Claude Code. O ccusage só dá a lista de modelos do bloco inteiro (5h), que
 * mistura vários (opus, haiku de subagentes…), então não serve para "modelo
 * atual". O transcript reflete o turno corrente.
 *
 * Estratégia: acha o .jsonl mais recentemente modificado em ~/.claude/projects/
 * e lê de trás pra frente a primeira mensagem de assistant com um model válido.
 */
export function readCurrentModel(): string | null {
  try {
    const root = path.join(os.homedir(), ".claude", "projects");
    const latest = mostRecentJsonl(root);
    if (!latest) {
      return null;
    }
    return lastModelInFile(latest);
  } catch {
    return null;
  }
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

/** Lê o arquivo e retorna o último model de mensagem de assistant válido. */
function lastModelInFile(file: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const lines = content.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.indexOf("model") === -1) {
      continue;
    }
    try {
      const o = JSON.parse(line);
      const model = o?.message?.model;
      if (typeof model === "string" && model && model !== "<synthetic>") {
        return model;
      }
    } catch {
      // linha parcial/inválida — segue
    }
  }
  return null;
}
