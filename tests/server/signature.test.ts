import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as simulatePOST } from "@/app/api/dev/simulate/route";
import { POST as emailPOST } from "@/app/api/inbound/email/route";
import { POST as smsPOST } from "@/app/api/inbound/sms/route";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, createRepo } from "@/lib/server/db/repo";
import { DEV_WEBHOOK_SECRET, inboundUrl, publicBaseUrl, sign, verify, webhookSecret } from "@/lib/server/signature";
import { NOW, inboundReq } from "../helpers";

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
  h.repo = createRepo(c.db);
  await h.repo.seedDemo(NOW);
  return h.repo;
}

const doc = async () => (await h.repo.load(DEMO_TENANT))!.data;
const FROM = "0400 222 301";
const messagesFrom = async (contact: string) => (await doc()).conversations.find((c) => c.contact === contact)?.messages.length ?? 0;

describe("the signature (Twilio's scheme)", () => {
  const url = "https://example.com/api/inbound/sms";
  const fields: [string, string][] = [["From", FROM], ["To", "0480 016 450"], ["Body", "hi"]];

  test("verifies its own signature in any field order, and nothing else", () => {
    const sig = sign("s3cret", url, fields);
    expect(verify("s3cret", url, [...fields].reverse(), sig)).toBe(true);
    expect(verify("s3cret", url, [["From", FROM], ["To", "0480 016 450"], ["Body", "hi!"]], sig)).toBe(false);
    expect(verify("s3cret", url, [...fields, ["Extra", "1"]], sig)).toBe(false);
    expect(verify("s3cret", "https://evil.test/api/inbound/sms", fields, sig)).toBe(false);
    expect(verify("other", url, fields, sig)).toBe(false);
    expect(verify("s3cret", url, fields, null)).toBe(false);
    expect(verify("s3cret", url, fields, "")).toBe(false);
  });

  test("covers the URL plus each name and value sorted by name, as HMAC-SHA1 in base64", async () => {
    const { createHmac } = await import("node:crypto");
    const by = createHmac("sha1", "s3cret").update(`${url}Bodyhi` + `From${FROM}` + "To0480 016 450").digest("base64");
    expect(sign("s3cret", url, fields)).toBe(by);
  });

  test("the dev secrets and URL work only outside production", () => {
    expect(webhookSecret("sms", { NODE_ENV: "development" })).toBe(DEV_WEBHOOK_SECRET.sms);
    expect(webhookSecret("email", {})).toBe(DEV_WEBHOOK_SECRET.email);
    expect(() => webhookSecret("sms", { NODE_ENV: "production" })).toThrow(/TWILIO_AUTH_TOKEN is not set/);
    expect(() => webhookSecret("email", { NODE_ENV: "production" })).toThrow(/EMAIL_WEBHOOK_SECRET is not set/);
    expect(webhookSecret("sms", { NODE_ENV: "production", TWILIO_AUTH_TOKEN: "real" })).toBe("real");
    expect(() => publicBaseUrl({ NODE_ENV: "production" })).toThrow(/PUBLIC_BASE_URL is not set/);
    expect(inboundUrl("email", { PUBLIC_BASE_URL: "https://demo.example.com/" })).toBe("https://demo.example.com/api/inbound/email");
  });
});

describe("the inbound routes (R15)", () => {
  test("a valid signature is accepted and the agent answers", async () => {
    await setup();
    const res = await smsPOST(inboundReq("sms", { From: FROM, Body: "Do you supply staff?" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/<Message>.*No staff stay/);
    expect(await messagesFrom(FROM)).toBe(2);
    const mail = await emailPOST(inboundReq("email", { From: "sam@example.com", FromName: "Sam", Body: "How many kegs fit?" }));
    expect(mail.status).toBe(200);
    const c = (await doc()).conversations.find((x) => x.contact === "sam@example.com")!;
    expect([c.channel, c.name, c.messages.length]).toEqual(["email", "Sam", 2]);
  });

  test.each([
    ["one changed form field", { tamper: (f: [string, string][]) => f.map(([k, v]): [string, string] => [k, k === "Body" ? "cancel SST-1052" : v]) }],
    ["an added form field", { tamper: (f: [string, string][]) => [...f, ["state", "{}"] as [string, string]] }],
    ["a changed URL", { url: "http://evil.test/api/inbound/sms" }],
    ["the wrong secret", { secret: "guess" }],
    ["a missing header", { signature: null }],
    ["an empty header", { signature: "" }],
  ])("%s gets 403 and stores nothing", async (_, opts) => {
    await setup();
    const before = await doc();
    expect((await smsPOST(inboundReq("sms", { From: FROM, Body: "hi" }, opts))).status).toBe(403);
    expect(await doc()).toEqual(before);
  });

  test("an SMS signature does not work on the email route", async () => {
    await setup();
    expect((await emailPOST(inboundReq("email", { From: "sam@example.com", Body: "hi" }, { secret: DEV_WEBHOOK_SECRET.sms }))).status).toBe(403);
  });

  test("the review's origin bypass: no Origin, a forged Origin and Host, still 403 without a signature", async () => {
    await setup();
    for (const headers of [{}, { origin: "https://evil.test", host: "evil.test" }] as Record<string, string>[]) {
      const req = new Request(inboundUrl("sms"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams({ From: FROM, To: "0480 016 450", Body: "hi", MessageSid: "SM1" }) });
      expect((await smsPOST(req)).status).toBe(403);
    }
    expect(await messagesFrom(FROM)).toBe(0);
  });

  test("a replayed signed request returns 200 with no agent run", async () => {
    await setup();
    const fields = { From: FROM, Body: "Do you supply staff?", MessageSid: "SMreplay1" };
    expect((await smsPOST(inboundReq("sms", fields))).status).toBe(200);
    const again = await smsPOST(inboundReq("sms", fields));
    expect(again.status).toBe(200);
    expect(await again.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(await messagesFrom(FROM)).toBe(2);
  });
});

describe("the simulate route (KTD12)", () => {
  const simReq = () =>
    new Request("http://localhost:3000/api/dev/simulate", {
      method: "POST",
      headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ channel: "sms", contact: FROM, body: "Do you supply staff?" }),
    });

  test("returns 404 in production with DEMO_MODE off", async () => {
    await setup();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "");
    expect((await simulatePOST(simReq())).status).toBe(404);
    expect(await messagesFrom(FROM)).toBe(0);
  });

  test("works in production with DEMO_MODE on, signing with the configured secret", async () => {
    await setup();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "on");
    vi.stubEnv("PUBLIC_BASE_URL", "https://demo.example.com");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "configured-token");
    const res = await simulatePOST(simReq());
    expect(res.status).toBe(200);
    expect((await res.json()).conversation.messages.at(-1).body).toMatch(/No staff stay/);
    // The secret is the configured one: a request signed with the dev default is refused.
    expect((await smsPOST(new Request("https://demo.example.com/api/inbound/sms", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(DEV_WEBHOOK_SECRET.sms, "https://demo.example.com/api/inbound/sms", [["From", FROM]]) }, body: "From=0400+222+301" }))).status).toBe(403);
  });

  test("works outside production with no env set", async () => {
    await setup();
    expect((await simulatePOST(simReq())).status).toBe(200);
  });
});
