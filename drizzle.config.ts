import { defineConfig } from "drizzle-kit";

// `npm run db:generate` turns schema changes into a SQL migration in drizzle/. It reads only the schema, no database.
// The app applies these migrations to the local PGlite database itself (lib/server/db/client.ts).
// `npm run db:migrate` applies them to hosted Postgres, the database DATABASE_URL names. Run it before each deploy
// that adds a migration; the app never migrates hosted Postgres on its own.
const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/server/db/schema.ts",
  out: "./drizzle",
  ...(url && { dbCredentials: { url } }),
});
