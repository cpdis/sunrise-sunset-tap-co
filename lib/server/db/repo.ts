// Each business's data as one versioned document, written with compare-and-swap (KTD1). Domain code stays pure:
// mutate loads the document, runs the same lib/domain.ts or lib/ops.ts function on it, and saves only if no other
// write landed in between. Every read and write takes the tenant id and filters on it (R16).
import { and, desc, eq, like, lt, notLike, sql } from "drizzle-orm";
import { BUSINESS } from "@/lib/config";
import { DATA_VERSION, buildSeed } from "@/lib/seed";
import type { Data } from "@/lib/types";
import { uid } from "@/lib/util";
import { drain } from "../outbox";
import { type Db, getDb } from "./client";
import { approvals, idempotencyKeys, outbox, rateLimits, tenantState, tenants } from "./schema";

// The one business the demo runs (KTD12).
export const DEMO_TENANT = "sunrise-sunset";

// Inbound message ids are idempotency keys under this prefix (lib/server/inbound.ts). They are kept INBOUND_DAYS, not
// the day other keys get, so a captured webhook can't be replayed the next day (SS-10).
export const INBOUND_KEYS = "inbound:";
export const INBOUND_DAYS = 30;
// The simulated outbox keeps a week of mail (A6).
export const OUTBOX_DAYS = 7;

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
  // The key was used before: the first run's stored result, and the request digest it was stored under.
  | { ok: true; replay: true; value: unknown; request: string }
  | { ok: false; reason: "conflict" | "not_found" };

export type OutboxMessage = Pick<typeof outbox.$inferSelect, "channel" | "to" | "subject" | "body">;

export type ApprovalRow = typeof approvals.$inferSelect;
export type NewApprovalRow = Omit<typeof approvals.$inferInsert, "tenantId" | "conversationId" | "status">;

