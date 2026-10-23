import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, createRepo } from "@/lib/server/db/repo";
import { inboundWebhook } from "@/lib/server/inbound";
import { DAILY_TOKENS, SENDER_PER_MINUTE, TENANT_PER_MINUTE, admit, overBudget, spend } from "@/lib/server/limits";
import { NOW, inboundReq } from "../helpers";

const h = vi.hoisted(() => ({ repo: undefined as unknown as Repo }));
vi.mock("@/lib/server/db/repo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/db/repo")>()), getRepo: async () => h.repo }));

const open: Connection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function setup() {
  const c = await connect({ NODE_ENV: "test" }, "memory://");
  open.push(c);
  h.repo = createRepo(c.db);
  await h.repo.seedDemo(NOW);
  return h.repo;
}

const sms = (from: string, body: string, opts: { client?: Anthropic; now?: Date; xff?: string } = {}) => {
  const req = inboundReq("sms", { From: from, Body: body });
  if (opts.xff) req.headers.set("x-forwarded-for", opts.xff);
  return inboundWebhook("sms", req, { now: opts.now ?? NOW, client: opts.client });
};

// A model client that answers every call with the same text and reports `tokens` used.
function model(tokens: number) {
  let calls = 0;
  const client = {
    beta: { messages: { create: async () => (calls++, { stop_reason: "end_turn", content: [{ type: "text", text: "Hi from the model." }], usage: { input_tokens: tokens - 10, output_tokens: 10 } }) } },
  } as unknown as Anthropic;
  return { client, calls: () => calls };
}

describe("rate limits key on the business and the signed sender (KTD8)", () => {
  test(`message ${SENDER_PER_MINUTE + 1} in a minute from one sender is limited, while another sender still gets replies`, async () => {
    await setup();
    const statuses: number[] = [];
    // The review's rotating X-Forwarded-For probe: a new IP on every request changes nothing.
    for (let i = 0; i <= SENDER_PER_MINUTE; i++) statuses.push((await sms("0400 333 401", `hi ${i}`, { xff: `10.0.0.${i}` })).status);
    expect(statuses.slice(0, SENDER_PER_MINUTE).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const other = await sms("0400 333 402", "Do you supply staff?");
    expect(other.status).toBe(200);
    expect(await other.text()).toMatch(/No staff stay/);
    // The limited message stored nothing and ran no agent.
    const c = (await h.repo.load(DEMO_TENANT))!.data.conversations.find((x) => x.contact === "0400 333 401")!;
    expect(c.messages.filter((m) => m.from === "customer")).toHaveLength(SENDER_PER_MINUTE);
    // The next minute the sender is let through again.
    expect((await sms("0400 333 401", "back", { now: new Date(NOW.getTime() + 60_000) })).status).toBe(200);
  });

  test("the business has a limit across all senders", async () => {
    const repo = await setup();
    for (let i = 0; i < TENANT_PER_MINUTE; i++) expect(await admit(repo, DEMO_TENANT, `04${String(i).padStart(8, "0")}`, NOW)).toBeUndefined();
    expect(await admit(repo, DEMO_TENANT, "0400 999 000", NOW)).toBe("tenant");
    expect(await admit(repo, DEMO_TENANT, "0400 999 000", new Date(NOW.getTime() + 60_000))).toBeUndefined();
  });

  test("a sender's count ignores spacing and case", async () => {
    const repo = await setup();
    for (let i = 0; i < SENDER_PER_MINUTE; i++) await admit(repo, DEMO_TENANT, i % 2 ? "0400 444 501" : "0400444501", NOW);
    expect(await admit(repo, DEMO_TENANT, "0400 444 501", NOW)).toBe("sender");
  });
});

describe("the daily model budget (R17)", () => {
  test("each model call's tokens are recorded against the business's day", async () => {
    const repo = await setup();
    const m = model(1500);
    expect((await sms("0400 555 601", "hello", { client: m.client })).status).toBe(200);
    expect(m.calls()).toBe(1);
    const day = new Date("2026-10-22T00:00:00+08:00");
    expect(await repo.counted(DEMO_TENANT, "tokens", day)).toBe(1500);
  });

  test("a business over its daily token budget gets the rules engine and one owner alert, not a model call", async () => {
    const repo = await setup();
    await spend(repo, DEMO_TENANT, DAILY_TOKENS, NOW);
    const m = model(1500);
    for (const body of ["Do you supply staff?", "How many kegs fit?"]) {
      const res = await sms("0400 555 602", body, { client: m.client });
      expect(res.status).toBe(200);
    }
    expect(m.calls()).toBe(0);
    const c = (await repo.load(DEMO_TENANT))!.data.conversations.find((x) => x.contact === "0400 555 602")!;
    expect(c.messages.filter((x) => x.from === "agent").map((x) => x.body)[0]).toMatch(/No staff stay/);
    const alerts = (await repo.readOutbox(DEMO_TENANT)).filter((o) => o.subject === "The agent hit its daily model budget");
    expect(alerts).toHaveLength(1);
    // The next Perth day the model answers again.
    const tomorrow = new Date("2026-10-23T09:00:00+08:00");
    expect(await overBudget(repo, DEMO_TENANT, tomorrow)).toBe(false);
    await sms("0400 555 602", "thanks", { client: m.client, now: tomorrow });
    expect(m.calls()).toBe(1);
  });
});
