import { exec } from "child_process";

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
    usedCredits: number;
    monthlyLimit: number;
    currency: string;
  } | null;
}
export interface OAuthUsageUnavailable {
  available: false;
  reason: string;
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

/**
 * Busca o uso REAL do plano (igual ao /usage) via endpoint OAuth da Anthropic.
 * Lê o token do Keychain do macOS (serviço "Claude Code-credentials") e chama
 * GET api/oauth/usage. É a mesma fonte que o /usage do Claude Code usa.
 *
 * macOS apenas (usa `security`). Em outros SOs, retorna indisponível.
 */
export function fetchOAuthUsage(timeoutMs = 12000): Promise<OAuthUsageResult> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({
        available: false,
        reason: "oauth/usage só implementado no macOS (Keychain)",
      });
      return;
    }
    // Pipeline: lê token do Keychain -> extrai accessToken do bloco claudeAiOauth
    // -> chama o endpoint. Tudo num shell só (token nunca vira arg de processo).
    // O JSON tem vários "accessToken" (Claude + servidores MCP). Isolamos o
    // primeiro objeto após "claudeAiOauth" e pegamos o accessToken dele.
    const extract = [
      // 1) recorta de claudeAiOauth até o accessToken e captura o valor
      "grep -o '\"claudeAiOauth\":{\"accessToken\":\"[^\"]*\"'",
      "| sed -n 's/.*\"accessToken\":\"\\([^\"]*\\)\".*/\\1/p'",
      "| head -1",
    ].join(" ");
    const script = [
      'CRED=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)',
      `; TOKEN=$(printf '%s' "$CRED" | ${extract})`,
      '; [ -z "$TOKEN" ] && exit 7',
      '; curl -sS --max-time 10 -H "Authorization: Bearer $TOKEN" -H "anthropic-beta: oauth-2025-04-20" "https://api.anthropic.com/api/oauth/usage"',
    ].join(" ");

    exec(
      script,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, shell: "/bin/sh" },
      (err, stdout) => {
        if (err) {
          const code = (err as { code?: number }).code;
          resolve({
            available: false,
            reason:
              code === 7
                ? "token OAuth não encontrado no Keychain"
                : `falha ao consultar oauth/usage (${err.message.split("\n")[0]})`,
          });
          return;
        }
        try {
          const j = JSON.parse(stdout);
          const eu = j?.extra_usage;
          resolve({
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
                    usedCredits:
                      typeof eu.used_credits === "number" ? eu.used_credits : 0,
                    monthlyLimit:
                      typeof eu.monthly_limit === "number"
                        ? eu.monthly_limit
                        : 0,
                    currency:
                      typeof eu.currency === "string" ? eu.currency : "USD",
                  }
                : null,
          });
        } catch {
          resolve({
            available: false,
            reason: "resposta do oauth/usage não é JSON válido",
          });
        }
      }
    );
  });
}
