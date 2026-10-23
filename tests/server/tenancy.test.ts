import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as commandPOST } from "@/app/api/commands/route";
import { POST as confirmPOST } from "@/app/api/session/confirm/route";
import { GET as stateGET } from "@/app/api/state/route";
import { linkToken } from "@/lib/server/auth";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, createRepo } from "@/lib/server/db/repo";
import { approvals, idempotencyKeys, outbox, rateLimits, tenantState, tenants } from "@/lib/server/db/schema";
import { inboundWebhook } from "@/lib/server/inbound";
import { NOW, inboundReq, sessionFor } from "../helpers";

// R16: every record belongs to one business, and every read and write filters on it. Only the demo business is
// seeded; "nobody" is a business id that does not exist.

// The routes read the process-wide repo; here it is each test's in-memory one.
const h = vi.hoisted(() => ({ repo: undefined as unknown as Repo }));
vi.mock("@/lib/server/db/repo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/db/repo")>()), getRepo: async () => h.repo }));

const open: Connection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function setup() {
  const c = await connect({ NODE_ENV: "test" }, "memory://");
  open.push(c);
  const repo = createRepo(c.db);
  await repo.seedDemo(NOW);
  h.repo = repo;
  // Every row in every table, to show a refused request wrote nothing anywhere.
  const everything = async () => {
    const all = await Promise.all([tenants, tenantState, approvals, rateLimits, idempotencyKeys, outbox].map((t) => c.db.select().from(t)));
    return JSON.stringify(all);
  };
  return { repo, everything };
}

const NOBODY = "nobody";
const BASE = "http://localhost:3000";
const cookieFor = (tenant: string, ownerId = "own_colin") => sessionFor(ownerId, { tenant });

describe("an unknown business id (R16)", () => {
  test("a command for it returns 404 and changes nothing", async () => {
    const { everything } = await setup();
    const before = await everything();
    const res = await commandPOST(
      new Request(`${BASE}/api/commands`, {
        method: "POST",
        headers: { origin: BASE, host: "localhost:3000", "content-type": "application/json", cookie: cookieFor(NOBODY) },
        body: JSON.stringify({ command: "addExpense", args: { date: "2026-10-20", account: "fuel", amount: 5, memo: "x" }, key: randomUUID() }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await everything()).toBe(before);
  });

  test("a state read for it returns 404 and changes nothing", async () => {
    const { everything } = await setup();
    const before = await everything();
    const res = await stateGET(new Request(`${BASE}/api/state`, { headers: { host: "localhost:3000", cookie: cookieFor(NOBODY) } }));
    expect(res.status).toBe(404);
    expect(await everything()).toBe(before);
  });

  test("a sign-in link for it opens nothing and changes nothing", async () => {
    const { everything } = await setup();
    const before = await everything();
    const res = await confirmPOST(
      new Request(`${BASE}/api/session/confirm`, {
        method: "POST",
        headers: { origin: BASE, host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ token: linkToken({ tenant: NOBODY, ownerId: "own_colin" }) }),
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await everything()).toBe(before);
  });

  test("a signed inbound message to a line no business owns returns 404 and changes nothing", async () => {
    const { everything } = await setup();
    const before = await everything();
    const sms = await inboundWebhook("sms", inboundReq("sms", { To: "0400 000 000", From: "0412 999 001", Body: "Is Saturday free?" }));
    const email = await inboundWebhook("email", inboundReq("email", { To: "hello@nobody.example", From: "a@b.example", Body: "Is Saturday free?" }));
    expect([sms.status, email.status]).toEqual([404, 404]);
    expect(await everything()).toBe(before);
  });
});

describe("repo reads filter on the business id (R16)", () => {
  test("a read with the wrong business id returns none of the demo business's rows", async () => {
    const { repo } = await setup();
    const window = new Date("2026-10-22T04:00:00Z");
    // One row of each kind under the demo business.
    await repo.writeOutbox(DEMO_TENANT, { channel: "sms", to: "0412 999 001", subject: null, body: "Demo only" });
    await repo.bump(DEMO_TENANT, "tenant", window);
    expect(await repo.claimKey(DEMO_TENANT, "link:abc", "sign_in")).toBe(true);
    const staged = await repo.mutateApprovals(DEMO_TENANT, "conv_1", () => ({
      value: undefined,
      writes: {
        add: { id: "apr_1", ownerId: "own_colin", tool: "add_expense", args: {}, summary: "x", binding: "[]", nonce: "1234", policyVersion: 1, expiresAt: new Date(NOW.getTime() + 600_000) },
      },
    }));
    expect(staged.ok).toBe(true);

    // The demo business sees them.
    expect(await repo.load(DEMO_TENANT)).not.toBeNull();
    expect(await repo.readOutbox(DEMO_TENANT)).toHaveLength(1);
    expect(await repo.counted(DEMO_TENANT, "tenant", window)).toBe(1);
    expect(await repo.stagedApprovals(DEMO_TENANT, "conv_1")).toHaveLength(1);
    expect(await repo.ownerApprovals(DEMO_TENANT, "own_colin")).toHaveLength(1);

    // Any other business id sees nothing.
    expect(await repo.load(NOBODY)).toBeNull();
    expect(await repo.tenant(NOBODY)).toBeUndefined();
    expect(await repo.readOutbox(NOBODY)).toEqual([]);
    expect(await repo.counted(NOBODY, "tenant", window)).toBe(0);
    expect(await repo.stagedApprovals(NOBODY, "conv_1")).toEqual([]);
    expect(await repo.ownerApprovals(NOBODY, "own_colin")).toEqual([]);

    // And cannot consume the demo business's approval or reuse its key.
    expect(await repo.mutateApprovals(NOBODY, "conv_1", () => ({ value: undefined, writes: { consume: "apr_1" } }))).toEqual({ ok: false, reason: "not_found" });
    expect(await repo.mutateOnce(NOBODY, "link:abc", "sign_in", () => undefined)).toEqual({ ok: false, reason: "not_found" });
    expect(await repo.stagedApprovals(DEMO_TENANT, "conv_1")).toHaveLength(1);

    // Nor prune its outbox or inbound message ids, however late the clock.
    expect(await repo.claimKey(DEMO_TENANT, "inbound:sms:SM1", "inbound_sms")).toBe(true);
    await repo.prune(NOBODY, new Date("2100-01-01"));
    expect(await repo.readOutbox(DEMO_TENANT)).toHaveLength(1);
    expect(await repo.claimKey(DEMO_TENANT, "inbound:sms:SM1", "inbound_sms")).toBe(false);
  });
});
