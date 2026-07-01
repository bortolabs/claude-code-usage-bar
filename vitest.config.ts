import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Os módulos importam `vscode` (via i18n) — fora do host, usa o mock.
      vscode: path.resolve(__dirname, "test/mocks/vscode.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
