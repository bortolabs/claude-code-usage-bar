import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { tr } from "./i18n";
import { DashboardData } from "./dashboard";

/**
 * "AI advice" — relatório de coaching gerado por LLM (opt-in, BYO key).
 *
 * Envia os AGREGADOS do dashboard + uma AMOSTRA de prompts do próprio usuário pra
 * um endpoint configurável (Anthropic /v1/messages por padrão; estilo
 * OpenAI-compatível opcional) e abre o Markdown retornado num editor. A chave fica
 * no SecretStorage (nunca em setting). Confirmação explícita antes de enviar —
 * isto SAI da máquina, ao contrário do resto do plugin.
 *
 * Endpoint/headers/modelo conferidos com a skill claude-api (não de memória):
 *   POST https://api.anthropic.com/v1/messages
 *   headers: x-api-key, anthropic-version: 2023-06-01, content-type: application/json
 *   body: { model, max_tokens, system, messages:[{role:'user',content}] }
 *   modelo padrão: claude-opus-4-8 ; resposta: content[].text (blocos type:'text')
 */

const SECRET_KEY = "claudeUsageBar.aiAdviceApiKey";

interface AiAdviceConfig {
  endpoint: string;
  model: string;
  style: "anthropic" | "openai";
  promptWindowDays: number;
  maxPrompts: number;
  maxTokens: number;
}

function readConfig(): AiAdviceConfig {
  const c = vscode.workspace.getConfiguration("claudeUsageBar");
  const style = (c.get<string>("aiAdviceApiStyle") || "anthropic") === "openai" ? "openai" : "anthropic";
  return {
    endpoint:
      (c.get<string>("aiAdviceEndpoint") || "").trim() ||
      "https://api.anthropic.com/v1/messages",
    model: (c.get<string>("aiAdviceModel") || "").trim() || "claude-opus-4-8",
    style,
    promptWindowDays: c.get<number>("aiAdvicePromptWindowDays") ?? 30,
    maxPrompts: c.get<number>("aiAdviceMaxPrompts") ?? 40,
    maxTokens: 4096,
  };
}

/** Comando: grava/atualiza a chave da API no SecretStorage. */
export async function setAiAdviceKey(context: vscode.ExtensionContext): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: tr("Chave de API do AI advice"),
    prompt: tr(
      "API key paga do provedor (Anthropic sk-ant-… ou OpenAI-compatível) — separada da sua assinatura do Claude Code. Fica no cofre seguro (SecretStorage), nunca num setting."
    ),
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) {
    return; // cancelado
  }
  if (key.trim() === "") {
    await context.secrets.delete(SECRET_KEY);
    vscode.window.showInformationMessage(tr("Chave do AI advice removida."));
    return;
  }
  await context.secrets.store(SECRET_KEY, key.trim());
  vscode.window.showInformationMessage(tr("Chave do AI advice salva."));
}

/** Coleta uma amostra dos prompts do usuário (mensagens role:user) na janela. */
function sampleUserPrompts(windowDays: number, maxPrompts: number): string[] {
  const root = path.join(os.homedir(), ".claude", "projects");
  const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
  const out: string[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const files: { full: string; mtimeMs: number }[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.name.endsWith(".jsonl")) {
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs >= cutoff) {
            files.push({ full, mtimeMs: st.mtimeMs });
          }
        } catch {
          /* ignora */
        }
      }
    }
  };
  for (const d of dirs) {
    if (d.isDirectory()) {
      walk(path.join(root, d.name));
    }
  }
  // Mais recentes primeiro.
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of files) {
    if (out.length >= maxPrompts) {
      break;
    }
    let content: string;
    try {
      content = fs.readFileSync(f.full, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (out.length >= maxPrompts) {
        break;
      }
      if (!line || line.indexOf('"role":"user"') === -1) {
        continue;
      }
      let o: any;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o?.isSidechain === true) {
        continue; // ignora prompts de subagentes (ruído)
      }
      const msg = o?.message;
      if (!msg || msg.role !== "user") {
        continue;
      }
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b && b.type === "text" && typeof b.text === "string") {
            text += (text ? "\n" : "") + b.text;
          }
        }
      }
      text = text.trim();
      // Ignora resultados de tool e mensagens vazias/curtas.
      if (text.length < 12 || text.startsWith("<")) {
        continue;
      }
      out.push(text.length > 600 ? text.slice(0, 600) + "…" : text);
    }
  }
  return out;
}