// What one owner turn writes to its conversation's approvals (mutateApprovals).
export interface ApprovalWrites {
  // A staged approval to consume. If another write got to it first, the whole write runs again on fresh data.
  consume?: string;
  close?: { id: string; status: "cancelled" | "invalidated" | "expired" }[];
  // A wrong one-time code for a staged approval: counted on the row, which closes when the count reaches `tries` (B1).
  // One statement, so concurrent wrong codes can't both slip under the limit.
  codeMiss?: { id: string; tries: number };
  // A new staged approval. It replaces any other still staged in the conversation.
  add?: NewApprovalRow;
}

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
  // The messages the change queued (lib/ops.ts send) come off the document and go to the outbox with the save, so
  // `q` must be a transaction whenever d may have queued any.
  async function save(tenantId: string, version: number, d: Data, q: Db = db) {
    const sent = drain(d);
    const [row] = await q
      .update(tenantState)
      .set({ version: version + 1, dataVersion: d.version, data: d, updatedAt: new Date() })
      .where(and(eq(tenantState.tenantId, tenantId), eq(tenantState.version, version)))
      .returning({ version: tenantState.version });
    if (row && sent.length) await q.insert(outbox).values(sent.map((m) => ({ id: uid("ob"), tenantId, ...m })));
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
      const version = await db.transaction((tx) => save(tenantId, cur.version, cur.data, tx));
      if (version !== null) return { ok: true, value, version, data: cur.data };
    }
    return { ok: false, reason: "conflict" };
  }

  // Like mutate, but runs at most once per tenant and key (a command's idempotency key). The result is stored in the
  // same transaction as the save, with `request`, the caller's digest of what was asked, so a retry with the key gets
  // the first run's result and digest back and changes nothing. A document fn leaves unchanged is not saved. Keys older
  // than a day are pruned, except inbound message ids (prune).
  async function mutateOnce<T>(tenantId: string, key: string, command: string, request: string, fn: (d: Data) => T): Promise<OnceResult<T>> {
    const byKey = and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key));
    for (let attempt = 1; attempt <= MUTATE_ATTEMPTS; attempt++) {
      try {
        return await db.transaction(async (tx): Promise<OnceResult<T>> => {
          const cur = await load(tenantId, tx);
          if (!cur) return { ok: false, reason: "not_found" };
          const [prior] = await tx.select({ request: idempotencyKeys.request, result: idempotencyKeys.result }).from(idempotencyKeys).where(byKey);
          if (prior) return { ok: true, replay: true, value: prior.result, request: prior.request };
          const before = JSON.stringify(cur.data);
          const value = fn(cur.data);
          if (value instanceof Promise) throw new Error("repo.mutateOnce needs a synchronous function (KTD10).");
          if (JSON.stringify(cur.data) !== before && (await save(tenantId, cur.version, cur.data, tx)) === null) throw LOST_RACE;
          // A concurrent run with the same key that committed first wins, and the retry returns its result.
          const kept = await tx.insert(idempotencyKeys).values({ tenantId, key, command, request, result: value ?? {} }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
          if (kept.length === 0) throw LOST_RACE;
          await tx
            .delete(idempotencyKeys)
            .where(and(eq(idempotencyKeys.tenantId, tenantId), notLike(idempotencyKeys.key, `${INBOUND_KEYS}%`), lt(idempotencyKeys.createdAt, sql`now() - interval '1 day'`)));
          return { ok: true, replay: false, value };
        });
      } catch (err) {
        if (err !== LOST_RACE) throw err;
      }
    }
    return { ok: false, reason: "conflict" };
  }

  // One conversation's approvals that are still staged, newest first. Expired ones too: the caller compares
  // expiresAt with its own clock.
  function stagedApprovals(tenantId: string, conversationId: string) {
    return db
      .select()
      .from(approvals)
      .where(and(eq(approvals.tenantId, tenantId), eq(approvals.conversationId, conversationId), eq(approvals.status, "staged")))
      .orderBy(desc(approvals.createdAt));
  }

  // One owner's approvals that are still staged, in every conversation.
  function ownerApprovals(tenantId: string, ownerId: string) {
    return db
      .select()
      .from(approvals)
      .where(and(eq(approvals.tenantId, tenantId), eq(approvals.ownerId, ownerId), eq(approvals.status, "staged")))
      .orderBy(desc(approvals.createdAt));
  }

  // Like mutate, with one conversation's staged approvals (KTD4). fn sees them, read again on every try, and says
  // what to write to them. Those writes and the document's compare-and-swap save commit in one transaction, so an
  // approval is consumed exactly when its actions are saved. A consume that another write got to first rolls it all
  // back and runs fn again, on data where that approval is gone.
  async function mutateApprovals<T>(tenantId: string, conversationId: string, fn: (d: Data, staged: ApprovalRow[]) => { value: T; writes?: ApprovalWrites }): Promise<MutateResult<T>> {
    const staged = (id: string) => and(eq(approvals.tenantId, tenantId), eq(approvals.id, id), eq(approvals.status, "staged"));
    for (let attempt = 1; attempt <= MUTATE_ATTEMPTS; attempt++) {
      const cur = await load(tenantId);
      if (!cur) return { ok: false, reason: "not_found" };
      const out = fn(cur.data, await stagedApprovals(tenantId, conversationId));
      if (out instanceof Promise) throw new Error("repo.mutateApprovals needs a synchronous function (KTD10).");
      const w = out.writes ?? {};
      await opts.beforeSave?.(attempt);
      try {
        const version = await db.transaction(async (tx) => {
          if (w.consume) {
            const used = await tx
              .update(approvals)
              .set({ status: "consumed", consumedAt: new Date() })
              .where(and(staged(w.consume), eq(approvals.conversationId, conversationId)))
              .returning({ id: approvals.id });
            if (used.length === 0) throw LOST_RACE;
          }
          for (const c of w.close ?? []) await tx.update(approvals).set({ status: c.status }).where(staged(c.id));
          if (w.codeMiss) {
            const misses = sql`${approvals.codeMisses} + 1`;
            await tx
              .update(approvals)
              .set({ codeMisses: misses, status: sql`case when ${misses} >= ${w.codeMiss.tries} then 'cancelled' else ${approvals.status} end` })
              .where(staged(w.codeMiss.id));
          }
          if (w.add) {
            await tx
              .update(approvals)
              .set({ status: "cancelled" })
              .where(and(eq(approvals.tenantId, tenantId), eq(approvals.conversationId, conversationId), eq(approvals.status, "staged")));
            await tx.insert(approvals).values({ ...w.add, tenantId, conversationId });
          }
          const v = await save(tenantId, cur.version, cur.data, tx);
          if (v === null) throw LOST_RACE;
          return v;
        });
        return { ok: true, value: out.value, version, data: cur.data };
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

  // Adds `by` to a counter's window (KTD8) and returns its new count. The first hit of a window also drops the
  // tenant's windows older than two days, so the table stays small.
  async function bump(tenantId: string, bucket: string, windowStart: Date, by = 1) {
    const [row] = await db
      .insert(rateLimits)
      .values({ tenantId, bucket, windowStart, count: by })
      .onConflictDoUpdate({ target: [rateLimits.tenantId, rateLimits.bucket, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + ${by}` } })
      .returning({ count: rateLimits.count });
    if (row.count === by) await db.delete(rateLimits).where(and(eq(rateLimits.tenantId, tenantId), lt(rateLimits.windowStart, new Date(windowStart.getTime() - 2 * 86_400_000))));
    return row.count;
  }

  // A counter's count in one window, 0 when nothing was counted.
  async function counted(tenantId: string, bucket: string, windowStart: Date) {
    const [row] = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(and(eq(rateLimits.tenantId, tenantId), eq(rateLimits.bucket, bucket), eq(rateLimits.windowStart, windowStart)));
    return row?.count ?? 0;
  }

  // The simulated outbox: what would have gone out by SMS or email, newest first.
  async function writeOutbox(tenantId: string, m: OutboxMessage) {
    await db.insert(outbox).values({ id: uid("ob"), tenantId, ...m });
  }

  // Writes m in place of every earlier message to the same address with the same subject, such as an owner's older
  // sign-in links. The outbox keeps only the newest (A6), so asking for links again and again can't bury the rest.
  async function replaceOutbox(tenantId: string, m: OutboxMessage & { subject: string }) {
    await db.transaction(async (tx) => {
      await tx.delete(outbox).where(and(eq(outbox.tenantId, tenantId), eq(outbox.to, m.to), eq(outbox.subject, m.subject)));
      await tx.insert(outbox).values({ id: uid("ob"), tenantId, ...m });
    });
  }

  function readOutbox(tenantId: string, limit = 50) {
    return db.select().from(outbox).where(eq(outbox.tenantId, tenantId)).orderBy(desc(outbox.createdAt)).limit(limit);
  }

  // The daily tidy-up (lib/server/jobs.ts): outbox rows older than OUTBOX_DAYS and inbound message ids older than
  // INBOUND_DAYS. Other idempotency keys go after a day (mutateOnce).
  async function prune(tenantId: string, now = new Date()) {
    const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
    await db.delete(outbox).where(and(eq(outbox.tenantId, tenantId), lt(outbox.createdAt, before(OUTBOX_DAYS))));
    await db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, tenantId), like(idempotencyKeys.key, `${INBOUND_KEYS}%`), lt(idempotencyKeys.createdAt, before(INBOUND_DAYS))));
  }

  // A business's own row: whether it is the demo (A1). Undefined for an unknown business.
  async function tenant(tenantId: string) {
    const [row] = await db.select({ demo: tenants.demo }).from(tenants).where(eq(tenants.id, tenantId));
    return row;
  }

  // Every business's id, for the scheduled jobs.
  async function tenantIds() {
    return (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
  }

  // Adds a tenant with its first document. False when the tenant already exists, so a second start never reseeds.
  // `demo` is for seedDemo only.
  function create(tenantId: string, name: string, data: Data, demo = false) {
    return db.transaction(async (tx) => {
      const added = await tx.insert(tenants).values({ id: tenantId, name, demo }).onConflictDoNothing().returning({ id: tenants.id });
      if (added.length === 0) return false;
      await tx.insert(tenantState).values({ tenantId, version: 1, dataVersion: data.version, data });
      return true;
    });
  }

  // The first start seeds the demo business from lib/seed.ts, the one business marked as the demo. Later starts find
  // it and leave it alone.
  async function seedDemo(now = new Date()) {
    if (await read(DEMO_TENANT)) return false;
    return create(DEMO_TENANT, BUSINESS.name, buildSeed(now), true);
  }

  return { load, mutate, mutateOnce, mutateApprovals, stagedApprovals, ownerApprovals, claimKey, bump, counted, writeOutbox, replaceOutbox, readOutbox, prune, tenant, tenantIds, create, seedDemo };
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
