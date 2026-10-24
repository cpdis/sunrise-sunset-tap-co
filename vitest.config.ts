import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `--mode eval` runs the live-model evals (tests/*.eval.ts) instead of the unit tests.
export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // tsconfig keeps JSX for Next to compile; tests that import a component need it compiled here.
  oxc: { jsx: { runtime: "automatic" } },
  // Each server test opens its own PGlite database (about 2.5 s on a CI runner), so a test that also sends
  // twenty-odd messages passes 5 s under load. 20 s keeps a real hang visible.
  test: { include: [mode === "eval" ? "tests/**/*.eval.ts" : "tests/**/*.test.ts"], testTimeout: 20_000 },
}));
