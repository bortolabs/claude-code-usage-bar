import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";

/** Uma janela de limite retornada pelo endpoint oauth/usage. */
export interface UsageWindow {
  utilization: number; // 0..100
  resetsAt: number | null; // epoch ms
}

export interface OAuthUsage {
  available: true;
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  sevenDaySonnet: UsageWindow | null;
  sevenDayOpus: UsageWindow | null;
  extraUsage: {
    enabled: boolean;
    utilization: number;
    /** Em unidades da moeda (a API manda centavos; normalizado no parse). */
    usedCredits: number;
    /** Em unidades da moeda (a API manda centavos; normalizado no parse). */
    monthlyLimit: number;
    currency: string;
  } | null;
}
// Motivo da indisponibilidade em forma ESTRUTURADA (não pré-traduzida): quem
// exibe localiza com o tr() do idioma ATUAL, em vez de congelar a string no
// idioma em que a falha aconteceu (senão, ao trocar de idioma, sobra um trecho
// no idioma antigo — ex.: alemão na "Fonte de dados" depois de voltar pro pt).
export type OAuthUnavailableReason =
  | { kind: "noToken" }
  | { kind: "httpError"; detail: string }
  // Usuário ainda não concedeu (ou revogou) o consentimento para ler o token.
  | { kind: "consent" };
export interface OAuthUsageUnavailable {
  available: false;
  reason: OAuthUnavailableReason;
}
export type OAuthUsageResult = OAuthUsage | OAuthUsageUnavailable;

function parseWindow(w: unknown): UsageWindow | null {
  if (!w || typeof w !== "object") {
    return null;
  }
  const obj = w as Record<string, unknown>;
  if (typeof obj.utilization !== "number") {
    return null;
  }
  let resetsAt: number | null = null;
  if (typeof obj.resets_at === "string") {
    const t = Date.parse(obj.resets_at);
    resetsAt = isNaN(t) ? null : t;
  }
  return { utilization: obj.utilization, resetsAt };
}

/** Diretórios onde o Claude Code pode guardar o .credentials.json. */
function credentialFileCandidates(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.env.CLAUDE_CONFIG_DIR) {
    candidates.push(
      path.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json")
    );
  }
  candidates.push(path.join(home, ".claude", ".credentials.json"));
  candidates.push(path.join(home, ".config", "claude", ".credentials.json"));
  return candidates;
}

/** Extrai claudeAiOauth.accessToken de um JSON de credenciais. */
function tokenFromCredentialJson(raw: string): string | null {
  try {
    const j = JSON.parse(raw);
    const t = j?.claudeAiOauth?.accessToken ?? j?.accessToken;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

/** Lê o token do arquivo .credentials.json (Linux/Windows/macOS). */
function tokenFromFile(): string | null {
  for (const p of credentialFileCandidates()) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const t = tokenFromCredentialJson(raw);
      if (t) {
        return t;
      }
    } catch {
      // arquivo não existe nesse caminho — tenta o próximo
    }
  }
  return null;
}

/** Lê o token do Keychain do macOS (fallback quando não há arquivo). */
function tokenFromKeychain(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve(null);
      return;
    }
    exec(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { timeout: 8000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        resolve(tokenFromCredentialJson(stdout.trim()));
      }
    );
  });
}

/** Resolve o token OAuth de forma cross-platform. */
async function resolveToken(): Promise<string | null> {
  const env = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (env && env.trim()) {
    return env.trim();
  }
  return tokenFromFile() ?? (await tokenFromKeychain());
}

/** GET no endpoint de usage via https nativo (sem depender de curl). */
function httpGetUsage(token: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        hostname: "api.anthropic.com",
        path: "/api/oauth/usage",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "claude-code-usage-bar",
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Busca o uso REAL do plano (igual ao /usage) via endpoint OAuth da Anthropic.
 * Cross-platform: lê o token de CLAUDE_CODE_OAUTH_TOKEN, do arquivo
 * ~/.claude/.credentials.json (Linux/Windows/macOS) ou do Keychain (macOS),
 * e chama GET api/oauth/usage. Mesma fonte que o /usage do Claude Code usa.
 *
 * CONSENTIMENTO: esta é a ÚNICA função que toca nas credenciais, e o seu ÚNICO
 * chamador (refreshOAuth em extension.ts) só a invoca depois que o usuário
 * concedeu consentimento explícito (globalState "oauthConsent" === "granted",
 * via diálogo modal). Sem consentimento, NENHUMA leitura de arquivo/Keychain/
 * env acontece. O token é usado exclusivamente no header desta chamada HTTPS
 * ao endpoint oficial da Anthropic — nunca é logado, persistido em outro lugar
 * nem enviado a terceiros; a extensão não tem telemetria.
 */
export async function fetchOAuthUsage(
  timeoutMs = 12000
): Promise<OAuthUsageResult> {
  const token = await resolveToken();
  if (!token) {
    return { available: false, reason: { kind: "noToken" } };
  }
  try {
    const raw = await httpGetUsage(token, timeoutMs);
    const j = JSON.parse(raw);
    const eu = j?.extra_usage;
    return {
      available: true,
      fiveHour: parseWindow(j?.five_hour),
      sevenDay: parseWindow(j?.seven_day),
      sevenDaySonnet: parseWindow(j?.seven_day_sonnet),
      sevenDayOpus: parseWindow(j?.seven_day_opus),
      extraUsage:
        eu && typeof eu === "object"
          ? {
              enabled: !!eu.is_enabled,
              utilization:
                typeof eu.utilization === "number" ? eu.utilization : 0,
              // A API devolve valores monetários em CENTAVOS (ex.: limite de
              // US$ 25 vem como 2500) — normaliza pra dólares aqui, na borda.
              usedCredits:
                typeof eu.used_credits === "number" ? eu.used_credits / 100 : 0,
              monthlyLimit:
                typeof eu.monthly_limit === "number"
                  ? eu.monthly_limit / 100
                  : 0,
              currency: typeof eu.currency === "string" ? eu.currency : "USD",
            }
          : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { available: false, reason: { kind: "httpError", detail: msg } };
  }
}
