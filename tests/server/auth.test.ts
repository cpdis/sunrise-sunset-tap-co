import { createHmac, randomUUID } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as commandPOST } from "@/app/api/commands/route";
import { POST as simulatePOST } from "@/app/api/dev/simulate/route";
import { POST as smsPOST } from "@/app/api/inbound/sms/route";
import * as sessionRoute from "@/app/api/session/route";
import { GET as stateGET } from "@/app/api/state/route";
import Login from "@/app/login/page";
import Outbox from "@/app/outbox/page";
import { BUSINESS } from "@/lib/config";
import { buildSeed } from "@/lib/seed";
import { approvalCode } from "@/lib/server/approvals";
import { linkToken, readSession, sessionCookie } from "@/lib/server/auth";
import { agentTurn } from "@/lib/server/agent";
import { runCommand } from "@/lib/server/commands";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, createRepo } from "@/lib/server/db/repo";
import { idempotencyKeys, outbox } from "@/lib/server/db/schema";
import { inboundWebhook } from "@/lib/server/inbound";
import { authorised, cronSecret, runAllJobs } from "@/lib/server/jobs";
import { SENDER_PER_MINUTE } from "@/lib/server/limits";
import { DEV_WEBHOOK_SECRET, inboundUrl, webhookSecret } from "@/lib/server/signature";
import { NOW, inboundReq, sessionFor } from "../helpers";

// U15a: the platform half of the auth review (Fable SS-xx, Codex AUTH-xx, Argon Fxx). Each test names its finding.

// The routes read the process-wide repo; here it is each test's in-memory one.
const h = vi.hoisted(() => ({ repo: undefined as unknown as Repo, equalCalls: [] as [number, number][] }));
vi.mock("@/lib/server/db/repo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/db/repo")>()), getRepo: async () => h.repo }));
// Records what each constant-time compare was given, to show a wrong length takes the same path (F13).
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  const timingSafeEqual = (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => (h.equalCalls.push([a.byteLength, b.byteLength]), real.timingSafeEqual(a, b));
  return { ...real, default: { ...real, timingSafeEqual }, timingSafeEqual };
});

