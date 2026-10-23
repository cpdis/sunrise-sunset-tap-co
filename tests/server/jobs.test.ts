import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET as jobsGET } from "@/app/api/jobs/route";
import { GET as outboxGET } from "@/app/api/outbox/route";
import { BUSINESS } from "@/lib/config";
import { balance, balanceDueDate, cashAt, createHold, heldFor, nextFreeDates, payDeposit } from "@/lib/domain";
import * as ops from "@/lib/ops";
import { agentTurn } from "@/lib/server/agent";
import { sessionCookie } from "@/lib/server/auth";
import { type Caller, runCommand } from "@/lib/server/commands";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, type RepoOptions, createRepo } from "@/lib/server/db/repo";
import { DEV_CRON_SECRET, cronSecret, jobsHandler } from "@/lib/server/jobs";
import { conversationUrl } from "@/lib/server/outbox";
import type { Booking, Data } from "@/lib/types";
import { addDays, todayISO } from "@/lib/util";
import { NOW } from "../helpers";

// The routes read the process-wide repo; here it is each test's in-memory one.
const h = vi.hoisted(() => ({ repo: undefined as unknown as Repo }));
vi.mock("@/lib/server/db/repo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/db/repo")>()), getRepo: async () => h.repo }));

const open: Connection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function setup(opts: RepoOptions = {}) {
  const c = await connect({ NODE_ENV: "test" }, "memory://");
  open.push(c);
  const repo = createRepo(c.db, opts);
  await repo.seedDemo(NOW);
  h.repo = repo;
  return repo;
}

const BASE = "http://localhost:3000";
const doc = async (repo: Repo) => (await repo.load(DEMO_TENANT))!;
const cron = (auth?: string) => new Request(`${BASE}/api/jobs`, { headers: auth === undefined ? {} : { authorization: auth } });
const owner = (ownerId = "own_colin"): Caller => ({ tenant: DEMO_TENANT, ownerId, demo: true, now: NOW });
const command = (repo: Repo, caller: Caller, name: string, args: object) => runCommand(repo, caller, { command: name, args, key: randomUUID() });

// A paid booking 30 days out with its deposit in, and the morning its balance falls due.
async function depositPaid(repo: Repo) {
  const r = await repo.mutate(DEMO_TENANT, (d) => {
    const date = nextFreeDates(d, addDays(todayISO(NOW), 30), 1, false, NOW)[0];
    const b = createHold(d, { date, block: 4, suburb: "Subiaco", name: "Jo Due", phone: "0400 000 321", via: "web", agreed: true }, NOW);
    payDeposit(d, b.id, "Visa •• 4242", NOW, true);
    return b.id;
  });
  if (!r.ok) throw new Error(r.reason);
  const b = r.data.bookings.find((x) => x.id === r.value)!;
  return { id: b.id, due: new Date(`${balanceDueDate(r.data.settings, b)}T06:00:00+08:00`) };
}

// The money a booking's balance touches, as the ledger and payments hold them.
function money(d: Data, id: string) {
  const b = d.bookings.find((x) => x.id === id) as Booking;
  return {
    state: b.state,
    balancePayments: d.payments.filter((p) => p.bookingId === id && p.type === "balance").length,
    heldForBooking: heldFor(d, id),
    deposits: balance(d, "deposits"),
    cash: cashAt(d),
    payoutRows: d.distributions.length,
  };
}

