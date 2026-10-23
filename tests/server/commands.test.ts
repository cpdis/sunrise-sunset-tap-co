import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET as stateGET } from "@/app/api/state/route";
import { POST as commandPOST } from "@/app/api/commands/route";
import { POST as confirmPOST } from "@/app/api/session/confirm/route";
import { DELETE as sessionDELETE, POST as sessionPOST } from "@/app/api/session/route";
import { LINK_MINUTES, demoMode, linkToken, openLink, readSession, sessionCookie } from "@/lib/server/auth";
import { agentTurn } from "@/lib/server/agent";
import { COMMAND_NAMES, type Caller, CommandError, runCommand } from "@/lib/server/commands";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, createRepo } from "@/lib/server/db/repo";
import { buildSeed } from "@/lib/seed";
import type { Data } from "@/lib/types";
import { publicView, snapshot, stateFor } from "@/lib/views";
import { NOW, sessionFor } from "../helpers";

// The routes read the process-wide repo; here it is each test's in-memory one.
const h = vi.hoisted(() => ({ repo: undefined as unknown as Repo }));
vi.mock("@/lib/server/db/repo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/db/repo")>()), getRepo: async () => h.repo }));

const open: Connection[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function setup() {
  const c = await connect({ NODE_ENV: "test" }, "memory://");
  open.push(c);
  const repo = createRepo(c.db);
  await repo.seedDemo(NOW);
  h.repo = repo;
  return repo;
}

const OTHER = "other-business";
const as = (ownerId?: string, tenant = DEMO_TENANT): Caller => ({ tenant, ownerId, demo: true, now: NOW });
const visitor = as();
const run = (repo: Repo, caller: Caller, command: string, args: object = {}, key = randomUUID()) => runCommand(repo, caller, { command, args, key });
const doc = async (repo: Repo, tenant = DEMO_TENANT) => (await repo.load(tenant))!;
const refusedWith = async (p: Promise<unknown>, status: number) => {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(CommandError);
  expect((err as CommandError).status).toBe(status);
};

// Two upcoming paid bookings that belong to different customers.
function twoCustomers(d: Data) {
  const up = d.bookings.filter((b) => b.kind === "paid" && b.state === "confirmed" && b.date > "2026-10-22").sort((a, b) => a.date.localeCompare(b.date));
  const a = up[0];
  const b = up.find((x) => x.customerId !== a.customerId)!;
  return { a, b };
}

// What a payout posted: its dividends and runner fees, each under the line's payout id.
const paidOut = (d: Data, quarter: string) => d.ledger.filter((e) => e.ref?.startsWith("po_") && e.memo.startsWith(`${quarter} `));

describe("idempotency keys", () => {
  test("payDistribution twice with one key pays once", async () => {
    const repo = await setup();
    const dist = (await doc(repo)).data.distributions.find((x) => x.status === "awaiting")!;
    await run(repo, as("own_colin"), "approveDistribution", { distId: dist.id });
    await run(repo, as("own_aaron"), "approveDistribution", { distId: dist.id });
    const key = randomUUID();
    const first = await run(repo, as("own_colin"), "payDistribution", { distId: dist.id }, key);
    const paid = (await doc(repo)).data;
    expect(paid.distributions.find((x) => x.id === dist.id)!.status).toBe("paid");
    const lines = paidOut(paid, dist.quarter).length;
    expect(lines).toBeGreaterThan(0);

    // A retry and two concurrent retries with the same key: the stored result comes back, and nothing pays again.
    const again = await Promise.all([1, 2, 3].map(() => run(repo, as("own_colin"), "payDistribution", { distId: dist.id }, key)));
    expect(again).toEqual([first, first, first]);
    const after = await doc(repo);
    expect(paidOut(after.data, dist.quarter)).toHaveLength(lines);
    expect(after.data.ledger).toEqual(paid.ledger);
  });

  test("two concurrent first runs with one key run the command once", async () => {
    const repo = await setup();
    const before = await doc(repo);
    const key = randomUUID();
    const args = { date: "2026-10-20", account: "fuel", amount: 42, memo: "Fuel" };
    await Promise.all([run(repo, as("own_colin"), "addExpense", args, key), run(repo, as("own_colin"), "addExpense", args, key)]);
    const after = await doc(repo);
    expect(after.data.ledger.length - before.data.ledger.length).toBe(1);
    expect(after.version).toBe(before.version + 1);
  });

  test("a key used for another command is refused, and a command without a key never runs", async () => {
    const repo = await setup();
    const key = randomUUID();
    await run(repo, as("own_colin"), "toggleBlackout", { date: "2027-01-05" }, key);
    await refusedWith(run(repo, as("own_colin"), "addExpense", { date: "2026-10-20", account: "fuel", amount: 1, memo: "x" }, key), 422);
    const before = await doc(repo);
    await refusedWith(runCommand(repo, as("own_colin"), { command: "toggleBlackout", args: { date: "2027-01-06" } }), 400);
    expect(await doc(repo)).toEqual(before);
  });
});

describe("roles", () => {
  test("a customer token cannot run cancel on another customer's booking", async () => {
    const repo = await setup();
    const { a, b } = twoCustomers((await doc(repo)).data);
    const before = await doc(repo);
    await refusedWith(run(repo, visitor, "customerCancel", { bookingId: b.id, token: a.token }), 403);
    await refusedWith(run(repo, visitor, "payBalance", { bookingId: b.id, token: a.token, card: "Visa •• 4242" }), 403);
    await refusedWith(run(repo, visitor, "customerCancel", { bookingId: b.id, token: b.id }), 403);
    // The owners' cancel needs an owner's session, whatever the body says.
    await refusedWith(run(repo, visitor, "cancel", { bookingId: b.id, token: b.token }), 401);
    expect(await doc(repo)).toEqual(before);

    // The right token works for its own booking.
    await run(repo, visitor, "customerCancel", { bookingId: a.id, token: a.token });
    const after = (await doc(repo)).data;
    const a1 = after.bookings.find((x) => x.id === a.id)!;
    expect(a1.state === "cancelled" || after.conversations.some((c) => c.customerId === a.customerId && c.escalated)).toBe(true);
    expect(after.bookings.find((x) => x.id === b.id)!.state).toBe(b.state);
  });

  test("director commands refuse an owner who isn't a director", async () => {
    const repo = await setup();
    await repo.mutate(DEMO_TENANT, (d) => void (d.owners.find((o) => o.id === "own_joe")!.isDirector = false));
    const dist = (await doc(repo)).data.distributions.find((x) => x.status === "awaiting")!;
    await refusedWith(run(repo, as("own_joe"), "approveDistribution", { distId: dist.id }), 403);
    await refusedWith(run(repo, as("own_joe"), "payDistribution", { distId: dist.id }), 403);
    await refusedWith(run(repo, as("own_nobody"), "addExpense", { date: "2026-10-20", account: "fuel", amount: 1, memo: "x" }), 401);
  });

  test("the demo reset exists only in demo mode (KTD12)", async () => {
    const repo = await setup();
    await refusedWith(run(repo, { ...as("own_colin"), demo: false }, "reset"), 404);
    await run(repo, as("own_colin"), "reset");
    expect(demoMode({ NODE_ENV: "production" })).toBe(false);
    expect(demoMode({ NODE_ENV: "production", DEMO_MODE: "on" })).toBe(true);
    expect(demoMode({ NODE_ENV: "development" })).toBe(true);
  });
});

// Arguments for every command, aimed at the other business's records. Ids the two seeds share (conv_1,
// dist_2026-Q3, own-use bookings) only ever reach the caller's own business.
function argsFor(d: Data): Record<string, object> {
  const { a } = twoCustomers(d);
  const conv = d.conversations[0];
  const dist = d.distributions.find((x) => x.status === "awaiting")!;
  return {
    book: { date: "2027-01-09", block: 4, suburb: "Subiaco", name: "Ann", phone: "0400 000 111", agreed: true },
    payDeposit: { bookingId: a.id, token: a.token, card: "Visa •• 4242" },
    payBalance: { bookingId: a.id, token: a.token, card: "Visa •• 4242" },
    customerCancel: { bookingId: a.id, token: a.token },
    cancel: { bookingId: a.id },
    ownerReply: { convId: conv.id, body: "hi" },
    setAgentActive: { convId: conv.id, active: false },
    handBack: { convId: conv.id, force: true },
    setDraft: { convId: conv.id, draft: "draft" },
    markRead: { convId: conv.id },
    claimRun: { bookingId: a.id, which: "deliver" },
    captureBond: { bookingId: a.id, amount: 10, note: "dent" },
    returnedClean: { bookingId: a.id },
    chargeBalanceNow: { bookingId: a.id },
    addExpense: { date: "2026-10-20", account: "fuel", amount: 10, memo: "x" },
    approveDistribution: { distId: dist.id },
    payDistribution: { distId: dist.id },
    updateSettings: { patch: { deposit: 260 } },
    saveKb: { page: { slug: "pricing", title: "Pricing", body: "changed" } },
    toggleBlackout: { date: "2027-01-05" },
    addPersonalUse: { date: "2027-01-06", note: "mine" },
    addTruckLog: { log: { date: "2026-10-20", type: "clean", notes: "clean" } },
    transferShares: { fromId: "own_colin", toId: "own_aaron", shares: 1 },
    reset: {},
    runJobs: {},
  };
}

describe("tenants (R16)", () => {
  test("an owner session for one business cannot run any command on another", async () => {
    const repo = await setup();
    await repo.create(OTHER, "Other Business", buildSeed(NOW));
    const theirs = await doc(repo, OTHER);
    const args = argsFor(theirs.data);
    expect(Object.keys(args).sort()).toEqual([...COMMAND_NAMES].sort());
    for (const name of COMMAND_NAMES) {
      // The body names the other business too; only the session's business counts.
      const body = { command: name, args: args[name], key: randomUUID(), tenant: OTHER };
      await runCommand(repo, as("own_colin"), body).catch(() => undefined);
    }
    expect(await doc(repo, OTHER)).toEqual(theirs);
  });

  test("a session names one business, and a command for an unknown one finds nothing", async () => {
    const repo = await setup();
    await refusedWith(run(repo, as("own_colin", "nobody"), "addExpense", { date: "2026-10-20", account: "fuel", amount: 1, memo: "x" }), 404);
  });
});

describe("what each caller sees (state scoping)", () => {
  test("the customer state response contains no other customer's bookings, names or ids", async () => {
    const repo = await setup();
    const d = (await doc(repo)).data;
    const { a } = twoCustomers(d);
    const mine = d.customers.find((c) => c.id === a.customerId)!;
    const others = d.customers.filter((c) => c.id !== mine.id);
    const out = JSON.stringify(stateFor(d, { booking: a.id, token: a.token }, NOW));
    expect(out).toContain(a.id);
    expect(out).not.toContain('"owner"');
    for (const b of d.bookings.filter((x) => x.id !== a.id)) {
      expect(out).not.toContain(b.id);
      expect(out).not.toContain(`"${b.ref}"`);
    }
    for (const c of others) {
      expect(out).not.toContain(c.id);
      expect(out).not.toContain(c.name);
      if (c.email) expect(out).not.toContain(c.email);
      if (c.phone) expect(out).not.toContain(c.phone);
    }
    // The booking's own internals stay with the owners: run roster, owner notes.
    expect(out).not.toContain("own_");
  });

  test("the public view and the customer agent's snapshot carry no one else's details", async () => {
    const repo = await setup();
    const d = (await doc(repo)).data;
    const pub = JSON.stringify(publicView(d, NOW));
    for (const b of d.bookings) expect(pub).not.toContain(b.id);
    for (const c of d.customers) expect(pub).not.toContain(c.name);
    expect(pub).not.toContain("cus_");

    const { a } = twoCustomers(d);
    const mine = d.customers.find((c) => c.id === a.customerId)!;
    const snap = snapshot(d, mine.phone);
    expect(snap.mine.map((b) => b.id)).toContain(a.id);
    expect(snap.mine.every((b) => b.customerId === mine.id || d.customers.find((c) => c.id === b.customerId)?.phone === mine.phone)).toBe(true);
    const slots = JSON.stringify(snap.bookings);
    for (const b of d.bookings) expect(slots).not.toContain(b.id);
  });

  test("an owner's conversation and the whole document need an owner's session to read", async () => {
    const repo = await setup();
    const d = (await doc(repo)).data;
    const colin = d.owners.find((o) => o.id === "own_colin")!;
    const text = (caller: Caller) => agentTurn(repo, caller, { channel: "sms", contact: colin.phone, body: "What's on?" }, { origin: BASE });
    await text(as("own_colin"));
    const d1 = (await doc(repo)).data;
    expect(stateFor(d1, { chat: colin.phone }, NOW).chat).toBeUndefined();
    expect(stateFor(d1, { chat: colin.phone, ownerId: "own_colin" }, NOW).chat?.contact).toBe(colin.phone);
    expect(stateFor(d1, {}, NOW).owner).toBeUndefined();
    expect(stateFor(d1, { ownerId: "own_nobody" }, NOW).owner).toBeUndefined();
  });
});

// ---------- the routes ----------

const BASE = "http://localhost:3000";
// `demo`: whether the demo was on when the cookie was signed; a cookie is good only while that still holds.
const cookieFor = (ownerId: string, demo = true) => sessionFor(ownerId, { demo });
const commandReq = (body: object, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/api/commands`, { method: "POST", headers: { origin: BASE, host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("/api/commands (KTD7)", () => {
  const expense = () => ({ command: "addExpense", args: { date: "2026-10-20", account: "fuel", amount: 5, memo: "x" }, key: randomUUID() });

  test("a foreign Origin, a missing Origin or a text/plain body gets 403 and changes nothing", async () => {
    const repo = await setup();
    const before = await doc(repo);
    const cookie = cookieFor("own_colin");
    const forged = [
      commandReq(expense(), { cookie, origin: "https://evil.example" }),
      commandReq(expense(), { cookie, "content-type": "text/plain" }),
      commandReq(expense(), { cookie, "content-type": "application/x-www-form-urlencoded" }),
      new Request(`${BASE}/api/commands`, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", cookie }, body: JSON.stringify(expense()) }),
    ];
    for (const req of forged) expect((await commandPOST(req)).status).toBe(403);
    expect(await doc(repo)).toEqual(before);

    const ok = await commandPOST(commandReq(expense(), { cookie }));
    expect(ok.status).toBe(200);
    expect((await doc(repo)).version).toBe(before.version + 1);
  });

  test("a tampered or missing session cookie is no session", async () => {
    const repo = await setup();
    const before = await doc(repo);
    const [payload, sig] = cookieFor("own_aaron").split("=")[1].split(".");
    const tampered = Buffer.from(Buffer.from(payload, "base64url").toString().replace("own_aaron", "own_colin")).toString("base64url");
    expect((await commandPOST(commandReq(expense(), { cookie: `sst_session=${tampered}.${sig}` }))).status).toBe(401);
    expect((await commandPOST(commandReq(expense()))).status).toBe(401);
    expect(await doc(repo)).toEqual(before);
  });
});

describe("/api/state", () => {
  test("opening a booking with its id but no link token shows nothing", async () => {
    const repo = await setup();
    const { a } = twoCustomers((await doc(repo)).data);
    const get = async (q: string) => (await stateGET(new Request(`${BASE}/api/state?${q}`))).json();
    expect((await get(`booking=${a.id}`)).booking).toBeUndefined();
    expect((await get(`booking=${a.id}&t=wrong`)).booking).toBeUndefined();
    expect((await get(`booking=${a.id}&t=${a.token}`)).booking.booking.id).toBe(a.id);
  });

  // A phone number is no secret: outside the demo, reading a number's conversation needs an owner's session.
  test("a customer number's conversation needs an owner's session outside the demo; the demo widget still reads it", async () => {
    const repo = await setup();
    const number = "0400 000 321";
    await agentTurn(repo, visitor, { channel: "sms", contact: number, body: "How many kegs fit?" }, { origin: BASE });
    // SST-1052's customer, whose cancel quote carries the code a YES must echo.
    await agentTurn(repo, visitor, { channel: "sms", contact: "0450 926 727", body: "cancel SST-1052" }, { origin: BASE });
    const chatOf = async (contact: string, headers: Record<string, string> = {}) =>
      (await (await stateGET(new Request(`${BASE}/api/state?chat=${encodeURIComponent(contact)}`, { headers }))).json()).chat;
    // Development counts as the demo (KTD12).
    expect((await chatOf(number))?.contact).toBe(number);
    // The widget never sees agent state, which holds a cancel quote's code.
    const quoted = await chatOf("0450 926 727");
    expect(quoted.messages.at(-1).body).toMatch(/Reply YES \d{4} to cancel/);
    expect(quoted).not.toHaveProperty("state");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "a production secret for this test");
    expect(await chatOf(number)).toBeUndefined();
    expect((await chatOf(number, { cookie: cookieFor("own_colin", false) }))?.contact).toBe(number);
    vi.stubEnv("DEMO_MODE", "on");
    expect((await chatOf(number))?.contact).toBe(number);
  });

  test("the whole document goes only to an owner's session", async () => {
    await setup();
    const res = await stateGET(new Request(`${BASE}/api/state`, { headers: { cookie: cookieFor("own_colin") } }));
    expect((await res.json()).owner.id).toBe("own_colin");
    expect((await (await stateGET(new Request(`${BASE}/api/state`))).json()).owner).toBeUndefined();
    expect((await stateGET(new Request(`${BASE}/api/state`, { headers: { origin: "https://evil.example", host: "localhost:3000" } }))).status).toBe(403);
  });
});

describe("sign-in by simulated magic link", () => {
  const ask = (email: string, headers: Record<string, string> = {}) =>
    sessionPOST(new Request(`${BASE}/api/session`, { method: "POST", headers: { origin: BASE, host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify({ email }) }));
  // The token in a sent link's fragment (/login/confirm#token=...).
  const tokenIn = (body: string) => new URLSearchParams(new URL(body.match(/http:\/\/localhost:3000\/login\/confirm#token=\S+/)![0]).hash.slice(1)).get("token")!;
  // What the confirm page's button does.
  const confirm = (token: string) =>
    confirmPOST(new Request(`${BASE}/api/session/confirm`, { method: "POST", headers: { origin: BASE, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ token }) }));

  test("a link goes to the outbox, signs the owner in once, and sets a strict httpOnly cookie", async () => {
    const repo = await setup();
    expect((await ask("Colin@SunriseSunsetTapCo.com")).status).toBe(200);
    expect((await ask("stranger@example.com")).status).toBe(200);
    const sent = await repo.readOutbox(DEMO_TENANT);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "email", to: "colin@sunrisesunsettapco.com" });

    const first = await confirm(tokenIn(sent[0].body));
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^sst_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    // localhost runs on plain http in development.
    expect(cookie).not.toMatch(/Secure/i);
    expect(readSession(new Request(BASE, { headers: { cookie: cookie.split(";")[0] } }))).toEqual({ tenant: DEMO_TENANT, ownerId: "own_colin", sv: 0, demo: true });

    const second = await confirm(tokenIn(sent[0].body));
    expect(second.status).toBe(400);
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  test("a link expires, cannot pass for a session, and the cookie is Secure off localhost", async () => {
    await setup();
    const t = linkToken({ tenant: DEMO_TENANT, ownerId: "own_colin" }, NOW.getTime());
    expect(openLink(t, NOW.getTime())?.ownerId).toBe("own_colin");
    expect(openLink(t, NOW.getTime() + (LINK_MINUTES + 1) * 60_000)).toBeUndefined();
    expect(readSession(new Request(BASE, { headers: { cookie: `sst_session=${t}` } }))).toBeUndefined();
    expect(sessionCookie({ tenant: DEMO_TENANT, ownerId: "own_colin", sv: 0, demo: true }, new URL("https://sunrisesunset.example")).secure).toBe(true);
    expect(() => linkToken({ tenant: DEMO_TENANT, ownerId: "own_colin" }, Date.now(), { NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });

  test("a foreign Origin can't ask for a link or sign out", async () => {
    const repo = await setup();
    expect((await ask("colin@sunrisesunsettapco.com", { origin: "https://evil.example" })).status).toBe(403);
    expect(await repo.readOutbox(DEMO_TENANT)).toHaveLength(0);
    const out = await sessionDELETE(new Request(`${BASE}/api/session`, { method: "DELETE", headers: { origin: "https://evil.example", host: "localhost:3000" } }));
    expect(out.status).toBe(403);
  });
});