const open: Connection[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function setup() {
  const c = await connect({ NODE_ENV: "test" }, "memory://");
  open.push(c);
  h.repo = createRepo(c.db);
  await h.repo.seedDemo(NOW);
  return { repo: h.repo, db: c.db };
}

const BASE = "http://localhost:3000";
const OTHER = "other-business";
// 32 characters: the shortest secret production takes.
const LONG = "0123456789abcdef0123456789abcdef";
const COLIN = "colin@sunrisesunsettapco.com";
const AARON = "aaron@sunrisesunsettapco.com";
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const doc = async (repo: Repo, tenant = DEMO_TENANT) => (await repo.load(tenant))!.data;
const jsonReq = (path: string, body: object, headers: Record<string, string> = {}) =>
  new Request(BASE + path, { method: "POST", headers: { origin: BASE, host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const askLink = (email: string) => sessionRoute.POST(jsonReq("/api/session", { email }));
// Who /api/state says the cookie signs in, if anyone.
const who = async (cookie: string) => (await (await stateGET(new Request(`${BASE}/api/state`, { headers: { cookie } }))).json()).owner?.id as string | undefined;
const production = (more: Record<string, string> = {}) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", LONG);
  vi.stubEnv("PUBLIC_BASE_URL", BASE);
  for (const [k, v] of Object.entries(more)) vi.stubEnv(k, v);
};

describe("A1. Demo features need the business's demo flag as well as DEMO_MODE (SS-01, AUTH-01, F12)", () => {
  test("only seedDemo makes a demo business, and reset refuses any other business whatever the caller says", async () => {
    const { repo } = await setup();
    await repo.create(OTHER, "Other Business", buildSeed(NOW));
    const before = await repo.load(OTHER);
    const reset = runCommand(repo, { tenant: OTHER, ownerId: "own_colin", demo: true, now: NOW }, { command: "reset", args: {}, key: randomUUID() });
    await expect(reset).rejects.toMatchObject({ status: 404 });
    expect(await repo.load(OTHER)).toEqual(before);
    expect(await repo.tenant(DEMO_TENANT)).toEqual({ demo: true });
    expect(await repo.tenant(OTHER)).toEqual({ demo: false });
  });

  test("with DEMO_MODE on but the flag off, the outbox, simulator, chat read, demo commands and owner picker are all off", async () => {
    const { repo, db } = await setup();
    const number = "0400 000 777";
    await agentTurn(repo, { tenant: DEMO_TENANT, now: NOW }, { channel: "sms", contact: number, body: "How many kegs fit?" }, { origin: BASE });
    await db.execute(sql`update tenants set demo = false where id = ${DEMO_TENANT}`);

    expect((await simulatePOST(jsonReq("/api/dev/simulate", { channel: "sms", contact: number, body: "hi" }))).status).toBe(404);
    const chat = (await (await stateGET(new Request(`${BASE}/api/state?chat=${encodeURIComponent(number)}`))).json()).chat;
    expect(chat).toBeUndefined();
    // A session signed while the demo was off is a good session; only the demo commands are gone.
    const cookie = sessionFor("own_colin", { demo: false });
    for (const command of ["reset", "runJobs"]) expect((await commandPOST(jsonReq("/api/commands", { command, args: {}, key: randomUUID() }, { cookie }))).status).toBe(404);
    expect((await commandPOST(jsonReq("/api/commands", { command: "toggleBlackout", args: { date: "2027-01-05" }, key: randomUUID() }, { cookie }))).status).toBe(200);
    await expect(Outbox()).rejects.toMatchObject({ digest: expect.stringMatching(/404/) });
    const login = await Login({ searchParams: Promise.resolve({}) });
    expect(login.props).toMatchObject({ owners: [], demo: false });
  });

  test("a cookie from the public demo stops working when DEMO_MODE goes off (AUTH-01)", async () => {
    await setup();
    production({ DEMO_MODE: "on" });
    const cookie = sessionFor("own_colin", { demo: true });
    expect(await who(cookie)).toBe("own_colin");
    vi.stubEnv("DEMO_MODE", "");
    expect(await who(cookie)).toBeUndefined();
  });
});

describe("A2. One parser for the signature and the message (AUTH-02)", () => {
  // Twilio's scheme, written out here so the test doesn't lean on the code it checks.
  const twilio = (fields: [string, string][]) =>
    createHmac("sha1", DEV_WEBHOOK_SECRET.sms)
      .update(inboundUrl("sms") + [...fields].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => k + v).join(""))
      .digest("base64");
  const post = (fields: [string, string][], signature: string) =>
    smsPOST(new Request(inboundUrl("sms"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: new URLSearchParams(fields) }));

  test("a signature over one From doesn't verify a body that repeats From", async () => {
    const { repo } = await setup();
    const aaron = "0400 111 201";
    const signed: [string, string][] = [["Body", `inboxFrom${aaron}`], ["From", "0400 999 888"], ["MessageSid", "SMcanonicalaudit"], ["To", BUSINESS.sms]];
    const sig = twilio(signed);
    // Codex's body: the same sorted string, with the owner's number as the last From.
    const forged: [string, string][] = [["Body", "inbox"], ["From", "0400 999 888"], ["From", aaron], ["MessageSid", "SMcanonicalaudit"], ["To", BUSINESS.sms]];
    expect(twilio(forged)).toBe(sig);
    const res = await post(forged, sig);
    expect(res.status).toBe(400);
    expect((await doc(repo)).conversations.some((c) => c.contact === aaron || c.contact === "0400 999 888")).toBe(false);
    // The body that was really signed still goes through, as the stranger it came from.
    expect((await post(signed, sig)).status).toBe(200);
    expect((await doc(repo)).conversations.find((c) => c.contact === "0400 999 888")?.ownerId).toBeUndefined();
  });
});

describe("A3. Production refuses dev and short secrets (SS-08, AUTH-03, F13)", () => {
  const DEV = ["dev-only-session-secret", "dev-only-approval-secret", "dev-only-twilio-auth-token", "dev-only-email-webhook-secret", "dev-only-cron-secret"];
  type Env = Record<string, string | undefined>;
  const getters: Record<string, (env: Env) => unknown> = {
    SESSION_SECRET: (env) => linkToken({ tenant: DEMO_TENANT, ownerId: "own_colin" }, NOW.getTime(), env),
    APPROVAL_SECRET: (env) => approvalCode(DEMO_TENANT, "apr_1", env),
    TWILIO_AUTH_TOKEN: (env) => webhookSecret("sms", env),
    EMAIL_WEBHOOK_SECRET: (env) => webhookSecret("email", env),
    CRON_SECRET: (env) => cronSecret(env),
  };

  test.each(Object.keys(getters))("%s: a dev default or anything under 32 characters is refused in production or with DATABASE_URL", (name) => {
    const get = getters[name];
    expect(() => get({ NODE_ENV: "development" })).not.toThrow();
    for (const strict of [{ NODE_ENV: "production" }, { NODE_ENV: "development", DATABASE_URL: "postgres://db.example/live" }]) {
      expect(() => get(strict)).toThrow(new RegExp(name));
      for (const dev of DEV) expect(() => get({ ...strict, [name]: dev })).toThrow(new RegExp(name));
      expect(() => get({ ...strict, [name]: LONG.slice(1) })).toThrow(new RegExp(name));
      expect(() => get({ ...strict, [name]: LONG })).not.toThrow();
    }
  });

  test("secret compares hash both sides first, so a wrong length takes the same path (F13)", () => {
    h.equalCalls.length = 0;
    expect(authorised(new Request(`${BASE}/api/jobs`, { headers: { authorization: "Bearer x" } }))).toBe(false);
    expect(h.equalCalls).toEqual([[32, 32]]);
    expect(authorised(new Request(`${BASE}/api/jobs`, { headers: { authorization: "Bearer dev-only-cron-secret" } }))).toBe(true);
  });
});

describe("A4. Sign-in links and the Origin check use PUBLIC_BASE_URL (SS-04, F01)", () => {
  test("a spoofed Host and Origin can't ask for a link, and the link points at PUBLIC_BASE_URL", async () => {
    const { repo } = await setup();
    vi.stubEnv("PUBLIC_BASE_URL", "https://sunrisesunset.example");
    const ask = (url: string, headers: Record<string, string>) =>
      sessionRoute.POST(new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email: COLIN }) }));
    const spoofed = await ask("https://evil.example/api/session", { origin: "https://evil.example", host: "evil.example", "x-forwarded-host": "evil.example" });
    expect(spoofed.status).toBe(403);
    expect(await repo.readOutbox(DEMO_TENANT)).toHaveLength(0);
    // Behind a proxy the function may see an internal URL and Host; the link still uses the public origin.
    const ok = await ask("http://10.0.0.5:3000/api/session", { origin: "https://sunrisesunset.example", host: "10.0.0.5:3000" });
    expect(ok.status).toBe(200);
    const [m] = await repo.readOutbox(DEMO_TENANT);
    expect(m.body).toMatch(/ https:\/\/sunrisesunset\.example\/login\/confirm#token=\S+$/);
  });
});

