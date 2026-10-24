import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // tsconfig keeps JSX for Next to compile; tests that import a component need it compiled here.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.ts"] },
});
