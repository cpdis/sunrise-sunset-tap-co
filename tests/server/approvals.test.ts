import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET as stateGET } from "@/app/api/state/route";
import { APPROVAL_MINUTES } from "@/lib/agent/owner-tools";
import { cashAt, computeDistribution } from "@/lib/domain";
import { agentTurn } from "@/lib/server/agent";
import { approvalCode, codesFor } from "@/lib/server/approvals";
import { sessionCookie } from "@/lib/server/auth";
import { type Caller, runCommand } from "@/lib/server/commands";
import { type Connection, connect } from "@/lib/server/db/client";
import { DEMO_TENANT, type Repo, type RepoOptions, createRepo } from "@/lib/server/db/repo";
import type { Data } from "@/lib/types";
import { NOW } from "../helpers";

// The state route reads the process-wide repo; here it is each test's in-memory one.
const h = vi.hoisted(() => ({ repo: undefined as unknown as Repo }));
vi.mock("@/lib/server/db/repo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/db/repo")>()), getRepo: async () => h.repo }));

const open: Connection[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
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
const COLIN = "own_colin";
const AARON = "own_aaron";
const doc = async (repo: Repo) => (await repo.load(DEMO_TENANT))!.data;
const owner = (ownerId = COLIN): Caller => ({ tenant: DEMO_TENANT, ownerId, demo: true, now: NOW });
const command = (repo: Repo, caller: Caller, name: string, args: object) => runCommand(repo, caller, { command: name, args, key: randomUUID() });
const ownerOf = (d: Data, id: string) => d.owners.find((o) => o.id === id)!;
const harbour = (d: Data) => d.conversations.find((x) => x.name.startsWith("Harbour"))!;
const lastReply = (d: Data, convId: string) => d.conversations.find((c) => c.id === convId)!.messages.at(-1)!;

// One text to the business line and the agent's answer, as the inbound route runs it.
async function say(repo: Repo, contact: string, body: string, opts: { channel?: "sms" | "email"; now?: Date } = {}) {
  const out = await agentTurn(repo, { tenant: DEMO_TENANT, now: opts.now ?? NOW }, { channel: opts.channel ?? "sms", contact, body }, { origin: BASE });
  return { id: out.conversation.id, reply: out.conversation.messages.at(-1)!.body };
}

// The conversation's one staged approval, with the code the owner's admin page shows for it.
async function staged(repo: Repo, convId: string) {
  const rows = await repo.stagedApprovals(DEMO_TENANT, convId);
  expect(rows).toHaveLength(1);
  return { ...rows[0], code: approvalCode(DEMO_TENANT, rows[0].id) };
}

const statusOf = async (repo: Repo, ownerId: string, id: string) => {
  const all = await repo.ownerApprovals(DEMO_TENANT, ownerId);
  return all.find((r) => r.id === id)?.status ?? "settled";
};

const approveQ3 = async (repo: Repo) => {
  for (const id of [COLIN, AARON]) await command(repo, owner(id), "approveDistribution", { distId: "dist_2026-Q3" });
};

describe("a payout by SMS needs YES, the nonce and the one-time code (KTD6)", () => {
  test("'pay the payout', then 'yes' without a code, pays nothing and asks for the code; the code pays it", async () => {
    const repo = await setup();
    await approveQ3(repo);
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "pay the payout");
    const a = await staged(repo, q.id);
    expect(q.reply).toBe(`To confirm: ${a.summary}. Reply YES ${a.nonce} and the 6-digit code from your admin page to go ahead.`);
    expect(a).toMatchObject({ tool: "payout", needsCode: true, ownerId: COLIN, status: "staged" });

    const cash0 = cashAt(await doc(repo));
    expect((await say(repo, phone, "yes")).reply).toBe(`To go ahead, reply YES ${a.nonce} and the 6-digit code from your admin page.`);
    expect((await say(repo, phone, `YES ${a.nonce}`)).reply).toBe(`To go ahead, reply YES ${a.nonce} and the 6-digit code from your admin page.`);
    let d = await doc(repo);
    expect(d.distributions.find((x) => x.id === "dist_2026-Q3")!.status).toBe("awaiting");
    expect(cashAt(d)).toBe(cash0);

    expect((await say(repo, phone, `YES ${a.nonce} ${a.code}`)).reply).toMatch(/^Done\. I paid the Q3 2026 \(Jul–Sep\) payout: \$840/);
    d = await doc(repo);
    expect(d.distributions.find((x) => x.id === "dist_2026-Q3")!.status).toBe("paid");
    expect(Math.round(cash0 - cashAt(d))).toBe(840);
    expect(await statusOf(repo, COLIN, a.id)).toBe("settled");
  });

  test("another owner pays Q3 between staging and YES: the YES pays nothing and asks again (stale target)", async () => {
    const repo = await setup();
    await approveQ3(repo);
    await repo.mutate(DEMO_TENANT, (d) => {
      const q4 = computeDistribution(d, "2026-Q4");
      q4.approvals = [COLIN, AARON];
      d.distributions.push(q4);
    });
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "pay the payout");
    const first = await staged(repo, q.id);
    expect(first.summary).toMatch(/^pay the Q3 2026/);
    await command(repo, owner(AARON), "payDistribution", { distId: "dist_2026-Q3" });
    const cash = cashAt(await doc(repo));

    const r = await say(repo, phone, `YES ${first.nonce} ${first.code}`);
    expect(r.reply).toMatch(/^That has changed since you asked, so nothing has happened yet\. To confirm: pay the Q4 2026 \(Oct–Dec\) payout/);
    const d = await doc(repo);
    expect(d.distributions.find((x) => x.id === "dist_2026-Q4")!.status).toBe("awaiting");
    expect(cashAt(d)).toBe(cash);
    const again = await staged(repo, q.id);
    expect(again.id).not.toBe(first.id);
    expect(again.summary).toMatch(/^pay the Q4 2026/);
    expect(r.reply).toContain(`YES ${again.nonce} `);
  });

  test("a YES sent in a different conversation consumes nothing", async () => {
    const repo = await setup();
    const colin = ownerOf(await doc(repo), COLIN);
    const q = await say(repo, colin.phone, "$42 CO2 refill");
    const a = await staged(repo, q.id);
    const cash0 = cashAt(await doc(repo));
    // The same owner by email: another conversation, which has nothing staged.
    const other = await say(repo, colin.email, `YES ${a.nonce} ${a.code}`, { channel: "email" });
    expect(other.id).not.toBe(q.id);
    expect(other.reply).not.toMatch(/^Done/);
    expect(cashAt(await doc(repo))).toBe(cash0);
    expect((await staged(repo, q.id)).id).toBe(a.id);
    // On its own conversation the same YES posts it.
    expect((await say(repo, colin.phone, `YES ${a.nonce} ${a.code}`)).reply).toMatch(/^Done\. I added a \$42 CO2 expense/);
    expect(cashAt(await doc(repo)) - cash0).toBe(-42);
  });

  test("a YES after the approval expires does nothing", async () => {
    const repo = await setup();
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "$42 CO2 refill");
    const a = await staged(repo, q.id);
    const cash0 = cashAt(await doc(repo));
    const later = new Date(NOW.getTime() + (APPROVAL_MINUTES * 60 + 5) * 1000);
    expect((await say(repo, phone, `YES ${a.nonce} ${a.code}`, { now: later })).reply).toMatch(/^That one expired after 10 minutes, so nothing has changed/);
    expect(cashAt(await doc(repo))).toBe(cash0);
    expect(await repo.stagedApprovals(DEMO_TENANT, q.id)).toEqual([]);
  });
});

