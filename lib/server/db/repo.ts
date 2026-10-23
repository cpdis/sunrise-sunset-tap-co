// Each business's data as one versioned document, written with compare-and-swap (KTD1). Domain code stays pure:
// mutate loads the document, runs the same lib/domain.ts or lib/ops.ts function on it, and saves only if no other
// write landed in between. Every read and write takes the tenant id and filters on it (R16).
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { BUSINESS } from "@/lib/config";
import { DATA_VERSION, buildSeed } from "@/lib/seed";
import type { Data } from "@/lib/types";
import { uid } from "@/lib/util";
import { type Db, getDb } from "./client";
import { idempotencyKeys, outbox, tenantState, tenants } from "./schema";

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

export type OnceResult<T> =
  | { ok: true; replay: false; value: T }
  // The key was used before: the first run's stored result, and the command that ran it.
  | { ok: true; replay: true; value: unknown; command: string }
  | { ok: false; reason: "conflict" | "not_found" };

export type OutboxMessage = Pick<typeof outbox.$inferSelect, "channel" | "to" | "subject" | "body">;

// Thrown inside mutateOnce's transaction when another write won, to roll it back and try again.
const LOST_RACE = Symbol("lost race");

export interface RepoOptions {
  production?: boolean;
  // Test seam: runs after fn and before the save, so a test can land another write in between.
  beforeSave?: (attempt: number) => Promise<void>;
}

export type Repo = ReturnType<typeof createRepo>;

export function createRepo(db: Db, opts: RepoOptions = {}) {
  const production = opts.production ?? process.env.NODE_ENV === "production";

  // Each query takes `q`, the database or a transaction on it.
  async function read(tenantId: string, q: Db = db) {
    const [row] = await q
      .select({ version: tenantState.version, dataVersion: tenantState.dataVersion, data: tenantState.data })
      .from(tenantState)
      .where(eq(tenantState.tenantId, tenantId));
    return row;
  }

  // Saves d only if the stored version is still `version`. Returns the new version, or null when another write won.
  async function save(tenantId: string, version: number, d: Data, q: Db = db) {
    const [row] = await q
      .update(tenantState)
      .set({ version: version + 1, dataVersion: d.version, data: d, updatedAt: new Date() })
      .where(and(eq(tenantState.tenantId, tenantId), eq(tenantState.version, version)))
      .returning({ version: tenantState.version });
    return row?.version ?? null;
  }

  // The tenant's document, or null for an unknown tenant. Outside production, a demo document from an older
  // DATA_VERSION is replaced with a fresh seed, as the browser store does. Production refuses to serve one: its
  // data is real, so it needs a migration, not a reseed.
  async function load(tenantId: string, q: Db = db): Promise<TenantDoc | null> {
    for (let attempt = 1; attempt <= MUTATE_ATTEMPTS; attempt++) {
      const row = await read(tenantId, q);
      if (!row) return null;
      if (row.dataVersion === DATA_VERSION) return { version: row.version, data: row.data };
      if (production || tenantId !== DEMO_TENANT) {
        throw new Error(`Tenant ${tenantId} holds data version ${row.dataVersion}, but this code needs ${DATA_VERSION}. Migrate the document first.`);
      }
      const seeded = buildSeed();
      const version = await save(tenantId, row.version, seeded, q);
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

  // Like mutate, but runs at most once per tenant and key (a command's idempotency key). The result is stored in the
  // same transaction as the save, so a retry with the key gets the first run's result back and changes nothing.
  // A document fn leaves unchanged is not saved. Keys older than a day are pruned.
  async function mutateOnce<T>(tenantId: string, key: string, command: string, fn: (d: Data) => T): Promise<OnceResult<T>> {
    const byKey = and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key));
    for (let attempt = 1; attempt <= MUTATE_ATTEMPTS; attempt++) {
      try {
        return await db.transaction(async (tx): Promise<OnceResult<T>> => {
          const cur = await load(tenantId, tx);
          if (!cur) return { ok: false, reason: "not_found" };
          const [prior] = await tx.select({ command: idempotencyKeys.command, result: idempotencyKeys.result }).from(idempotencyKeys).where(byKey);
          if (prior) return { ok: true, replay: true, value: prior.result, command: prior.command };
          const before = JSON.stringify(cur.data);
          const value = fn(cur.data);
          if (value instanceof Promise) throw new Error("repo.mutateOnce needs a synchronous function (KTD10).");
          if (JSON.stringify(cur.data) !== before && (await save(tenantId, cur.version, cur.data, tx)) === null) throw LOST_RACE;
          // A concurrent run with the same key that committed first wins, and the retry returns its result.
          const kept = await tx.insert(idempotencyKeys).values({ tenantId, key, command, result: value ?? {} }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
          if (kept.length === 0) throw LOST_RACE;
          await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.tenantId, tenantId), lt(idempotencyKeys.createdAt, sql`now() - interval '1 day'`)));
          return { ok: true, replay: false, value };
        });
      } catch (err) {
        if (err !== LOST_RACE) throw err;
      }
    }
    return { ok: false, reason: "conflict" };
  }

  // Spends a one-time key, such as a sign-in link's nonce. True only the first time.
  async function claimKey(tenantId: string, key: string, command: string) {
    const kept = await db.insert(idempotencyKeys).values({ tenantId, key, command, result: {} }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
    return kept.length > 0;
  }

  // The simulated outbox: what would have gone out by SMS or email, newest first.
  async function writeOutbox(tenantId: string, m: OutboxMessage) {
    await db.insert(outbox).values({ id: uid("ob"), tenantId, ...m });
  }

  function readOutbox(tenantId: string, limit = 50) {
    return db.select().from(outbox).where(eq(outbox.tenantId, tenantId)).orderBy(desc(outbox.createdAt)).limit(limit);
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

  return { load, mutate, mutateOnce, claimKey, writeOutbox, readOutbox, create, seedDemo };
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
