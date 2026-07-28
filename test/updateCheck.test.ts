import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, parseLatestVersion } from "../src/updateCheck";

describe("compareVersions", () => {
  it("compara major/minor/patch", () => {
    expect(compareVersions("0.41.0", "0.40.0")).toBeGreaterThan(0);
    expect(compareVersions("0.40.0", "0.41.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.40.1", "0.40.0")).toBeGreaterThan(0);
  });

  it("versões iguais → 0 (inclusive com prefixo 'v' e espaços)", () => {
    expect(compareVersions("0.40.0", "0.40.0")).toBe(0);
    expect(compareVersions("v0.40.0", " 0.40.0 ")).toBe(0);
  });

  it("segmentos faltando contam como zero", () => {
    expect(compareVersions("0.41", "0.41.0")).toBe(0);
    expect(compareVersions("1", "0.99.99")).toBeGreaterThan(0);
  });

  it("não compara por ordem de string (10 > 9)", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
});

describe("isNewer", () => {
  it("true só quando a publicada é maior", () => {
    expect(isNewer("0.41.0", "0.40.0")).toBe(true);
    expect(isNewer("0.40.0", "0.40.0")).toBe(false);
    expect(isNewer("0.39.0", "0.40.0")).toBe(false);
  });

  it("valores ausentes/vazios nunca disparam o aviso", () => {
    expect(isNewer(null, "0.40.0")).toBe(false);
    expect(isNewer("", "0.40.0")).toBe(false);
    expect(isNewer("0.41.0", "")).toBe(false);
  });
});

describe("parseLatestVersion", () => {
  it("lê `version` do payload do Open VSX", () => {
    // Recorte do corpo real de GET /api/bortolabs/claude-code-usage-bar/latest
    // (só os campos que importam aqui; o payload completo tem ~18 chaves).
    const body = JSON.stringify({
      namespace: "bortolabs",
      name: "claude-code-usage-bar",
      version: "0.41.1",
      versionAlias: ["latest"],
      preRelease: false,
      downloadCount: 1337,
    });
    expect(parseLatestVersion(body)).toBe("0.41.1");
  });

  it("nunca lança: formato ruim vira null", () => {
    expect(parseLatestVersion("<html>502 Bad Gateway</html>")).toBeNull();
    expect(parseLatestVersion("")).toBeNull();
    expect(parseLatestVersion("{}")).toBeNull();
    expect(parseLatestVersion("null")).toBeNull();
  });

  it("`version` não-string ou vazia vira null (não vira aviso bizarro)", () => {
    expect(parseLatestVersion(JSON.stringify({ version: 41 }))).toBeNull();
    expect(parseLatestVersion(JSON.stringify({ version: "" }))).toBeNull();
    expect(parseLatestVersion(JSON.stringify({ version: null }))).toBeNull();
    expect(parseLatestVersion(JSON.stringify({ version: ["0.41.1"] }))).toBeNull();
  });
});