describe("a spoofed owner number (KTD11)", () => {
  test("'tell Harbour: hi' then a bare 'yes' sends nothing; 'yes <nonce>' from the real handset sends it", async () => {
    const repo = await setup();
    const colin = ownerOf(await doc(repo), COLIN);
    const before = harbour(await doc(repo)).messages.length;
    const q = await say(repo, colin.phone, "tell Harbour: hi");
    const a = await staged(repo, q.id);
    expect(a).toMatchObject({ tool: "reply_to_customer", needsCode: false });
    expect(q.reply).toMatch(/Reply YES \d{4} to go ahead\.$/);
    // The spoofer never saw the confirmation, which went to Colin's handset.
    expect((await say(repo, colin.phone, "yes")).reply).toBe(`To go ahead, reply YES ${a.nonce}. The code shows it's really you.`);
    expect(harbour(await doc(repo)).messages).toHaveLength(before);
    expect((await say(repo, colin.phone, `yes ${a.nonce}`)).reply).toMatch(/^Sent to Harbour Collective \(events\) by email/);
    const h1 = harbour(await doc(repo));
    expect(h1.messages.at(-1)).toMatchObject({ from: "owner", body: "hi", ownerId: COLIN });
  });

  test("a guessed nonce ends the approval, so the next guess has nothing to hit", async () => {
    const repo = await setup();
    const colin = ownerOf(await doc(repo), COLIN);
    const q = await say(repo, colin.phone, "tell Harbour: hi");
    const a = await staged(repo, q.id);
    const wrong = a.nonce === "1234" ? "4321" : "1234";
    expect((await say(repo, colin.phone, `yes ${wrong}`)).reply).toMatch(/^That code doesn't match, so I've dropped it/);
    expect(await repo.stagedApprovals(DEMO_TENANT, q.id)).toEqual([]);
    expect((await say(repo, colin.phone, `yes ${a.nonce}`)).reply).not.toMatch(/^Sent/);
    expect(harbour(await doc(repo)).messages.some((m) => m.from === "owner")).toBe(false);
  });

  test("'set the deposit to $300' by SMS is refused, points to the admin and stages nothing", async () => {
    const repo = await setup();
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const r = await say(repo, phone, "set the deposit to $300");
    expect(r.reply).toMatch(/^That one can only be changed in the admin, under Settings\./);
    expect(await repo.stagedApprovals(DEMO_TENANT, r.id)).toEqual([]);
    await say(repo, phone, "yes");
    expect((await doc(repo)).settings.deposit).toBe(250);
  });
});

