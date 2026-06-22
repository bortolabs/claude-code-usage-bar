import * as https from "https";

/** Indicador geral do Statuspage. */
export type StatusIndicator = "none" | "minor" | "major" | "critical";

export interface StatusComponent {
  name: string;
  status: string; // operational | degraded_performance | partial_outage | major_outage | under_maintenance
}
export interface StatusIncident {
  id: string;
  name: string;
  impact: string; // none | minor | major | critical
  status: string; // investigating | identified | monitoring | resolved
  updatedAt: string | null;
  shortlink: string | null;
  lastUpdate: string | null; // corpo da última atualização
}
export interface StatusData {
  available: true;
  indicator: StatusIndicator;
  description: string;
  components: StatusComponent[];
  incidents: StatusIncident[];
  /** Últimos incidentes resolvidos (histórico curto). */
  recent: { name: string; impact: string; resolvedAt: string | null }[];
}
export interface StatusUnavailable {
  available: false;
  reason: string;
}
export type StatusResult = StatusData | StatusUnavailable;

const HOST = "status.claude.com";

function getJson(path: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        hostname: HOST,
        path,
        headers: { "User-Agent": "claude-code-usage-bar" },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error("JSON inválido"));
            }
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
 * Busca o status da Anthropic via API pública do Statuspage (status.claude.com).
 * Sem autenticação. Retorna status geral, componentes, incidentes ativos e
 * um histórico curto de incidentes resolvidos.
 */
export async function fetchStatus(timeoutMs = 10000): Promise<StatusResult> {
  try {
    const summary = await getJson("/api/v2/summary.json", timeoutMs);
    const indicator: StatusIndicator = summary?.status?.indicator ?? "none";
    const description: string =
      summary?.status?.description ?? "All Systems Operational";

    // Componentes visíveis (ignora grupos).
    const components: StatusComponent[] = (summary?.components ?? [])
      .filter((c: any) => c && !c.group)
      .map((c: any) => ({ name: c.name, status: c.status }));

    // Incidentes ativos (vêm no summary.incidents).
    const incidents: StatusIncident[] = (summary?.incidents ?? []).map(
      (i: any) => ({
        id: i.id,
        name: i.name,
        impact: i.impact ?? "none",
        status: i.status ?? "",
        updatedAt: i.updated_at ?? null,
        shortlink: i.shortlink ?? null,
        lastUpdate:
          Array.isArray(i.incident_updates) && i.incident_updates[0]
            ? i.incident_updates[0].body ?? null
            : null,
      })
    );

    // Histórico curto: últimos incidentes resolvidos.
    let recent: StatusData["recent"] = [];
    try {
      const hist = await getJson("/api/v2/incidents.json", timeoutMs);
      recent = (hist?.incidents ?? [])
        .filter((i: any) => i.status === "resolved")
        .slice(0, 5)
        .map((i: any) => ({
          name: i.name,
          impact: i.impact ?? "none",
          resolvedAt: i.resolved_at ?? null,
        }));
    } catch {
      // histórico é opcional
    }

    return {
      available: true,
      indicator,
      description,
      components,
      incidents,
      recent,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { available: false, reason: msg };
  }
}

/** Há algum problema ativo? (para o badge/notificação) */
export function hasIssue(s: StatusData): boolean {
  return s.indicator !== "none" || s.incidents.length > 0;
}
