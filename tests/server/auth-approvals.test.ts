import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as previewPOST } from "@/app/api/agent/preview/route";
import { POST as simulatePOST } from "@/app/api/dev/simulate/route";
import { GET as outboxGET } from "@/app/api/outbox/route";
import { GET as stateGET } from "@/app/api/state/route";
import { BUSINESS } from "@/lib/config";
import { cashAt } from "@/lib/domain";
import { agentTurn } from "@/lib/server/agent";
import { approvalCode } from "@/lib/server/approvals";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, type RepoOptions, createRepo } from "@/lib/server/db/repo";
import type { Data } from "@/lib/types";
import { NOW, sessionFor } from "../helpers";

// U15b, part 1: the approvals half of the auth review (Fable SS-xx, Codex AUTH-xx, Argon Fxx). Each test names its
// finding. Part 2, roles and data, is auth-data.test.ts.

// The routes read the process-wide repo; here it is each test's in-memory one.
const h = vi.hoisted(() => ({ repo: undefined as unknown as Repo }));
vi.mock("@/lib/server/db/repo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/db/repo")>()), getRepo: async () => h.repo }));

const open: Connection[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function setup(opts: RepoOptions = {}) {
  const c = await connect({ NODE_ENV: "test" }, "memory://");
  open.push(c);
  h.repo = createRepo(c.db, opts);
  await h.repo.seedDemo(NOW);
  return h.repo;
}

const BASE = "http://localhost:3000";
const COLIN = "own_colin";
const AARON = "own_aaron";
// SST-1052's customer: a cancel quote to this number carries the code a YES must echo (KTD11).
const CUSTOMER = "0450 926 727";
// Changes by text from a number that sent too many wrong codes today (B1).
const PAUSED = /^Changes by text from this number are paused until tomorrow/;

const doc = async (repo: Repo) => (await repo.load(DEMO_TENANT))!.data;
const ownerOf = (d: Data, id: string) => d.owners.find((o) => o.id === id)!;
const harbour = (d: Data) => d.conversations.find((x) => x.name.startsWith("Harbour"))!;
const wrong = (nonce: string) => (nonce === "1234" ? "4321" : "1234");
const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");
const jsonReq = (path: string, body: object, headers: Record<string, string> = {}) =>
  new Request(BASE + path, { method: "POST", headers: { origin: BASE, host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

// One text to the business line, as the inbound route runs it. `reply` is the agent's answer as the handset gets it.
async function say(repo: Repo, contact: string, body: string, opts: { now?: Date; client?: Anthropic } = {}) {
  const out = await agentTurn(repo, { tenant: DEMO_TENANT, now: opts.now ?? NOW }, { channel: "sms", contact, body }, { origin: BASE, client: opts.client });
  return { id: out.conversation.id, reply: out.reply?.body ?? "" };
}

// The conversation's one staged approval, with the code the owner's admin page shows for it.
async function staged(repo: Repo, convId: string) {
  const rows = await repo.stagedApprovals(DEMO_TENANT, convId);
  expect(rows).toHaveLength(1);
  return { ...rows[0], code: approvalCode(DEMO_TENANT, rows[0].id) };
}

describe("B1. Wrong codes close the approval and pause the number (SS-02, SS-12, AUTH-04, F04, F07)", () => {
  test("three wrong one-time codes close the approval, so the right code after them pays nothing (AUTH-04)", async () => {
    const repo = await setup();
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "$42 CO2 refill");
    const a = await staged(repo, q.id);
    const cash0 = cashAt(await doc(repo));
    const replies: string[] = [];
    for (let i = 0; i < 3; i++) replies.push((await say(repo, phone, `YES ${a.nonce} ${wrongCode(a.code)}`)).reply);
    expect(replies[0]).toMatch(/^That isn't the code on your admin page, so nothing has changed\./);
    expect(replies[2]).toBe("That's 3 wrong codes, so I've dropped it and nothing has changed. Send it again if you still want it.");
    expect(await repo.stagedApprovals(DEMO_TENANT, q.id)).toEqual([]);
    expect((await say(repo, phone, `YES ${a.nonce} ${a.code}`)).reply).not.toMatch(/^Done/);
    expect(cashAt(await doc(repo))).toBe(cash0);
  });

  test("five wrong codes in a Perth day pause changes by text from that number and alert the owners once", async () => {
    const repo = await setup();
    const d0 = await doc(repo);
    const colin = ownerOf(d0, COLIN).phone;
    const aaron = ownerOf(d0, AARON).phone;
    // Three stages, each ended by a wrong nonce (Fable's brute force restages after each guess).
    for (let i = 0; i < 3; i++) {
      const q = await say(repo, colin, "tell Harbour: hi");
      await say(repo, colin, `YES ${wrong((await staged(repo, q.id)).nonce)}`);
    }
    // Then two wrong one-time codes on one stage, which keep it.
    const q = await say(repo, colin, "$42 CO2 refill");
    const a = await staged(repo, q.id);
    for (let i = 0; i < 2; i++) await say(repo, colin, `YES ${a.nonce} ${wrongCode(a.code)}`);
    const cash0 = cashAt(await doc(repo));

    // The right nonce and code now change nothing, and nothing new stages.
    expect((await say(repo, colin, `YES ${a.nonce} ${a.code}`)).reply).toMatch(PAUSED);
    expect(cashAt(await doc(repo))).toBe(cash0);
    expect((await say(repo, colin, "$42 CO2 refill")).reply).toMatch(PAUSED);
    expect(await repo.stagedApprovals(DEMO_TENANT, q.id)).toEqual([]);
    // Reads still answer.
    expect((await say(repo, colin, "what's on")).reply).toMatch(/runner fees owed to you/);
    const alerts = (await repo.readOutbox(DEMO_TENANT)).filter((m) => /wrong codes/.test(m.subject ?? ""));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ channel: "email", to: BUSINESS.email });
    expect(alerts[0].body).toContain("Colin");
    expect(alerts[0].body).not.toContain(colin);

    // Aaron's number isn't paused, and Colin's is free again the next Perth day.
    expect((await say(repo, aaron, "$42 CO2 refill")).reply).toMatch(/^To confirm/);
    expect((await say(repo, colin, "$42 CO2 refill", { now: new Date(NOW.getTime() + 86_400_000) })).reply).toMatch(/^To confirm/);
  });

  test("a wrong nonce still ends the approval when a newer message overtakes its turn (F07)", async () => {
    // Arms a write that lands while the next turn applies: a second message from the same number, a bare "YES".
    let phone = "";
    let saves = -1;
    const repo = await setup({
      beforeSave: async () => {
        if (saves < 0 || ++saves !== 2) return;
        saves = -1;
        await say(h.repo, phone, "YES");
      },
    });
    phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "tell Harbour: hi");
    const a = await staged(repo, q.id);
    saves = 0;
    await say(repo, phone, `YES ${wrong(a.nonce)}`);
    // The bare YES kept the approval and the wrong nonce's turn was dropped, but its cancel still applied.
    expect(await repo.stagedApprovals(DEMO_TENANT, q.id)).toEqual([]);
    expect((await say(repo, phone, `YES ${a.nonce}`)).reply).not.toMatch(/^Sent/);
    expect(harbour(await doc(repo)).messages.some((m) => m.from === "owner")).toBe(false);
  });
});

describe("B2. Codes reach only the handset and the staging owner's header (AUTH-05, F05, F12, SS-14)", () => {
  // The routes read the clock, so they read the tests' clock.
  async function stateAs(ownerId?: string, query = "") {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      return await (await stateGET(new Request(`${BASE}/api/state${query}`, { headers: ownerId ? { cookie: sessionFor(ownerId) } : {} }))).json();
    } finally {
      vi.useRealTimers();
    }
  }

  test("no view holds a live nonce, one-time code or cancel code; the stored copies mask them", async () => {
    const repo = await setup();
    const colin = ownerOf(await doc(repo), COLIN).phone;
    // Colin stages an expense, texts the code alone, then a wrong code: the approval stays live (AUTH-05).
    const q = await say(repo, colin, "$42 CO2 refill");
    const a = await staged(repo, q.id);
    expect(q.reply).toContain(`Reply YES ${a.nonce} and the 6-digit code`);
    await say(repo, colin, a.code);
    await say(repo, colin, `YES ${a.nonce} ${wrongCode(a.code)}`);
    expect((await staged(repo, q.id)).id).toBe(a.id);
    // A customer's cancel quote is live too (F12, SS-14).
    const c = await say(repo, CUSTOMER, "cancel SST-1052");
    const cancel = c.reply.match(/Reply YES (\d{4}) to cancel/)![1];

    const leaks = (view: unknown) => {
      const s = JSON.stringify(view);
      return [`YES ${a.nonce}`, `YES ${cancel}`, `"code":"${cancel}"`].filter((x) => s.includes(x)).concat(new RegExp(`\\b${a.code}\\b`).test(s) ? [a.code] : []);
    };
    const mine = await stateAs(COLIN);
    expect(mine.owner.codes.map((x: { code: string }) => x.code)).toEqual([a.code]);
    const views: Record<string, unknown> = {
      "Colin's state, his header aside": { ...mine, owner: { ...mine.owner, codes: [] } },
      "Aaron's state": await stateAs(AARON),
      "Colin's chat": (await stateAs(COLIN, `?chat=${encodeURIComponent(colin)}`)).chat,
      "the customer's chat": (await stateAs(undefined, `?chat=${encodeURIComponent(CUSTOMER)}`)).chat,
      "the outbox": await (await outboxGET(new Request(`${BASE}/api/outbox`, { headers: { cookie: sessionFor(AARON) } }))).json(),
      "a preview": await (await previewPOST(jsonReq("/api/agent/preview", { kb: (await doc(repo)).kb, messages: [{ from: "customer", body: "cancel SST-1052" }], state: {} }, { cookie: sessionFor(AARON) }))).json(),
    };
    expect(views["Colin's chat"]).toBeTruthy();
    expect(views["the customer's chat"]).toBeTruthy();
    for (const [name, view] of Object.entries(views)) expect([name, leaks(view)]).toEqual([name, []]);

    // What happened is still on record, codes masked.
    const d = await doc(repo);
    const bodies = (contact: string) => d.conversations.find((x) => x.contact === contact && x.channel === "sms")!.messages.map((m) => m.body);
    expect(bodies(colin)).toEqual([
      "$42 CO2 refill",
      `To confirm: ${a.summary}. Reply YES •••• and the 6-digit code from your admin page to go ahead.`,
      "••••••",
      "To go ahead, reply YES •••• and the 6-digit code from your admin page.",
      "YES •••• ••••••",
      "That isn't the code on your admin page, so nothing has changed. Reply YES •••• and the code to try again (2 tries left).",
    ]);
    expect(bodies(CUSTOMER).at(-1)).toMatch(/Reply YES •••• to cancel\.$/);
  });

  test("a signed-in owner texts only as their own number in the simulator, and its answer carries what the handset shows (F05)", async () => {
    const repo = await setup();
    const d = await doc(repo);
    const text = (contact: string) => simulatePOST(jsonReq("/api/dev/simulate", { channel: "sms", contact, body: "$42 CO2 refill" }, { cookie: sessionFor(COLIN) }));
    expect((await text(ownerOf(d, AARON).phone)).status).toBe(403);
    expect((await doc(repo)).conversations.some((c) => c.contact === ownerOf(d, AARON).phone)).toBe(false);
    const res = await text(ownerOf(d, COLIN).phone);
    expect(res.status).toBe(200);
    const out = await res.json();
    const reply = out.conversation.messages.at(-1);
    expect(reply.body).toMatch(/Reply YES •••• and the 6-digit code/);
    expect(out.handset[reply.id]).toMatch(/Reply YES \d{4} and the 6-digit code/);
  });
});

