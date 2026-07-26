import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Trava a defasagem entre o manifesto e os READMEs.
 *
 * Contexto: até a v0.41.1 o `package.json` declarava 63 settings e os READMEs
 * documentavam 42 — features inteiras (copiloto, anomalias, metas, histórico)
 * existiam sem nenhuma menção. A checklist do CLAUDE.md ajuda, mas depende de
 * alguém lembrar; este teste não. Quem adicionar um setting sem documentá-lo
 * quebra a CI no próprio PR.
 *
 * Lê arquivos do próprio repositório (não `~/.claude`), então não precisa de
 * fixture nem de mock de `os` — ao contrário dos testes de transcript.
 */

const ROOT = process.cwd();

/** Chaves declaradas em `contributes.configuration.properties`, sem o prefixo. */
function manifestKeys(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return Object.keys(pkg.contributes.configuration.properties).map((k) =>
    k.replace(/^claudeUsageBar\./, ""),
  );
}

/** Chaves documentadas num README, na ordem em que aparecem nas tabelas. */
function documentedKeys(file: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const keys: string[] = [];
  for (const m of text.matchAll(/^\| `claudeUsageBar\.([A-Za-z0-9]+)` \|/gm)) {
    keys.push(m[1]);
  }
  return keys;
}

const READMES = ["README.md", "README.pt-BR.md"];

describe("documentação dos settings", () => {
  it.each(READMES)("%s documenta todos os settings do manifesto", (file) => {
    const missing = manifestKeys().filter((k) => !documentedKeys(file).includes(k));
    expect(missing, `settings sem linha em ${file}`).toEqual([]);
  });

  it.each(READMES)("%s não documenta setting inexistente", (file) => {
    const known = manifestKeys();
    const ghosts = documentedKeys(file).filter((k) => !known.includes(k));
    expect(ghosts, `settings em ${file} que não existem no package.json`).toEqual([]);
  });

  it("os dois READMEs listam as mesmas chaves, na mesma ordem", () => {
    // Só a coluna de descrição muda de idioma; chave, ordem e agrupamento não.
    expect(documentedKeys("README.pt-BR.md")).toEqual(documentedKeys("README.md"));
  });

  it("nenhum README repete a mesma chave", () => {
    for (const file of READMES) {
      const keys = documentedKeys(file);
      expect(new Set(keys).size, `chaves duplicadas em ${file}`).toBe(keys.length);
    }
  });
});