describe("A5. The link opens a page; only its POST signs in (SS-05, AUTH-11, F11)", () => {
  test("the token rides in the fragment, the session route has no GET, and the confirm POST signs in once", async () => {
    const { repo } = await setup();
    expect((await askLink(COLIN)).status).toBe(200);
    const [m] = await repo.readOutbox(DEMO_TENANT);
    const link = new URL(m.body.match(/https?:\/\/\S+/)![0]);
    // A scanner or prefetch that fetches the link sends no token: browsers never send the fragment.
    expect([link.origin, link.pathname, link.search]).toEqual([BASE, "/login/confirm", ""]);
    const token = new URLSearchParams(link.hash.slice(1)).get("token")!;
    expect(token).toBeTruthy();
    expect("GET" in sessionRoute).toBe(false);

    const { POST: confirm } = await import("@/app/api/session/confirm/route");
    const openWith = (headers: Record<string, string> = {}) => confirm(jsonReq("/api/session/confirm", { token }, headers));
    expect((await openWith({ origin: "https://evil.example" })).status).toBe(403);
    expect((await openWith({ "content-type": "text/plain" })).status).toBe(403);
    const first = await openWith();
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^sst_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(readSession(new Request(BASE, { headers: { cookie: cookie.split(";")[0] } }))).toEqual({ tenant: DEMO_TENANT, ownerId: "own_colin", sv: 0, demo: true });
    const second = await openWith();
    expect(second.status).toBe(400);
    expect(second.headers.get("set-cookie")).toBeNull();
  });
});

