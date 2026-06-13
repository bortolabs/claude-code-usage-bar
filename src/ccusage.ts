import { exec } from "child_process";

/** Bloco de sessão (5h) retornado por `ccusage blocks --active --json`. */
export interface CcusageBlock {
  startTime: string;
  endTime: string;
  actualEndTime?: string;
  isActive: boolean;
  costUSD: number;
  totalTokens: number;
  entries: number;
  models: string[];
  tokenCounts?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  burnRate?: {
    costPerHour?: number;
    tokensPerMinute?: number;
  };
  projection?: {
    remainingMinutes?: number;
    totalCost?: number;
    totalTokens?: number;
  };
}

/** Resultado normalizado pronto para a UI. */
export interface CcusageData {
  available: true;
  /** Início/fim do bloco de 5h em epoch ms. */
  startMs: number;
  endMs: number;
  /** Minutos restantes até o bloco resetar. */
  remainingMinutes: number;
  /** % de TEMPO já decorrido do bloco de 5h (0-100). */
  timePct: number;
  costUSD: number;
  totalTokens: number;
  model: string;
  burnCostPerHour: number | null;
  /** Ritmo de tokens por minuto (do burnRate do ccusage). */
  tokensPerMinute: number | null;
  projectedCost: number | null;
  /** Total de tokens projetado para o fim do bloco. */
  projectedTokens: number | null;
  tokenCounts: CcusageBlock["tokenCounts"];
}
export interface CcusageUnavailable {
  available: false;
  reason: string;
}
export type CcusageResult = CcusageData | CcusageUnavailable;

/** Comando configurável (default usa npx). */
export function runCcusage(
  command: string,
  timeoutMs = 15000
): Promise<CcusageResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve({
            available: false,
            reason: err.message.split("\n")[0] || "falha ao executar ccusage",
          });
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const block: CcusageBlock | undefined = parsed?.blocks?.find(
            (b: CcusageBlock) => b.isActive
          );
          if (!block) {
            resolve({ available: false, reason: "nenhum bloco ativo" });
            return;
          }
          const startMs = Date.parse(block.startTime);
          const endMs = Date.parse(block.endTime);
          const now = Date.now();
          const total = Math.max(1, endMs - startMs);
          const elapsed = Math.min(total, Math.max(0, now - startMs));
          const timePct = (elapsed / total) * 100;
          const remainingMinutes =
            block.projection?.remainingMinutes ??
            Math.max(0, Math.round((endMs - now) / 60000));
          resolve({
            available: true,
            startMs,
            endMs,
            remainingMinutes,
            timePct,
            costUSD: block.costUSD ?? 0,
            totalTokens: block.totalTokens ?? 0,
            model: block.models?.[block.models.length - 1] ?? "",
            burnCostPerHour: block.burnRate?.costPerHour ?? null,
            tokensPerMinute: block.burnRate?.tokensPerMinute ?? null,
            projectedCost: block.projection?.totalCost ?? null,
            projectedTokens: block.projection?.totalTokens ?? null,
            tokenCounts: block.tokenCounts,
          });
        } catch (e) {
          resolve({
            available: false,
            reason: "saída do ccusage não é JSON válido",
          });
        }
      }
    );
  });
}
