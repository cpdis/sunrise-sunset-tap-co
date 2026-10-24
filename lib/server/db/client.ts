// The server database (KTD2). Hosted Postgres when DATABASE_URL is set. Otherwise, outside production, PGlite
// (Postgres compiled to WASM) in a local folder, so the demo and the tests need no account or server.
// next.config.ts keeps @electric-sql/pglite out of the bundle: bundled, it cannot find its WASM files.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

// What both drivers share, so the repo never knows which one it has.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Connection {
  db: Db;
  driver: "postgres" | "pglite";
  close: () => Promise<void>;
}

type Env = Partial<Record<"DATABASE_URL" | "NODE_ENV", string>>;

// Gitignored. Delete the folder to start the local demo from a fresh seed.
export const LOCAL_DB_DIR = path.join(process.cwd(), ".data", "pglite");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

// Opens a new connection. Tests pass dataDir "memory://" for a throwaway in-memory database.
// PGlite gets the migrations in drizzle/ on open. Hosted Postgres is migrated at deploy time instead, because
// serverless instances that start together would race to apply the same migration.
export async function connect(env: Env = process.env, dataDir = LOCAL_DB_DIR): Promise<Connection> {
  if (env.DATABASE_URL) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    return { db: drizzlePg(pool, { schema }), driver: "postgres", close: () => pool.end() };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. Production needs hosted Postgres; the local PGlite database runs only outside production.");
  }
  // PGlite does not create missing parent folders.
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  try {
    const db = drizzlePglite(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db, driver: "pglite", close: () => client.close() };
  } catch (err) {
    await client.close();
    throw err;
  }
}

// One connection per server process, opened on first use. It lives on globalThis because a dev hot reload runs
// this module again, and two PGlite instances on one folder silently lose each other's writes. A failed open is
// forgotten, so the next call tries again instead of returning the same error until a restart.
const g = globalThis as typeof globalThis & { __sstDb?: Promise<Connection> };

export async function getDb(): Promise<Db> {
  g.__sstDb ??= connect().catch((err) => {
    g.__sstDb = undefined;
    throw err;
  });
  return (await g.__sstDb).db;
}
