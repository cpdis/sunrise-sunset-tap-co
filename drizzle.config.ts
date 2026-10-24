import { defineConfig } from "drizzle-kit";

// `npm run db:generate` turns schema changes into a SQL migration in drizzle/. It reads only the schema, no database.
// The app applies these migrations to the local PGlite database itself (lib/server/db/client.ts).
// `npm run db:migrate` applies them to hosted Postgres. On Vercel the `vercel-build` script runs it before every
// build, so each deploy migrates its own database first (Neon marks the URLs Sensitive, so they can't be pulled
// to run it by hand). The running app never migrates hosted Postgres, because serverless instances would race.
// Migrations take a direct connection: Neon's unpooled URL when present, else DATABASE_URL.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/server/db/schema.ts",
  out: "./drizzle",
  ...(url && { dbCredentials: { url } }),
});
