/**
 * Mock mínimo do módulo `vscode` para os testes (vitest roda fora do host).
 * Só o que os módulos puros tocam: `l10n.t` com substituição de {0}, {1}…
 * (o i18n.ts em modo "auto" delega pra cá; os testes validam LÓGICA, não tradução).
 */
export const l10n = {
  t: (message: string, ...args: (string | number | boolean)[]): string =>
    message.replace(/\{(\d+)\}/g, (_m, i) => {
      const v = args[Number(i)];
      return v === undefined ? "" : String(v);
    }),
};
