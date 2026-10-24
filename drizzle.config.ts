import { defineConfig } from "drizzle-kit";

// `npm run db:generate` turns schema changes into a SQL migration in drizzle/. It reads only the schema, no database.
// The app applies these migrations to the local PGlite database itself (lib/server/db/client.ts).
// Migrations are applied by scripts/migrate.mjs (`npm run db:migrate`, and `vercel-build` on every Vercel deploy).

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/server/db/schema.ts",
  out: "./drizzle",
});
