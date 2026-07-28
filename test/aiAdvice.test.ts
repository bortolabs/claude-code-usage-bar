import { describe, expect, it } from "vitest";
import { pickRequestTimeoutMs } from "../src/aiAdvice";

/**
 * O timeout do request ao LLM é a única coisa entre "modelo local demorando o que ele
 * demora" e "Falha no AI advice: timeout". Como a chamada não usa streaming, o socket fica
 * ocioso o tempo inteiro da geração — daí os 10min locais. Este teste trava os dois valores
 * e, sobretudo, o reconhecimento do host local (que já errou o IPv6 uma vez).
 */
describe("pickRequestTimeoutMs", () => {
  const t = (u: string) => pickRequestTimeoutMs(new URL(u));

  it("endpoint local → 10min (geração no LM Studio/Ollama leva minutos)", () => {
    expect(t("http://localhost:11434/v1/chat/completions")).toBe(600000);
    expect(t("http://127.0.0.1:11434/v1/chat/completions")).toBe(600000);
    expect(t("http://localhost/v1/chat/completions")).toBe(600000);
    expect(t("https://127.0.0.1:8443/v1/chat/completions")).toBe(600000);
  });

  it("IPv6 local conta como local — `URL.hostname` devolve com colchetes", () => {
    // new URL("http://[::1]:11434/").hostname === "[::1]", não "::1". Comparar com
    // "::1" puro nunca casa, e o endpoint caía nos 2min do remoto.
    expect(new URL("http://[::1]:11434/v1/chat/completions").hostname).toBe("[::1]");
    expect(t("http://[::1]:11434/v1/chat/completions")).toBe(600000);
    expect(t("http://[::1]/v1/chat/completions")).toBe(600000);
  });

  it("endpoint remoto → 2min (lá, lentidão é falha e não geração)", () => {
    expect(t("https://api.anthropic.com/v1/messages")).toBe(120000);
    expect(t("https://api.openai.com/v1/chat/completions")).toBe(120000);
  });

  it("LLM em outra máquina da LAN conta como remoto (decisão, não descuido)", () => {
    // O timeout longo existe para geração na PRÓPRIA máquina. Um Ollama na LAN passa
    // por rede e cai nos 2min; se um dia isso incomodar, vira setting — não regra implícita.
    expect(t("http://192.168.1.50:11434/v1/chat/completions")).toBe(120000);
    expect(t("http://meu-mac.local:11434/v1/chat/completions")).toBe(120000);
  });
});