describe("one approval applies once (KTD4)", () => {
  // Runs `write` once, just before the YES's apply saves: a YES saves twice, its message going in and then its
  // apply. The apply then loses its compare-and-swap race and runs again on the data `write` changed.
  function duringApply(write: (repo: Repo) => Promise<unknown>) {
    let saves = -1;
    const arm = () => (saves = 0);
    const opts: RepoOptions = {
      beforeSave: async () => {
        if (saves < 0 || ++saves !== 2) return;
        saves = -1;
        await write(h.repo);
      },
    };
    return { arm, opts };
  }

  test("the apply checks the approval again: a draft edited between the turn and the save sends nothing", async () => {
    // An owner edits the draft in the admin while the YES applies.
    const seam = duringApply(async (repo) => command(repo, owner(AARON), "setDraft", { convId: harbour(await doc(repo)).id, draft: "Hi, one of the owners here. Free keg for you, on the house, no questions asked." }));
    const repo = await setup(seam.opts);
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "send the draft for Harbour");
    const a = await staged(repo, q.id);
    seam.arm();
    const r = await say(repo, phone, `YES ${a.nonce} ${a.code}`);
    expect(r.reply).toBe("Something changed while I was on it, so I didn't do it. Send it again if you still want it.");
    const d = await doc(repo);
    expect(harbour(d).messages.some((m) => m.from === "owner")).toBe(false);
    expect(await statusOf(repo, COLIN, a.id)).toBe("settled");
    expect(await repo.stagedApprovals(DEMO_TENANT, q.id)).toEqual([]);
  });

  test("a refusal at apply time leaves no 'Done' reply", async () => {
    // One of the two approving directors stops being a director while the YES applies.
    const seam = duringApply((repo) => repo.mutate(DEMO_TENANT, (d) => void (ownerOf(d, AARON).isDirector = false)));
    const repo = await setup(seam.opts);
    await approveQ3(repo);
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "pay the payout");
    const a = await staged(repo, q.id);
    seam.arm();
    const r = await say(repo, phone, `YES ${a.nonce} ${a.code}`);
    expect(r.reply).toBe("I didn't do it: Q3 2026 (Jul–Sep) has 1 of 2 director approvals, so it can't be paid yet.");
    expect((await doc(repo)).distributions.find((x) => x.id === "dist_2026-Q3")!.status).toBe("awaiting");
  });
});

