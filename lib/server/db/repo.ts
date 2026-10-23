// Each business's data as one versioned document, written with compare-and-swap (KTD1). Domain code stays pure:
// mutate loads the document, runs the same lib/domain.ts or lib/ops.ts function on it, and saves only if no other
// write landed in between. Every read and write takes the tenant id and filters on it (R16).
import { and, eq } from "drizzle-orm";
import { BUSINESS } from "@/lib/config";
import { DATA_VERSION, buildSeed } from "@/lib/seed";
import type { Data } from "@/lib/types";
import { type Db, getDb } from "./client";
import { tenantState, tenants } from "./schema";

// The one business the demo runs (KTD12).
export const DEMO_TENANT = "sunrise-sunset";

// Tries per mutate before it returns a conflict. One truck writes rarely, so losing five races in a row means
// something is wrong, and the caller should fail loudly (409) instead of retrying forever.
export const MUTATE_ATTEMPTS = 5;

export interface TenantDoc {
  version: number;
  data: Data;
}

export type MutateResult<T> =
  | { ok: true; value: T; version: number; data: Data }
  | { ok: false; reason: "conflict" | "not_found" };

export interface RepoOptions {
  production?: boolean;
  // Test seam: runs after fn and before the save, so a test can land another write in between.
  beforeSave?: (attempt: number) => Promise<void>;
}

export type Repo = ReturnType<typeof createRepo>;

export function createRepo(db: Db, opts: RepoOptions = {}) {
  const production = opts.production ?? process.env.NODE_ENV === "production";

  async function read(tenantId: string) {
    const [row] = await db
      .select({ version: tenantState.version, dataVersion: tenantState.dataVersion, data: tenantState.data })
      .from(tenantState)
      .where(eq(tenantState.tenantId, tenantId));
    return row;
  }

  // Saves d only if the stored version is still `version`. Returns the new version, or null when another write won.
  async function save(tenantId: string, version: number, d: Data) {
    const [row] = await db
      .update(tenantState)
      .set({ version: version + 1, dataVersion: d.version, data: d, updatedAt: new Date() })
      .where(and(eq(tenantState.tenantId, tenantId), eq(tenantState.version, version)))
      .returning({ version: tenantState.version });
    return row?.version ?? null;
  }

  // The tenant's document, or null for an unknown tenant. Outside production, a demo document from an older
  // DATA_VERSION is replaced with a fresh seed, as the browser store does. Production refuses to serve one: its
  // data is real, so it needs a migration, not a reseed.
  async function load(tenantId: string): Promise<TenantDoc | null> {
    for (let attempt = 1; attempt <= MUTATE_ATTEMPTS; attempt++) {
      const row = await read(tenantId);
      if (!row) return null;
      if (row.dataVersion === DATA_VERSION) return { version: row.version, data: row.data };
      if (production || tenantId !== DEMO_TENANT) {
        throw new Error(`Tenant ${tenantId} holds data version ${row.dataVersion}, but this code needs ${DATA_VERSION}. Migrate the document first.`);
      }
      const seeded = buildSeed();
      const version = await save(tenantId, row.version, seeded);
      if (version !== null) return { version, data: seeded };
    }
    throw new Error(`Tenant ${tenantId} kept changing while it was reseeded.`);
  }

  // Applies fn to the tenant's document and saves the result. fn must be synchronous and must not call the model
  // or the network (KTD10): on a conflict it runs again on the fresh document, so it has to be cheap and repeatable.
  // An error from fn (a domain refusal) propagates, and nothing is saved.
  async function mutate<T>(tenantId: string, fn: (d: Data) => T): Promise<MutateResult<T>> {
    for (let attempt = 1; attempt <= MUTATE_ATTEMPTS; attempt++) {
      const cur = await load(tenantId);
      if (!cur) return { ok: false, reason: "not_found" };
      const value = fn(cur.data);
      if (value instanceof Promise) throw new Error("repo.mutate needs a synchronous function (KTD10).");
      await opts.beforeSave?.(attempt);
      const version = await save(tenantId, cur.version, cur.data);
      if (version !== null) return { ok: true, value, version, data: cur.data };
    }
    return { ok: false, reason: "conflict" };
  }

  // Adds a tenant with its first document. False when the tenant already exists, so a second start never reseeds.
  function create(tenantId: string, name: string, data: Data) {
    return db.transaction(async (tx) => {
      const added = await tx.insert(tenants).values({ id: tenantId, name }).onConflictDoNothing().returning({ id: tenants.id });
      if (added.length === 0) return false;
      await tx.insert(tenantState).values({ tenantId, version: 1, dataVersion: data.version, data });
      return true;
    });
  }

  // The first start seeds the demo business from lib/seed.ts. Later starts find it and leave it alone.
  async function seedDemo(now = new Date()) {
    if (await read(DEMO_TENANT)) return false;
    return create(DEMO_TENANT, BUSINESS.name, buildSeed(now));
  }

  return { load, mutate, create, seedDemo };
}

// The app's repo on the process-wide database, with the demo business seeded on first use.
let ready: Promise<Repo> | undefined;

export function getRepo(): Promise<Repo> {
  ready ??= getDb()
    .then(async (db) => {
      const repo = createRepo(db);
      await repo.seedDemo();
      return repo;
    })
    .catch((err) => {
      ready = undefined;
      throw err;
    });
  return ready;
}
