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
 * Extrai o campo `version` do corpo devolvido pelo Open VSX. NUNCA lança: qualquer formato
 * inesperado (JSON inválido, `version` ausente ou não-string, body vazio) vira `null`, que
 * o chamador trata como "não sei a versão" e segue calado.
 */
export function parseLatestVersion(body: string): string | null {
  try {
    const v = JSON.parse(body)?.version;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/** Chaves no `globalState` (compartilhado entre as janelas abertas). */
export const UPDATE_LAST_CHECK_KEY = "updateLastCheckMs";
export const UPDATE_LAST_FAILED_KEY = "updateLastCheckFailed";
export const UPDATE_NOTIFIED_KEY = "updateNotifiedVersion";
export const UPDATE_OPT_OUT_KEY = "updateNotifyOptOut";

/** Intervalo normal entre checagens. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 3600 * 1000;
/**
 * Intervalo depois de uma checagem que FALHOU (offline, timeout). Curto de propósito:
 * estar sem rede na hora não pode custar a janela inteira de 24h. Mas não é zero —
 * a checagem roda a cada ativação (uma por janela do VS Code), e sem um piso um
 * usuário offline com várias janelas marteleria o Open VSX a cada reload.
 */
export const UPDATE_RETRY_INTERVAL_MS = 3600 * 1000;

/** Está na hora de checar de novo? */
export function isCheckDue(
  lastCheckMs: number | undefined,
  lastCheckFailed: boolean,
  now: number
): boolean {
  const elapsed = now - (lastCheckMs ?? 0);
  // Relógio andou pra trás (fuso, NTP): não dá pra confiar no carimbo, checa.
  if (elapsed < 0) {
    return true;
  }
  return (
    elapsed >= (lastCheckFailed ? UPDATE_RETRY_INTERVAL_MS : UPDATE_CHECK_INTERVAL_MS)
  );
}

/** O que o usuário fez com o aviso. `dismissed` = fechou/ignorou, sem escolher nada. */
export type UpdateNoticeChoice = "release" | "never" | "dismissed";

/** Tudo que o fluxo precisa do mundo externo — injetado para poder ser testado. */
export interface UpdateCheckDeps {
  now: () => number;
  getState: <T>(key: string) => T | undefined;
  setState: (key: string, value: unknown) => Promise<void>;
  fetchLatest: () => Promise<string | null>;
  /** Mostra o aviso e resolve com a escolha do usuário. */
  showNotice: (latest: string, current: string) => Promise<UpdateNoticeChoice>;
  openReleases: () => void;
}

/** Por onde o fluxo saiu — existe para o teste (e para depuração), não para a UI. */
export type UpdateCheckOutcome =
  | "opt-out"
  | "not-due"
  | "fetch-failed"
  | "up-to-date"
  | "already-notified"
  | "notified-dismissed"
  | "notified-release"
  | "notified-never";

/**
 * Fluxo completo da checagem de versão nova.
 *
 * As duas gravações de estado acontecem **depois** do que elas registram, e isso é o
 * ponto do desenho — na versão anterior as duas eram feitas antes, e cada uma
 * transformava um contratempo em silêncio permanente:
 *
 * - `updateLastCheckMs` era carimbado antes do fetch: estar offline naquele segundo
 *   consumia as 24h inteiras, e só se tentava de novo no dia seguinte;
 * - `updateNotifiedVersion` era gravado antes de `showInformationMessage`: como o aviso
 *   só aparece uma vez por versão, um toast perdido (janela recarregada, usuário em
 *   outro app, notificação recolhida no sininho e limpa) queimava a **única** chance
 *   de saber daquela versão — para sempre.
 *
 * `force` é a checagem pedida na mão pelo usuário (comando da paleta): fura as três
 * guardas que existem só para a checagem automática não incomodar — intervalo,
 * opt-out e "já avisei desta versão". Quem clicou no comando quer uma resposta agora,
 * qualquer que seja; o chamador usa o `UpdateCheckOutcome` para dar essa resposta.
 * O que `force` **não** muda é a regra de gravação: continua só marcando a versão
 * como avisada se o usuário responder.
 */
export async function runUpdateCheck(
  current: string,
  deps: UpdateCheckDeps,
  opts: { force?: boolean } = {}
): Promise<UpdateCheckOutcome> {
  const force = opts.force === true;
  if (!force && deps.getState<boolean>(UPDATE_OPT_OUT_KEY) === true) {
    return "opt-out";
  }
  const due =
    force ||
    isCheckDue(
      deps.getState<number>(UPDATE_LAST_CHECK_KEY),
      deps.getState<boolean>(UPDATE_LAST_FAILED_KEY) === true,
      deps.now()
    );
  if (!due) {
    return "not-due";
  }

  const latest = await deps.fetchLatest();
  await deps.setState(UPDATE_LAST_CHECK_KEY, deps.now());
  await deps.setState(UPDATE_LAST_FAILED_KEY, latest === null);
  if (latest === null) {
    return "fetch-failed";
  }
  if (!isNewer(latest, current)) {
    return "up-to-date";
  }
  // Não repete o aviso da MESMA versão que o usuário já respondeu.
  if (!force && deps.getState<string>(UPDATE_NOTIFIED_KEY) === latest) {
    return "already-notified";
  }

  const choice = await deps.showNotice(latest, current);
  // Fechou sem escolher: não grava nada, o aviso volta na próxima janela de checagem.
  if (choice === "dismissed") {
    return "notified-dismissed";
  }
  await deps.setState(UPDATE_NOTIFIED_KEY, latest);
  if (choice === "release") {
    deps.openReleases();
    return "notified-release";
  }
  await deps.setState(UPDATE_OPT_OUT_KEY, true);
  return "notified-never";
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
          res.on("end", () => finish(parseLatestVersion(body)));
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
