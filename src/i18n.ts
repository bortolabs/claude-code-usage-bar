import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Camada de i18n com OVERRIDE de idioma pelo setting `language`.
 *
 * Por padrão (`auto`) seguimos o idioma do VS Code via `vscode.l10n.t` (o jeito
 * nativo). Quando o usuário escolhe um idioma específico (pt/en/es/fr/de),
 * passamos a traduzir nós mesmos, lendo os bundles `l10n/bundle.l10n.<lang>.json`
 * (os mesmos que já versionamos) — assim toda a UI do PLUGIN (status bar, painel,
 * tooltips, alertas) troca de idioma na hora, independente do VS Code. Os rótulos
 * dos settings na tela NATIVA de Settings continuam seguindo o VS Code (limitação
 * da plataforma — o manifesto `package.nls.*` é resolvido pelo próprio VS Code).
 */

const LANGS = ["auto", "pt", "en", "es", "fr", "de"] as const;
type Lang = (typeof LANGS)[number];

let currentLang: Lang = "auto";
let extPath = "";
const cache: Record<string, Record<string, string>> = {};

/** Guarda o caminho da extensão (para ler os bundles em runtime). */
export function initI18n(extensionPath: string): void {
  extPath = extensionPath;
}

/** Define o idioma corrente a partir do valor do setting. */
export function setLang(lang: string | undefined): void {
  currentLang = (LANGS as readonly string[]).includes(lang ?? "")
    ? (lang as Lang)
    : "auto";
}

function bundleFor(lang: string): Record<string, string> {
  if (cache[lang]) {
    return cache[lang];
  }
  let obj: Record<string, string> = {};
  try {
    const file =
      lang === "pt"
        ? path.join(extPath, "l10n", "bundle.l10n.json")
        : path.join(extPath, "l10n", `bundle.l10n.${lang}.json`);
    obj = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    obj = {};
  }
  cache[lang] = obj;
  return obj;
}

/**
 * Traduz `message` (string-fonte em pt) substituindo `{0}`, `{1}`… pelos args.
 * Em `auto`, delega para o `vscode.l10n.t` (idioma do VS Code). Drop-in do
 * `vscode.l10n.t(message, ...args)`.
 */
export function tr(message: string, ...args: (string | number | boolean)[]): string {
  if (currentLang === "auto") {
    return vscode.l10n.t(message, ...args);
  }
  const tpl =
    currentLang === "pt" ? message : bundleFor(currentLang)[message] ?? message;
  return tpl.replace(/\{(\d+)\}/g, (_m, i) => {
    const v = args[Number(i)];
    return v === undefined ? "" : String(v);
  });
}