describe("the jobs route", () => {
  test("without its secret, or with a wrong one, it returns 401 and runs nothing", async () => {
    const repo = await setup();
    const before = (await doc(repo)).version;
    for (const auth of [undefined, "", "Bearer nope", DEV_CRON_SECRET, `Basic ${DEV_CRON_SECRET}`, `Bearer ${DEV_CRON_SECRET}x`]) {
      expect((await jobsGET(cron(auth))).status).toBe(401);
    }
    expect((await doc(repo)).version).toBe(before);
    expect((await jobsGET(cron(`Bearer ${DEV_CRON_SECRET}`))).status).toBe(200);
  });

  test("production needs CRON_SECRET; the dev default works only outside it", () => {
    expect(() => cronSecret({ NODE_ENV: "production" })).toThrow(/CRON_SECRET/);
    expect(cronSecret({ NODE_ENV: "production", CRON_SECRET: "real" })).toBe("real");
    expect(cronSecret({ NODE_ENV: "development" })).toBe(DEV_CRON_SECRET);
  });

  test("a balance due today is charged once when the route runs twice", async () => {
    const repo = await setup();
    const { id, due } = await depositPaid(repo);
    const before = money((await doc(repo)).data, id);
    const req = () => cron(`Bearer ${DEV_CRON_SECRET}`);
    const first = await (await jobsHandler(req(), async () => repo, due)).json();
    const once = money((await doc(repo)).data, id);
    const later = new Date(due.getTime() + 6 * 3_600_000);
    const second = await (await jobsHandler(req(), async () => repo, later)).json();
    const twice = money((await doc(repo)).data, id);

    expect(before).toMatchObject({ state: "confirmed", balancePayments: 0 });
    expect(once).toMatchObject({ state: "balance_paid", balancePayments: 1 });
    const b = (await doc(repo)).data.bookings.find((x) => x.id === id)!;
    expect(once.heldForBooking - before.heldForBooking).toBe(b.total - b.deposit);
    expect(first.runs[0].ran.some((t: string) => t.startsWith(`Charged balance`) && t.includes(b.ref))).toBe(true);
    // The second run the same day charges nothing and adds no payout row.
    expect(twice).toEqual(once);
    expect(second.runs[0].ran.some((t: string) => t.includes(b.ref))).toBe(false);
  });

  test("it runs for every business", async () => {
    const repo = await setup();
    await repo.create("other-truck", "Other Truck", (await doc(repo)).data);
    const out = await (await jobsHandler(cron(`Bearer ${DEV_CRON_SECRET}`), async () => repo, NOW)).json();
    expect(out.runs.map((r: { tenant: string }) => r.tenant).sort()).toEqual([DEMO_TENANT, "other-truck"].sort());
  });

  test("the demo's Run daily jobs now runs the same jobs, for an owner, in demo mode only", async () => {
    const repo = await setup();
    const { id, due } = await depositPaid(repo);
    await expect(command(repo, { tenant: DEMO_TENANT, demo: true, now: due }, "runJobs", {})).rejects.toMatchObject({ status: 401 });
    await expect(command(repo, { ...owner(), demo: false, now: due }, "runJobs", {})).rejects.toMatchObject({ status: 404 });
    const r = await command(repo, { ...owner(), now: due }, "runJobs", {});
    expect((r as { result: { ran: string[] } }).result.ran.some((t) => t.startsWith("Charged balance"))).toBe(true);
    expect(money((await doc(repo)).data, id)).toMatchObject({ state: "balance_paid", balancePayments: 1 });
  });

  test("the browser has no job command any more", async () => {
    const repo = await setup();
    await expect(command(repo, { tenant: DEMO_TENANT, demo: true, now: NOW }, "tick", {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("owner notifications", () => {
  const NEW = "0499 120 554";
  const say = (repo: Repo, body: string) => agentTurn(repo, { tenant: DEMO_TENANT, now: NOW }, { channel: "sms", contact: NEW, body }, { origin: BASE });

  test("an escalation writes exactly one owner notice: who, why and the conversation link", async () => {
    const repo = await setup();
    const before = (await repo.readOutbox(DEMO_TENANT)).length;
    const out = await say(repo, "can I talk to a person");
    expect(out.conversation.escalated).toBeTruthy();
    // The agent is off the conversation now; more texts wait for the owners and send no second notice.
    await say(repo, "hello?");
    await say(repo, "anyone there");
    const rows = await repo.readOutbox(DEMO_TENANT);
    expect(rows).toHaveLength(before + 1);
    const n = rows[0];
    expect(n).toMatchObject({ channel: "email", to: BUSINESS.email });
    expect(n.subject).toMatch(/needs an owner/);
    expect(n.body).toContain(NEW);
    expect(n.body).toContain(out.conversation.escalated!);
    expect(n.body).toContain(conversationUrl(out.conversation.id));
    // The customer is told an owner was notified, and nothing about when.
    expect(out.conversation.messages.findLast((m) => m.from === "agent")?.body).toMatch(/owner has been notified/);
  });

  test("a booking-page cancel over the limit notifies the owners once", async () => {
    const repo = await setup();
    const d = (await doc(repo)).data;
    const b = d.bookings.find((x) => x.kind === "paid" && x.state === "balance_paid" && x.date > todayISO(NOW))!;
    const before = (await repo.readOutbox(DEMO_TENANT)).length;
    // The refund limit is set low, so this cancel needs an owner.
    await command(repo, owner(), "updateSettings", { patch: { refundLimit: 0 } });
    for (let i = 0; i < 2; i++) await command(repo, { tenant: DEMO_TENANT, demo: true, now: NOW }, "customerCancel", { bookingId: b.id, token: b.token });
    const rows = await repo.readOutbox(DEMO_TENANT);
    expect(rows).toHaveLength(before + 1);
    expect(rows[0].subject).toMatch(/needs an owner/);
  });

  test("an owner's reply goes to the outbox as the SMS or email it would be", async () => {
    const repo = await setup();
    const d = (await doc(repo)).data;
    const sms = d.conversations.find((c) => !c.ownerId && !c.contact.includes("@") && c.contact)!;
    const mail = d.conversations.find((c) => !c.ownerId && c.contact.includes("@"))!;
    await command(repo, owner(), "ownerReply", { convId: sms.id, body: "Hi, Colin here. Happy to help." });
    await command(repo, owner(), "ownerReply", { convId: mail.id, body: "Hi, Colin here by email." });
    const [m2, m1] = await repo.readOutbox(DEMO_TENANT, 2);
    const both = [m1, m2].sort((x, y) => x.channel.localeCompare(y.channel));
    expect(both[0]).toMatchObject({ channel: "email", to: mail.contact, body: "Hi, Colin here by email." });
    expect(both[1]).toMatchObject({ channel: "sms", to: sms.contact, subject: null, body: "Hi, Colin here. Happy to help." });
    // The queue never reaches the stored document.
    expect((await doc(repo)).data.outgoing).toBeUndefined();
  });

  test("a change that loses a race sends once, and a refused change sends nothing", async () => {
    let raced = false;
    const repo: Repo = await setup({
      beforeSave: async (attempt) => {
        // The first save loses to another write, so the reply runs again on fresh data.
        if (attempt === 1 && !raced) {
          raced = true;
          await repo.mutate(DEMO_TENANT, (d) => ops.log(d, "another write"));
        }
      },
    });
    const c = (await doc(repo)).data.conversations.find((x) => !x.ownerId && x.contact)!;
    const before = (await repo.readOutbox(DEMO_TENANT)).length;
    const r = await repo.mutate(DEMO_TENANT, (d) => ops.ownerReply(d, c.id, "Once only", "own_colin"));
    expect(r.ok).toBe(true);
    expect(raced).toBe(true);
    await expect(
      repo.mutate(DEMO_TENANT, (d) => {
        ops.ownerReply(d, c.id, "Never sent", "own_colin");
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    const rows = await repo.readOutbox(DEMO_TENANT);
    expect(rows.length - before).toBe(1);
    expect(rows[0].body).toBe("Once only");
  });
});

describe("the owners' outbox view", () => {
  const get = (cookie?: string) => outboxGET(new Request(`${BASE}/api/outbox`, { headers: cookie ? { cookie } : {} }));
  const cookieFor = (ownerId: string) => {
    const c = sessionCookie({ tenant: DEMO_TENANT, ownerId }, new URL(BASE));
    return `${c.name}=${c.value}`;
  };

  test("needs an owner session, and leaves out mail to another owner", async () => {
    const repo = await setup();
    const d = (await doc(repo)).data;
    const [me, other] = d.owners;
    await repo.writeOutbox(DEMO_TENANT, { channel: "email", to: other.email, subject: "Your sign-in link", body: "secret link" });
    await repo.writeOutbox(DEMO_TENANT, { channel: "email", to: me.email, subject: "Your sign-in link", body: "my link" });
    await repo.writeOutbox(DEMO_TENANT, { channel: "email", to: BUSINESS.email, subject: "Jo needs an owner", body: "notice" });
    expect((await get()).status).toBe(401);
    expect((await get(cookieFor("own_nobody"))).status).toBe(401);
    const res = await get(cookieFor(me.id));
    expect(res.status).toBe(200);
    const bodies = ((await res.json()).messages as { body: string }[]).map((m) => m.body);
    expect(bodies).toEqual(expect.arrayContaining(["my link", "notice"]));
    expect(bodies).not.toContain("secret link");
  });
});