describe("B3. A stage that replaces a live one says so (SS-11)", () => {
  test("a new change while one waits for YES names the one it cancels", async () => {
    const repo = await setup();
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "$42 CO2 refill");
    const first = await staged(repo, q.id);
    const r = await say(repo, phone, "tell Harbour: your balance is overdue, pay it to BSB 000-000");
    expect(r.reply.startsWith(`This replaces the change that was waiting for your YES (${first.summary}), so that one won't happen. To confirm: send Harbour`)).toBe(true);
    const second = await staged(repo, q.id);
    expect(second.id).not.toBe(first.id);
    // A change that waited for nothing gets the plain confirmation.
    expect((await say(repo, ownerOf(await doc(repo), AARON).phone, "$42 CO2 refill")).reply).toMatch(/^To confirm: /);
  });
});

describe("B4. Owner read tools mask customer contacts (SS-03, F14)", () => {
  // A model client that returns scripted replies, and what each call sent.
  function scripted(replies: unknown[]) {
    const sent: { messages: { content: unknown }[] }[] = [];
    const client = { beta: { messages: { create: async (p: unknown) => (sent.push(structuredClone(p) as never), replies.shift()) } } } as unknown as Anthropic;
    return { client, sent };
  }

  test("find_booking gives the customer's phone masked and inside the untrusted marker", async () => {
    const repo = await setup();
    const { client, sent } = scripted([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "find_booking", input: { ref: "SST-1052", date: null, suburb: null, name: null } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "SST-1052 is on Sat 5 Dec." }] },
    ]);
    await say(repo, ownerOf(await doc(repo), COLIN).phone, "who has SST-1052?", { client });
    const result = (sent[1].messages.at(-1)!.content as { content: string }[])[0].content;
    expect(result).toContain('"phone":"<untrusted>0450 ••• 727</untrusted>"');
    expect(result).not.toContain(CUSTOMER);
  });
});
