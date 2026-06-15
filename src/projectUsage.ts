import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface ProjectUsage {
  project: string; // nome legível (basename do cwd)
  tokens: number; // soma input+output+cache na janela
}

/** Soma os tokens de uma entrada de usage do transcript. */
function sumUsage(u: Record<string, unknown> | undefined): number {
  if (!u) {
    return 0;
  }
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  return (
    n("input_tokens") +
    n("output_tokens") +
    n("cache_creation_input_tokens") +
    n("cache_read_input_tokens")
  );
}

/** Nome legível do projeto a partir do cwd ou do nome da pasta de projetos. */
function projectName(cwd: string | undefined, dirName: string): string {
  if (cwd && typeof cwd === "string" && cwd.length > 1) {
    return path.basename(cwd);
  }
  // fallback: a pasta "-Users-bruno-mapa-v2" → "mapa-v2"
  const parts = dirName.replace(/^-/, "").split("-");
  return parts[parts.length - 1] || dirName;
}

/**
 * Breakdown de uso por projeto dentro da janela de 5h atual.
 * Varre ~/.claude/projects/<pasta>/*.jsonl, considerando só os arquivos tocados
 * dentro da janela (mtime >= windowStartMs) e as linhas com timestamp na janela.
 * Agrupa por cwd (basename). Retorna os top `limit` ordenados desc.
 */
export function readProjectBreakdown(
  windowStartMs: number,
  limit = 6
): ProjectUsage[] {
  const root = path.join(os.homedir(), ".claude", "projects");
  const totals = new Map<string, number>();
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const d of dirs) {
    if (!d.isDirectory()) {
      continue;
    }
    const dir = path.join(root, d.name);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        // Pula arquivos não tocados na janela (otimização).
        if (fs.statSync(full).mtimeMs < windowStartMs) {
          continue;
        }
        const content = fs.readFileSync(full, "utf8");
        for (const line of content.split("\n")) {
          if (!line || line.indexOf('"usage"') === -1) {
            continue;
          }
          let o: any;
          try {
            o = JSON.parse(line);
          } catch {
            continue;
          }
          const usage = o?.message?.usage;
          if (!usage) {
            continue;
          }
          const ts = o?.timestamp ? Date.parse(o.timestamp) : NaN;
          if (isNaN(ts) || ts < windowStartMs) {
            continue;
          }
          const name = projectName(o?.cwd, d.name);
          totals.set(name, (totals.get(name) ?? 0) + sumUsage(usage));
        }
      } catch {
        // ignora arquivo problemático
      }
    }
  }

  return Array.from(totals.entries())
    .map(([project, tokens]) => ({ project, tokens }))
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit);
}
