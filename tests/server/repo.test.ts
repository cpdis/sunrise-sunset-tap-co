import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test } from "vitest";
import { createHold, nextFreeDates } from "@/lib/domain";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, MUTATE_ATTEMPTS, type RepoOptions, createRepo } from "@/lib/server/db/repo";
import { tenantState, tenants } from "@/lib/server/db/schema";
import { DATA_VERSION } from "@/lib/seed";
import type { Data } from "@/lib/types";
import { addDays, todayISO } from "@/lib/util";
import { NOW, seed } from "../helpers";

// Each test gets its own in-memory PGlite with the migrations applied.
const open: Connection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function memoryDb() {
  const c = await connect({ NODE_ENV: "test" }, "memory://");
  open.push(c);
  return c.db;
}

async function demo(opts?: RepoOptions) {
  const db = await memoryDb();
  const repo = createRepo(db, opts);
  await repo.seedDemo(NOW);
  return { db, repo };
}

const note = (d: Data, text: string) => {
  d.jobs.push({ at: NOW.toISOString(), text });
  return d.jobs.length;
};

describe("repo.mutate (KTD1)", () => {
  test("two concurrent mutates on one tenant both apply, in order, with no lost write", async () => {
    const tries: number[] = [];
    const { repo } = await demo({ beforeSave: async (attempt) => void tries.push(attempt) });
    const before = (await repo.load(DEMO_TENANT))!;
    const results = await Promise.all(["first", "second"].map((t) => repo.mutate(DEMO_TENANT, (d) => note(d, t))));
    // Both loaded the same version, so the second save lost the race and ran again on the fresh document.
    expect(tries).toEqual([1, 1, 2]);
    const ok = results.map((r) => (r.ok ? r : null)).filter((r) => r !== null);
    expect(ok).toHaveLength(2);
    // The later save ran on top of the earlier one: it saw one more job.
    const [early, late] = ok.sort((a, b) => a.version - b.version);
    expect([early.version, late.version]).toEqual([before.version + 1, before.version + 2]);
    expect([early.value, late.value]).toEqual([before.data.jobs.length + 1, before.data.jobs.length + 2]);
    const after = (await repo.load(DEMO_TENANT))!;
    expect(after.version).toBe(before.version + 2);
    expect(after.data.jobs.slice(-2).map((j) => j.text).sort()).toEqual(["first", "second"]);
  });

  test("a function that throws leaves the version and data unchanged", async () => {
    const { repo } = await demo();
    const before = await repo.load(DEMO_TENANT);
    await expect(
      repo.mutate(DEMO_TENANT, (d) => {
        d.settings.deposit = 0;
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(await repo.load(DEMO_TENANT)).toEqual(before);
  });

  test("an async function is refused before anything is saved (KTD10)", async () => {
    const { repo } = await demo();
    const before = await repo.load(DEMO_TENANT);
    await expect(repo.mutate(DEMO_TENANT, async (d) => note(d, "late"))).rejects.toThrow(/synchronous/);
    expect(await repo.load(DEMO_TENANT)).toEqual(before);
  });

  test("a write between load and save costs one retry, and both writes survive", async () => {
    const db = await memoryDb();
    const other = createRepo(db);
    await other.seedDemo(NOW);
    const before = (await other.load(DEMO_TENANT))!;
    let runs = 0;
    const repo = createRepo(db, {
      beforeSave: async (attempt) => {
        if (attempt === 1) await other.mutate(DEMO_TENANT, (d) => note(d, "other writer"));
      },
    });
    const r = await repo.mutate(DEMO_TENANT, (d) => {
      runs++;
      return note(d, "ours");
    });
    expect(r.ok).toBe(true);
    expect(runs).toBe(2);
    const after = (await repo.load(DEMO_TENANT))!;
    expect(after.version).toBe(before.version + 2);
    expect(after.data.jobs.slice(-2).map((j) => j.text)).toEqual(["other writer", "ours"]);
  });

  test("a conflict on every try returns a conflict after the fixed number of tries", async () => {
    const db = await memoryDb();
    const other = createRepo(db);
    await other.seedDemo(NOW);
    const before = (await other.load(DEMO_TENANT))!;
    let runs = 0;
    let hooks = 0;
    const repo = createRepo(db, {
      beforeSave: async () => {
        hooks++;
        await other.mutate(DEMO_TENANT, (d) => note(d, "other writer"));
      },
    });
    const r = await repo.mutate(DEMO_TENANT, (d) => {
      runs++;
      return note(d, "ours");
    });
    expect(r).toEqual({ ok: false, reason: "conflict" });
    expect([runs, hooks]).toEqual([MUTATE_ATTEMPTS, MUTATE_ATTEMPTS]);
    const after = (await repo.load(DEMO_TENANT))!;
    expect(after.version).toBe(before.version + MUTATE_ATTEMPTS);
    expect(after.data.jobs.some((j) => j.text === "ours")).toBe(false);
  });

  test("two concurrent holds for one date make one hold and one refusal (R12)", async () => {
    const { repo } = await demo();
    const { data } = (await repo.load(DEMO_TENANT))!;
    const date = nextFreeDates(data, addDays(todayISO(NOW), 60), 1, false, NOW)[0];
    let runs = 0;
    const hold = (name: string, phone: string) =>
      repo.mutate(DEMO_TENANT, (d) => {
        runs++;
        return createHold(d, { date, block: 4, suburb: "Subiaco", name, phone, via: "web", agreed: true }, NOW).ref;
      });
    const results = await Promise.allSettled([hold("Ada Held", "0400 000 001"), hold("Bea Late", "0400 000 002")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    // Both holds went through on the same loaded version; the loser's retry saw the date taken.
    expect(runs).toBe(3);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.message).toMatch(/can't be booked/);
    const after = (await repo.load(DEMO_TENANT))!;
    expect(after.data.bookings.filter((b) => b.date === date && b.state !== "cancelled")).toHaveLength(1);
  });
});

describe("tenants (R16)", () => {
  test("a read for one tenant never returns another tenant's document", async () => {
    const { repo } = await demo();
    const theirs = seed();
    theirs.seq = 1;
    theirs.owners = theirs.owners.slice(0, 1);
    expect(await repo.create("other-business", "Other Business", theirs)).toBe(true);
    const ours = (await repo.load(DEMO_TENANT))!;
    expect(ours.data.seq).not.toBe(1);
    expect(ours.data.owners.length).toBeGreaterThan(1);
    expect((await repo.load("other-business"))!.data.owners).toHaveLength(1);

    await repo.mutate("other-business", (d) => note(d, "theirs only"));
    expect(await repo.load(DEMO_TENANT)).toEqual(ours);
    expect(await repo.load("nobody")).toBeNull();
    expect(await repo.mutate("nobody", (d) => note(d, "x"))).toEqual({ ok: false, reason: "not_found" });
  });

  test("a fresh database seeds the demo once, and a second start does not reseed", async () => {
    const db = await memoryDb();
    expect(await createRepo(db).seedDemo(NOW)).toBe(true);
    const repo = createRepo(db);
    await repo.mutate(DEMO_TENANT, (d) => note(d, "kept"));

    // A second start: a new repo on the same database.
    expect(await createRepo(db).seedDemo(NOW)).toBe(false);
    const after = (await repo.load(DEMO_TENANT))!;
    expect(after.version).toBe(2);
    expect(after.data.jobs.at(-1)?.text).toBe("kept");
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  test("an old demo document is reseeded outside production and refused in production", async () => {
    const { db, repo } = await demo();
    const old = (await repo.load(DEMO_TENANT))!;
    await db.update(tenantState).set({ dataVersion: DATA_VERSION - 1 }).where(eq(tenantState.tenantId, DEMO_TENANT));

    await expect(createRepo(db, { production: true }).load(DEMO_TENANT)).rejects.toThrow(/data version/);
    const [row] = await db.select().from(tenantState).where(eq(tenantState.tenantId, DEMO_TENANT));
    expect([row.version, row.dataVersion]).toEqual([old.version, DATA_VERSION - 1]);

    const fresh = (await repo.load(DEMO_TENANT))!;
    expect(fresh.version).toBe(old.version + 1);
    expect(fresh.data.version).toBe(DATA_VERSION);
  });
});

describe("database client (KTD2)", () => {
  test("production with no DATABASE_URL fails instead of using PGlite", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "sst-db-"));
    const dir = path.join(tmp, "pglite");
    try {
      await expect(connect({ NODE_ENV: "production" }, dir)).rejects.toThrow(/DATABASE_URL is not set/);
      expect(existsSync(dir)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test("a DATABASE_URL picks node-postgres", async () => {
    // Nothing listens here; the pool connects only on its first query, which this test never makes.
    const c = await connect({ NODE_ENV: "production", DATABASE_URL: "postgres://demo@127.0.0.1:1/none" });
    expect(c.driver).toBe("postgres");
    await c.close();
  });
});
