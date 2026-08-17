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

/** Chaves que a aba Config **renderiza** (SETTINGS_SCHEMA do painel). */
function renderedKeys(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "src", "panel.ts"), "utf8");
  const start = src.indexOf("const SETTINGS_SCHEMA = [");
  const end = src.indexOf("\n  ];", start);
  return [...src.slice(start, end).matchAll(/\{ key: '([^']+)'/g)].map((m) => m[1]);
}

/** Chaves que o `collectSettings` **envia** para o webview. */
function collectedKeys(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "src", "extension.ts"), "utf8");
  const block = /const collectSettings = \(\)[\s\S]*?const keys = \[([\s\S]*?)\];/.exec(src);
  return [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Trava o par render↔coleta da aba Config (passos 3 e 4 da checklist do CLAUDE.md).
 *
 * Contexto: os 5 settings do AI advice eram desenhados na aba Config mas não
 * entravam no `collectSettings` — o webview recebia `undefined` e mostrava campo
 * vazio + estilo "anthropic" mesmo com o endpoint configurado no `settings.json`.
 * O painel mentia sobre o estado, e mexer num campo em branco sobrescrevia a
 * configuração real. Falha silenciosa: nada quebra, só a tela fica errada.
 */
describe("aba Config: render × coleta", () => {
  it("todo campo renderizado tem valor coletado", () => {
    const missing = renderedKeys().filter((k) => !collectedKeys().includes(k));
    expect(missing, "campos que apareceriam vazios na aba Config").toEqual([]);
  });

  it("todo campo renderizado tem default declarado no manifesto", () => {
    // Sem isso, `c.get(k)` devolve undefined e o campo cai no fallback do painel.
    const known = manifestKeys();
    const ghosts = renderedKeys().filter((k) => !known.includes(k));
    expect(ghosts, "campos da aba Config sem setting no package.json").toEqual([]);
  });

  it("o schema do painel não está vazio (guarda contra regex que parou de casar)", () => {
    // Os dois testes acima passariam de graça se a extração devolvesse [].
    expect(renderedKeys().length).toBeGreaterThan(50);
    expect(collectedKeys().length).toBeGreaterThan(50);
  });

  /**
   * Settings que de propósito NÃO viram campo na aba Config. Ficar de fora é uma
   * decisão, e ela precisa estar escrita — senão a exceção vira desculpa e a próxima
   * ausência (que é bug) passa junto.
   */
  const FORA_DA_ABA_CONFIG: Record<string, string> = {
    barStyle: "já editável ali pelos botões visuais de estilo (`extra: 'style'`)",
    costWindow: "estado do seletor de janela da aba Custos, gravado ao escolher",
    dashboardWindow: "estado do seletor de janela do dashboard, gravado ao escolher",
  };

  it("todo setting do manifesto aparece na aba Config (ou está na lista de exceções)", () => {
    // Era o buraco: `tooltipDetail` estava no manifesto e nos READMEs, mas não no
    // SETTINGS_SCHEMA — só dava para mudar editando o `settings.json` na mão.
    const invisiveis = manifestKeys().filter(
      (k) => !renderedKeys().includes(k) && !(k in FORA_DA_ABA_CONFIG),
    );
    expect(invisiveis, "settings que ninguém acha pela UI").toEqual([]);
  });

  it("a lista de exceções não guarda setting que já não existe", () => {
    const known = manifestKeys();
    const mortos = Object.keys(FORA_DA_ABA_CONFIG).filter((k) => !known.includes(k));
    expect(mortos, "exceções obsoletas").toEqual([]);
  });

  it("exceção não vale para setting que a aba Config renderiza", () => {
    // Se um dia um deles virar campo de verdade, a exceção some junto.
    const contraditorios = Object.keys(FORA_DA_ABA_CONFIG).filter((k) =>
      renderedKeys().includes(k),
    );
    expect(contraditorios, "estão na aba Config E na lista de exceções").toEqual([]);
  });
});