/** Monta o conteúdo enviado ao LLM a partir dos agregados + amostra de prompts. */
function buildPrompt(d: DashboardData, prompts: string[]): { system: string; user: string } {
  const k = d.kpis;
  const lines: string[] = [];
  lines.push(`Window: ${d.window}`);
  lines.push(
    `Cost (approx, USD): ${k.costUSD.toFixed(2)} | Messages: ${k.messages} | ` +
      `Cache hit rate: ${Math.round(k.cacheHitRate)}%`
  );
  lines.push(
    `Tokens — input: ${k.input}, output: ${k.output}, cache_read: ${k.cacheRead}, cache_write: ${k.cacheWrite}`
  );
  const cb = d.costByType;
  lines.push(
    `Cost by token type (USD) — input: ${cb.input.toFixed(2)}, output: ${cb.output.toFixed(2)}, ` +
      `cache_read: ${cb.cacheRead.toFixed(2)}, cache_write: ${cb.cacheWrite.toFixed(2)}`
  );
  const top = <T,>(arr: T[], f: (x: T) => string, n = 5) => arr.slice(0, n).map(f).join("; ");
  if (d.byModel.length) {
    lines.push("By model: " + top(d.byModel, (m) => `${m.model}=$${m.costUSD.toFixed(2)}`));
  }
  if (d.byProject.length) {
    lines.push("By project: " + top(d.byProject, (p) => `${p.project}=$${p.costUSD.toFixed(2)}`));
  }
  if (d.byContext.length) {
    lines.push("By context size: " + top(d.byContext, (b) => `${b.bucket}=$${b.costUSD.toFixed(2)}`));
  }
  if (d.bySkill.length) {
    lines.push("Top skills: " + top(d.bySkill, (s) => `${s.name}×${s.calls}`));
  }
  if (d.byMcp.length) {
    lines.push("MCP servers: " + top(d.byMcp, (s) => `${s.name}×${s.calls}`));
  }
  if (d.insights.length) {
    lines.push("Local insights: " + d.insights.map((i) => i.text).join(" | "));
  }

  const promptBlock = prompts.length
    ? prompts.map((p, i) => `${i + 1}. ${p}`).join("\n")
    : "(no prompts sampled)";

  const system =
    "You are a coding-usage coach for a developer using Claude Code. You receive " +
    "aggregated, approximate usage stats and a sample of the developer's own prompts. " +
    "Write a concise, prioritized coaching report in Markdown that helps them reduce cost " +
    "and work more effectively. Be specific and actionable: cite the numbers, point at the " +
    "biggest cost drivers (output tokens, large context, Opus share, cache misses, fan-out), " +
    "and give concrete habits (/compact, /clear, model choice, prompt hygiene). " +
    "Respond in the same language as the sampled prompts. Do not invent data beyond what is given.";

  const user =
    "## Usage aggregates (approximate, local)\n" +
    lines.join("\n") +
    "\n\n## Sample of my recent prompts\n" +
    promptBlock +
    "\n\nWrite the coaching report now.";

  return { system, user };
}

/** Chamada HTTP ao endpoint do LLM. Retorna o texto da resposta. */
function callLLM(cfg: AiAdviceConfig, apiKey: string, system: string, user: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(cfg.endpoint);
    } catch {
      reject(new Error("endpoint inválido"));
      return;
    }
    const isAnthropic = cfg.style === "anthropic";
    const body = isAnthropic
      ? JSON.stringify({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        })
      : JSON.stringify({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    };
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["authorization"] = "Bearer " + apiKey;
    }
    // http p/ endpoints locais (Ollama/LM Studio em localhost), https p/ o resto.
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: url.pathname + url.search,
        headers,
        timeout: 120000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
            return;
          }
          try {
            const json = JSON.parse(raw);
            let text = "";
            if (isAnthropic) {
              // content: [{type:'text', text:'...'}]
              if (Array.isArray(json.content)) {
                for (const b of json.content) {
                  if (b && b.type === "text" && typeof b.text === "string") {
                    text += b.text;
                  }
                }
              }
            } else {
              text = json?.choices?.[0]?.message?.content || "";
            }
            if (!text) {
              reject(new Error("resposta vazia do modelo"));
            } else {
              resolve(text);
            }
          } catch (e) {
            reject(new Error("resposta não-JSON: " + raw.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(body);
    req.end();
  });
}

/** Comando principal: gera o relatório de coaching e abre num editor Markdown. */
export async function runAiAdvice(
  context: vscode.ExtensionContext,
  data: DashboardData | undefined
): Promise<void> {
  if (!data) {
    vscode.window.showInformationMessage(tr("Aguardando dados do Claude Code…"));
    return;
  }
  const cfg = readConfig();
  let apiKey = await context.secrets.get(SECRET_KEY);
  if (!apiKey) {
    const set = await vscode.window.showInformationMessage(
      tr("O AI advice precisa de uma chave de API (BYO). Configurar agora?"),
      tr("Configurar chave")
    );
    if (set) {
      await setAiAdviceKey(context);
      apiKey = await context.secrets.get(SECRET_KEY);
    }
    if (!apiKey) {
      return;
    }
  }

  // Confirmação explícita — isto envia dados pra fora da máquina.
  const proceed = await vscode.window.showWarningMessage(
    tr(
      "O AI advice vai ENVIAR seus agregados de uso + uma amostra dos seus prompts para {0}. Continuar?",
      cfg.endpoint
    ),
    { modal: true },
    tr("Enviar")
  );
  if (proceed !== tr("Enviar")) {
    return;
  }

  const prompts = sampleUserPrompts(cfg.promptWindowDays, cfg.maxPrompts);
  const { system, user } = buildPrompt(data, prompts);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: tr("Gerando AI advice…") },
    async () => {
      try {
        const md = await callLLM(cfg, apiKey as string, system, user);
        const doc = await vscode.workspace.openTextDocument({
          language: "markdown",
          content: md,
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (e) {
        vscode.window.showErrorMessage(
          tr("Falha no AI advice: {0}", String((e as Error)?.message ?? e))
        );
      }
    }
  );
}