describe("A6. Rate limits on the browser routes (SS-06, AUTH-10, F08)", () => {
  test("sign-in links: 5 per email and 20 per IP in 15 minutes", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const mine: number[] = [];
    for (let i = 0; i < 6; i++) mine.push((await askLink(COLIN)).status);
    expect(mine).toEqual([200, 200, 200, 200, 200, 429]);
    // Addresses that aren't an owner's count the same, so a 429 says nothing about who is one.
    const strangers: number[] = [];
    for (let i = 0; i < 15; i++) strangers.push((await askLink(`stranger${i}@example.com`)).status);
    expect(strangers).toEqual([...Array(14).fill(200), 429]);
    vi.setSystemTime(NOW.getTime() + 15 * 60_000);
    expect((await askLink(COLIN)).status).toBe(200);
  });

  test("the outbox keeps only the newest sign-in link per owner, and the daily job drops rows over 7 days old", async () => {
    const { repo, db } = await setup();
    for (let i = 0; i < 3; i++) await askLink(COLIN);
    await askLink(AARON);
    expect((await repo.readOutbox(DEMO_TENANT)).map((r) => r.to).sort()).toEqual([AARON, COLIN]);

    await repo.writeOutbox(DEMO_TENANT, { channel: "sms", to: "0400 000 001", subject: null, body: "eight days" });
    await repo.writeOutbox(DEMO_TENANT, { channel: "sms", to: "0400 000 002", subject: null, body: "six days" });
    await db.update(outbox).set({ createdAt: new Date(NOW.getTime() - 8 * 86_400_000) }).where(eq(outbox.body, "eight days"));
    await db.update(outbox).set({ createdAt: new Date(NOW.getTime() - 6 * 86_400_000) }).where(eq(outbox.body, "six days"));
    await runAllJobs(repo, NOW);
    const left = (await repo.readOutbox(DEMO_TENANT)).map((r) => r.body);
    expect(left).not.toContain("eight days");
    expect(left).toContain("six days");
  });

  const book = (phone: string) =>
    commandPOST(jsonReq("/api/commands", { command: "book", args: { date: "2027-01-09", block: 4, suburb: "Subiaco", name: "Ann", phone, agreed: true }, key: randomUUID() }));

  test("web bookings: 5 an hour per phone or email", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await book("0400 000 111")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    // The same number written another way is the same contact.
    expect((await book("0400000111")).status).toBe(429);
    expect((await book("0400 000 112")).status).toBe(200);
  });

  test("web bookings: 10 an hour per IP", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await book(`0400 000 ${200 + i}`)).status);
    expect(statuses).toEqual([...Array(10).fill(200), 429]);
  });

  test("the simulator caps how many numbers one IP texts as", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const text = (contact: string, headers: Record<string, string> = {}) => simulatePOST(jsonReq("/api/dev/simulate", { channel: "sms", contact, body: "hi" }, headers));
    for (let i = 0; i < 10; i++) expect((await text(`0400 100 ${100 + i}`)).status).toBe(200);
    expect((await text("0400 100 200")).status).toBe(429);
    // A number this IP already texted as still works.
    expect((await text("0400 100 100")).status).toBe(200);
    // On Vercel, another IP has its own allowance.
    vi.stubEnv("VERCEL", "1");
    expect((await text("0400 100 300", { "x-real-ip": "203.0.113.9" })).status).toBe(200);
  });

  test("the client IP comes only from Vercel's own header, and IPv6 counts by its /64", async () => {
    const { clientIp } = await import("@/lib/server/limits");
    const req = (headers: Record<string, string>) => new Request(BASE, { headers });
    // Off Vercel these headers are the caller's to set, so everyone shares one window.
    expect(clientIp(req({ "x-real-ip": "198.51.100.1" }), {})).toBe(clientIp(req({ "x-real-ip": "198.51.100.2" }), {}));
    const vercel = { VERCEL: "1" };
    expect(clientIp(req({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.5" }), vercel)).toBe("198.51.100.1");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), vercel)).toBe("198.51.100.1");
    expect(clientIp(req({ "x-real-ip": "2001:db8:1:2:aaaa::1" }), vercel)).toBe(clientIp(req({ "x-real-ip": "2001:DB8:1:2:bbbb:cccc:dddd:eeee" }), vercel));
    expect(clientIp(req({ "x-real-ip": "2001:db8:1:2::1" }), vercel)).not.toBe(clientIp(req({ "x-real-ip": "2001:db8:1:3::1" }), vercel));
    expect(clientIp(req({ "x-real-ip": "::ffff:198.51.100.1" }), vercel)).toBe("198.51.100.1");
  });
});

describe("A7. Sessions end on sign-out and stand apart from approval codes (SS-07, SS-13)", () => {
  test("signing out ends every session of that owner, on every device", async () => {
    await setup();
    const laptop = sessionFor("own_colin");
    const phone = sessionFor("own_colin");
    const aaron = sessionFor("own_aaron");
    expect(await who(phone)).toBe("own_colin");
    const out = await sessionRoute.DELETE(new Request(`${BASE}/api/session`, { method: "DELETE", headers: { origin: BASE, host: "localhost:3000", cookie: laptop } }));
    expect(out.status).toBe(200);
    expect(await who(phone)).toBeUndefined();
    expect(await who(laptop)).toBeUndefined();
    expect(await who(aaron)).toBe("own_aaron");
    // A new sign-in carries the new version.
    expect(await who(sessionFor("own_colin", { sv: 1 }))).toBe("own_colin");
  });

  test("approval codes have their own secret, apart from the session secret", () => {
    const code = approvalCode(DEMO_TENANT, "apr_1", { NODE_ENV: "test" });
    expect(approvalCode(DEMO_TENANT, "apr_1", { NODE_ENV: "test", SESSION_SECRET: LONG })).toBe(code);
    expect(approvalCode(DEMO_TENANT, "apr_1", { NODE_ENV: "test", APPROVAL_SECRET: LONG })).not.toBe(code);
  });

  test("the session and sign-out cookies are Secure in production and on https, whatever the host", async () => {
    await setup();
    const s = { tenant: DEMO_TENANT, ownerId: "own_colin", sv: 0, demo: false };
    expect(sessionCookie(s, new URL("http://localhost:3000"), NOW.getTime(), { NODE_ENV: "production", SESSION_SECRET: LONG }).secure).toBe(true);
    expect(sessionCookie(s, new URL("https://127.0.0.1"), NOW.getTime(), { NODE_ENV: "development" }).secure).toBe(true);
    expect(sessionCookie(s, new URL("http://localhost:3000"), NOW.getTime(), { NODE_ENV: "development" }).secure).toBe(false);
    production();
    const out = await sessionRoute.DELETE(new Request(`${BASE}/api/session`, { method: "DELETE", headers: { origin: BASE, host: "localhost:3000" } }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Secure/i);
  });
});

describe("A8. Inbound replay protection (SS-10)", () => {
  test("a message id is kept 30 days, so a replay two days later runs nothing", async () => {
    const { repo, db } = await setup();
    const fields = { From: "0400 222 777", Body: "Do you supply staff?", MessageSid: "SMkeep30" };
    expect((await smsPOST(inboundReq("sms", fields))).status).toBe(200);
    const count = async () => (await doc(repo)).conversations.find((c) => c.contact === "0400 222 777")!.messages.length;
    const n = await count();
    await db.update(idempotencyKeys).set({ createdAt: sql`now() - interval '2 days'` });
    // Every command prunes day-old idempotency keys.
    await runCommand(repo, { tenant: DEMO_TENANT, ownerId: "own_colin", demo: true, now: NOW }, { command: "toggleBlackout", args: { date: "2027-01-05" }, key: randomUUID() });
    const again = await smsPOST(inboundReq("sms", fields));
    expect(await again.text()).toBe(EMPTY_TWIML);
    expect(await count()).toBe(n);
    // The daily job drops ids over 30 days old.
    await db.update(idempotencyKeys).set({ createdAt: sql`now() - interval '31 days'` }).where(like(idempotencyKeys.key, "inbound:%"));
    await runAllJobs(repo);
    expect(await db.select().from(idempotencyKeys).where(like(idempotencyKeys.key, "inbound:%"))).toEqual([]);
  });

  test("a message over the rate limit keeps its id, so the provider's retry gets through", async () => {
    await setup();
    const from = "0400 222 778";
    for (let i = 0; i < SENDER_PER_MINUTE; i++) await inboundWebhook("sms", inboundReq("sms", { From: from, Body: `hi ${i}` }), { now: NOW });
    const msg = { From: from, Body: "Do you supply staff?", MessageSid: "SMretry1" };
    expect((await inboundWebhook("sms", inboundReq("sms", msg), { now: NOW })).status).toBe(429);
    const retry = await inboundWebhook("sms", inboundReq("sms", msg), { now: new Date(NOW.getTime() + 60_000) });
    expect(retry.status).toBe(200);
    expect(await retry.text()).toMatch(/No staff stay/);
  });
});
