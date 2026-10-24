// Applies the SQL migrations in drizzle/ to hosted Postgres. `npm run db:migrate` runs it by hand, and the
// `vercel-build` script runs it before every Vercel build, so a deploy migrates its own database first.
//
// Guards, because the running app never migrates and a wrong target is hard to undo:
// - Migrations take a direct connection: DATABASE_URL_UNPOOLED, else DATABASE_URL. When both are set they must name
//   the same Neon endpoint (the pooled host is the direct host plus "-pooler"), so a half-applied preview override
//   can't pair a branch URL with production's.
// - A Vercel preview build migrates only when PRODUCTION_DB_HOST is set and differs from its target host. Without
//   it the preview skips migrating rather than risk migrating production before main does.
// - One advisory lock per database, so two builds can't apply the same migration at once.
// Hostnames are printed (they are not secrets); full URLs and passwords never are.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const LOCK = 47110815; // any constant; shared by every run against the same database

const host = (url) => new URL(url).hostname.replace("-pooler", "");

function target() {
  const direct = process.env.DATABASE_URL_UNPOOLED;
  const pooled = process.env.DATABASE_URL;
  const url = direct || pooled;
  if (!url) throw new Error("DATABASE_URL is not set, so there is no database to migrate.");
  if (direct && pooled && host(direct) !== host(pooled)) {
    throw new Error(`DATABASE_URL (${host(pooled)}) and DATABASE_URL_UNPOOLED (${host(direct)}) name different databases.`);
  }
  return url;
}

async function main() {
  const url = target();
  const env = process.env.VERCEL_ENV;
  if (env && env !== "production") {
    const prod = process.env.PRODUCTION_DB_HOST?.replace("-pooler", "");
    if (!prod) {
      console.log(`migrate: skipped on a ${env} build (set PRODUCTION_DB_HOST to let previews migrate their own branch).`);
      return;
    }
    if (prod === host(url)) throw new Error(`A ${env} build is pointed at the production database (${prod}). Refusing to migrate.`);
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    console.log(`migrate: ${host(url)}`);
    await client.query("SELECT pg_advisory_lock($1)", [LOCK]);
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("migrate: done");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  // pg errors can name the host and user, never the password; print the message only.
  console.error(`migrate: failed: ${e.message}`);
  process.exit(1);
});
