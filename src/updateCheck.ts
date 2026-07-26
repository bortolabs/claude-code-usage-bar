import * as https from "https";

/**
 * Checagem de versão nova publicada no Open VSX.
 *
 * POR QUE existe: o publisher `bortolabs` está bloqueado no VS Code Marketplace, então
 * o release sai só no **Open VSX** (+ `.vsix` na GitHub Release). Editores cuja galeria
 * É o Open VSX (VSCodium, Cursor, Windsurf) auto-atualizam sozinhos; mas o VS Code da
 * Microsoft não consulta o Open VSX, e extensão instalada por `.vsix` é sideloaded —
 * **nunca** auto-atualiza nem avisa. Sem esta checagem, quem está no VS Code fica preso
 * na versão que instalou sem jamais saber que saiu uma nova.
 *
 * É um GET simples e anônimo (sem token, sem corpo, sem telemetria); só a versão
 * publicada é lida da resposta.
 */

const HOST = "open-vsx.org";
const API_PATH = "/api/bortolabs/claude-code-usage-bar/latest";
/** Página da Release, aberta pelo botão da notificação. */
export const RELEASES_URL =
  "https://github.com/bortolabs/claude-code-usage-bar/releases/latest";

/**
 * Compara duas versões semver-lite ("0.41.0"). Retorna >0 se `a` > `b`, <0 se `a` < `b`,
 * 0 se iguais. Campos não numéricos (pré-release tipo "1.0.0-beta") são ignorados no
 * segmento — comparação é por major/minor/patch, que é o que o release deste projeto usa.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    String(v ?? "")
      .trim()
      .replace(/^v/, "")
      .split(".")
      .map((s) => parseInt(s, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) {
      return d > 0 ? 1 : -1;
    }
  }
  return 0;
}

/** `latest` é mais nova que `current`? (tolera valores vazios/inválidos → false) */
export function isNewer(latest: string | null, current: string): boolean {
  if (!latest || !current) {
    return false;
  }
  return compareVersions(latest, current) > 0;
}

/**
 * Busca a última versão publicada no Open VSX. NUNCA lança: devolve `null` em qualquer
 * falha (offline, timeout, JSON inválido, HTTP != 2xx) — é um aviso opcional, não pode
 * atrapalhar a ativação da extensão.
 */
export function fetchLatestVersion(timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const req = https.request(
        {
          method: "GET",
          hostname: HOST,
          path: API_PATH,
          headers: { "User-Agent": "claude-code-usage-bar" },
          timeout: timeoutMs,
        },
        (res) => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            finish(null);
            return;
          }
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              const v = JSON.parse(body)?.version;
              finish(typeof v === "string" && v ? v : null);
            } catch {
              finish(null);
            }
          });
          res.on("error", () => finish(null));
        }
      );
      req.on("timeout", () => {
        req.destroy();
        finish(null);
      });
      req.on("error", () => finish(null));
      req.end();
    } catch {
      finish(null);
    }
  });
}