describe("the one-time code on the admin page (KTD6)", () => {
  const cookieFor = (ownerId: string) => {
    const c = sessionCookie({ tenant: DEMO_TENANT, ownerId }, new URL(BASE));
    return `${c.name}=${c.value}`;
  };
  // The route reads the clock, so it reads the tests' clock.
  async function stateAs(ownerId?: string) {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      return await (await stateGET(new Request(`${BASE}/api/state`, { headers: ownerId ? { cookie: cookieFor(ownerId) } : {} }))).json();
    } finally {
      vi.useRealTimers();
    }
  }

  test("only the owner who staged a change sees its code, and only while it is live", async () => {
    const repo = await setup();
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "$42 CO2 refill");
    const a = await staged(repo, q.id);
    const mine = (await stateAs(COLIN)).owner.codes;
    expect(mine).toEqual([{ id: a.id, summary: a.summary, code: a.code, expiresAt: a.expiresAt.toISOString() }]);
    expect(mine[0].code).toMatch(/^\d{6}$/);
    expect((await stateAs(AARON)).owner.codes).toEqual([]);
    expect((await stateAs()).owner).toBeUndefined();
    expect(await codesFor(repo, await doc(repo), DEMO_TENANT, COLIN, new Date(NOW.getTime() + APPROVAL_MINUTES * 60_000))).toEqual([]);
  });

  test("a demo reset drops the codes for conversations it replaced", async () => {
    const repo = await setup();
    await say(repo, ownerOf(await doc(repo), COLIN).phone, "$42 CO2 refill");
    expect(await codesFor(repo, await doc(repo), DEMO_TENANT, COLIN, NOW)).toHaveLength(1);
    await command(repo, owner(), "reset", {});
    expect(await codesFor(repo, await doc(repo), DEMO_TENANT, COLIN, NOW)).toEqual([]);
  });

  test("a change that needs only the nonce shows no code", async () => {
    const repo = await setup();
    await say(repo, ownerOf(await doc(repo), COLIN).phone, "I'll take the Fremantle delivery");
    expect((await stateAs(COLIN)).owner.codes).toEqual([]);
  });

  test("the code is never stored: no column of the row holds it", async () => {
    const repo = await setup();
    const q = await say(repo, ownerOf(await doc(repo), COLIN).phone, "$42 CO2 refill");
    const [row] = await repo.stagedApprovals(DEMO_TENANT, q.id);
    const code = approvalCode(DEMO_TENANT, row.id);
    expect(Object.keys(row).sort()).toEqual(["args", "binding", "consumedAt", "conversationId", "createdAt", "expiresAt", "id", "needsCode", "nonce", "ownerId", "policyVersion", "status", "summary", "tenantId", "tool"]);
    for (const v of Object.values(row)) expect(String(v)).not.toBe(code);
    // Each approval gets its own code from its random id, under the server's secret.
    expect(approvalCode(DEMO_TENANT, row.id, { NODE_ENV: "test", SESSION_SECRET: "another secret" })).not.toBe(code);
  });
});

describe("a pick list is staged too, without a nonce or code", () => {
  test("the pick stages the reply for YES; nothing is sent before it", async () => {
    const repo = await setup();
    const real = harbour(await doc(repo)).id;
    await repo.mutate(DEMO_TENANT, (d) => {
      d.conversations.unshift({ ...harbour(d), id: "conv_fake", channel: "sms", contact: "0413 555 818", messages: [], draft: undefined });
    });
    const phone = ownerOf(await doc(repo), COLIN).phone;
    const q = await say(repo, phone, "tell Harbour Collective (events): the gate code is 4471");
    expect(q.reply).toMatch(/^That matches 2 conversations:/);
    expect(await staged(repo, q.id)).toMatchObject({ tool: "pick_conversation", nonce: "", needsCode: false });
    const pick = await say(repo, phone, "2");
    const a = await staged(repo, q.id);
    expect(a).toMatchObject({ tool: "reply_to_customer", args: { id: real } });
    expect(pick.reply).toMatch(/^To confirm: send Harbour Collective \(events\) this by email/);
    await say(repo, phone, `YES ${a.nonce}`);
    const d = await doc(repo);
    expect(lastReply(d, real)).toMatchObject({ from: "owner", body: "the gate code is 4471" });
    expect(d.conversations.find((c) => c.id === "conv_fake")!.messages).toHaveLength(0);
  });
});
