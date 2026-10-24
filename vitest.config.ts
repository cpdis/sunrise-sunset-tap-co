import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `--mode eval` runs the live-model evals (tests/*.eval.ts) instead of the unit tests.
export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // tsconfig keeps JSX for Next to compile; tests that import a component need it compiled here.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: [mode === "eval" ? "tests/**/*.eval.ts" : "tests/**/*.test.ts"] },
}));
