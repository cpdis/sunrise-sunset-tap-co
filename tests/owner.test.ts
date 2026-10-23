import { describe, expect, test } from "vitest";
import { runOwnerRules } from "@/lib/agent/owner-rules";
import type { OwnerCtx } from "@/lib/agent/owner-tools";
import { balance, cashAt } from "@/lib/domain";
import { applyOwnerAction } from "@/lib/ops";
import { ownerSnapshot } from "@/lib/store";
import type { AgentState, Conversation } from "@/lib/types";
import { NOW, chat, ownerChat, seed } from "./helpers";

const COLIN = "own_colin";
const AARON = "own_aaron";
const types = (r: { actions: { type: string }[] }) => r.actions.map((a) => a.type);
const byRef = (d: ReturnType<typeof seed>, ref: string) => d.bookings.find((b) => b.ref === ref)!;

describe("low stakes run at once", () => {
  test("what's on lists unclaimed runs and the waiting payout", () => {
    const [r] = ownerChat(seed(), COLIN, ["What's on?"]);
    expect(r.reply).toMatch(/Unclaimed: SST-1046 Sat 14 Nov Victoria Park/);
    expect(r.reply).toMatch(/payout.*0 of 2 approvals, yours is needed/);
  });

  test("claims the Fremantle delivery (East Fremantle, SST-1049)", () => {
    const d = seed();
    const [r] = ownerChat(d, COLIN, ["I'll take the Fremantle delivery"]);
    expect(r.reply).toMatch(/delivery for SST-1049/);
    expect(byRef(d, "SST-1049").deliver.ownerId).toBe(COLIN);
    expect(byRef(d, "SST-1049").collect.ownerId).toBeUndefined();
  });

  test("logs the odometer and rejects a lower reading", () => {
    const d = seed();
    const [ok, bad] = ownerChat(d, COLIN, ["log 115,900 km", "log 115,000 km"]);
    expect(ok.reply).toMatch(/115,900 km \(413 km since/);
    expect(bad.reply).toMatch(/can't be right/);
    expect(d.truck.filter((l) => l.odometer === 115900)).toHaveLength(1);
  });

  test("blocks a date and books own use", () => {
    const d = seed();
    const rs = ownerChat(d, COLIN, ["block out Tuesday 15 December", "I want the truck for us on Wednesday 16 December"]);
    expect(d.blackouts).toContain("2026-12-15");
    expect(d.bookings.some((b) => b.kind === "personal" && b.date === "2026-12-16" && b.ownerId === COLIN)).toBe(true);
    expect(rs[1].reply).toMatch(/own use/);
  });

  test("reply takes the customer chat over; hand back returns it", () => {
    const d = seed();
    const [r] = ownerChat(d, COLIN, ["tell Harbour: Happy to talk festival rates, I'll call you Monday."]);
    const c = d.conversations.find((x) => x.name.startsWith("Harbour"))!;
    expect(r.reply).toMatch(/^Sent to Harbour Collective \(events\) by email to events@harbourcollective\.com\.au\. You have that chat now/);
    expect(c.agentActive).toBe(false);
    expect(c.messages.at(-1)).toMatchObject({ from: "owner", ownerId: COLIN });
    ownerChat(d, COLIN, ["hand back Harbour"]);
    expect(c.agentActive).toBe(true);
  });
});

describe("hand back keeps the agent's promise", () => {
  const harbour = (d: ReturnType<typeof seed>) => d.conversations.find((x) => x.name.startsWith("Harbour"))!;

  test("refused while the customer is owed a reply; 'anyway' forces it", () => {
    const d = seed();
    const [refused] = ownerChat(d, COLIN, ["hand back Harbour"]);
    expect(refused.reply).toMatch(/was told an owner will reply, and nobody has\. Reply first, send the agent's draft/);
    expect(harbour(d).agentActive).toBe(false);
    const [forced] = ownerChat(d, COLIN, ["hand back Harbour anyway"]);
    expect(forced.reply).toMatch(/^Handed Harbour Collective \(events\) back to the agent\. Heads up/);
    expect(harbour(d).agentActive).toBe(true);
  });

  test.each(["hand Harbour back anyway", "hand Harbour back to the agent without replying", "hand back to the agent Harbour anyway"])("%s", (msg) => {
    const d = seed();
    const [r] = ownerChat(d, COLIN, [msg]);
    expect(r.reply).toMatch(/^Handed Harbour Collective \(events\) back to the agent\. Heads up/);
    expect(harbour(d).agentActive).toBe(true);
  });

  test("a phone caller's reply goes by SMS to their number", () => {
    const d = seed();
    const caller = d.conversations.find((x) => x.channel === "phone")!;
    const [r] = ownerChat(d, COLIN, [`tell ${caller.name}: Yes, flat ground is all we need.`]);
    expect(r.reply).toMatch(new RegExp(`by SMS to ${caller.contact}`));
    expect(caller.messages.at(-1)).toMatchObject({ from: "owner", via: "sms", to: caller.contact });
  });

  test("send the draft: staged with the full text, sent on YES", () => {
    const d = seed();
    const draft = harbour(d).draft!;
    expect(draft).toBeTruthy();
    const [staged, done] = ownerChat(d, COLIN, ["send the draft for Harbour", "yes"]);
    expect(staged.reply).toContain(`by email to events@harbourcollective.com.au: "${draft}"`);
    expect(done.reply).toMatch(/^Done\. I sent Harbour/);
    expect(harbour(d).messages.at(-1)).toMatchObject({ from: "owner", body: draft, ownerId: COLIN, via: "email" });
    expect(harbour(d).draft).toBeUndefined();
  });

  test("send the draft refuses a greeting-only stub", () => {
    const d = seed();
    harbour(d).draft = "Hi, one of the owners here. ";
    const [r] = ownerChat(d, COLIN, ["send the draft for Harbour"]);
    expect(r.reply).toBe(`The agent only drafted a greeting. Text "tell Harbour: ..." instead.`);
    expect(r.state.pending).toBeUndefined();
    expect(harbour(d).messages.some((m) => m.from === "owner")).toBe(false);
  });

  test("a flag-only hand-over is cleared, not handed back, and still needs 'anyway'", () => {
    const d = seed();
    const c = d.conversations.find((x) => x.agentActive && !x.ownerId)!;
    c.escalated = "Short-notice request for Mon 26 Oct 2026";
    const first = c.name.split(" ")[0];
    const [refused, forced] = ownerChat(d, COLIN, [`hand back ${first}`, `hand back ${first} anyway`]);
    expect(refused.reply).toMatch(/was told an owner will reply/);
    expect(forced.reply).toBe(`Cleared the flag on ${c.name}; the agent still has it. Heads up: they were told an owner would reply, and nobody has.`);
    expect(c.escalated).toBeUndefined();
    expect(c.messages.at(-1)?.body).toBe("Colin cleared the flag");
  });
});

describe("money and settings wait for YES", () => {
  test("expense: staged, then posted on YES", () => {
    const d = seed();
    const cash0 = cashAt(d);
    const co20 = balance(d, "co2");
    const [staged, done] = ownerChat(d, COLIN, ["$42 CO2 refill", "yes"]);
    expect(staged.reply).toMatch(/Reply YES/);
    expect(types(staged)).toEqual([]);
    expect(done.reply).toMatch(/^Done\. I added a \$42 CO2 expense/);
    expect(balance(d, "co2") - co20).toBe(-42);
    expect(cashAt(d) - cash0).toBe(-42);
  });

  test("any other text drops the staged change", () => {
    const d = seed();
    const cash0 = cashAt(d);
    ownerChat(d, COLIN, ["$42 CO2 refill", "what's on", "yes"]);
    expect(cashAt(d)).toBe(cash0);
  });

  // A prefix match used to read "okay, cancel that" and "yeah nah" as YES.
  test.each(["okay, cancel that", "yeah nah", "ok what's on", "go through the inbox"])("%s posts nothing", (reply) => {
    const d = seed();
    const cash0 = cashAt(d);
    const [, r] = ownerChat(d, COLIN, ["$42 CO2 refill", reply]);
    expect(r.reply).not.toMatch(/^Done\. I added/);
    expect(cashAt(d)).toBe(cash0);
  });

  test.each(["yes", "YES.", "yes please", "y"])("%s still confirms", (reply) => {
    const d = seed();
    const cash0 = cashAt(d);
    const [, r] = ownerChat(d, COLIN, ["$42 CO2 refill", reply]);
    expect(r.reply).toMatch(/^Done\. I added a \$42 CO2 expense/);
    expect(cashAt(d) - cash0).toBe(-42);
  });

  test("payout needs two directors, then pays", () => {
    const d = seed();
    const dist = d.distributions.find((x) => x.status === "awaiting")!;
    const total = dist.lines.reduce((s, l) => s + l.amount + l.runnerFees, 0);
    // Seeded Q3 2026: $0 dividends (profit $90) and $840 runner fees.
    expect(total).toBe(840);
    const cash0 = cashAt(d);
    const [, approved, early] = ownerChat(d, COLIN, ["approve the payout", "yes", "pay the payout"]);
    expect(approved.reply).toMatch(/1 of 2 approvals/);
    expect(early.reply).toMatch(/1 of 2 director approvals, so it can't be paid/);
    const again = ownerChat(d, COLIN, ["approve"]);
    expect(again[0].reply).toMatch(/already approved/);
    const [, second, , paid] = ownerChat(d, AARON, ["approve", "y", "pay the payout", "yes"]);
    expect(second.reply).toMatch(/enough approvals/);
    expect(paid.reply).toMatch(/^Done\. I paid/);
    expect(d.distributions.find((x) => x.id === dist.id)!.status).toBe("paid");
    expect(Math.round(cash0 - cashAt(d))).toBe(total);
  });

  test("pay is refused when it would spend customer money (review C09)", () => {
    const d = seed();
    ownerChat(d, COLIN, ["approve the payout", "yes"]);
    ownerChat(d, AARON, ["approve the payout", "yes"]);
    const [, posted, pay] = ownerChat(d, COLIN, ["$11203 maintenance", "yes", "pay the payout"]);
    expect(posted.reply).toMatch(/^Done\. I added a \$11,203/);
    const cash = cashAt(d);
    expect(pay.reply).toBe("Q3 2026 (Jul–Sep) can't be paid yet. $840 of it would come out of customer money, the reserve, tax or other runner fees owed.");
    expect(pay.state.pending).toBeUndefined();
    expect(d.distributions.find((x) => x.quarter === "2026-Q3")!.status).toBe("awaiting");
    expect(cashAt(d)).toBe(cash);
  });

  test("an expense between staging the pay and YES: the YES pays nothing", () => {
    const d = seed();
    ownerChat(d, COLIN, ["approve the payout", "yes"]);
    ownerChat(d, AARON, ["approve the payout", "yes"]);
    let state: AgentState = {};
    const send = (ownerId: string, text: string) => {
      const ctx: OwnerCtx = { data: ownerSnapshot(d, NOW), owner: d.owners.find((o) => o.id === ownerId)!, now: NOW, actions: [], used: [] };
      const r = runOwnerRules(ctx, text, state);
      state = r.state;
      r.actions.forEach((a) => applyOwnerAction(d, a, ownerId));
      return r;
    };
    expect(send(COLIN, "pay the payout").reply).toMatch(/^To confirm: pay the Q3 2026/);
    ownerChat(d, AARON, ["$11203 maintenance", "yes"]);
    const cash = cashAt(d);
    expect(send(COLIN, "yes").reply).toMatch(/^I didn't do it: Q3 2026 \(Jul–Sep\) can't be paid yet/);
    expect(cashAt(d)).toBe(cash);
  });

  test("a non-director can't pay, even with enough approvals", () => {
    const d = seed();
    d.owners.find((o) => o.id === "own_joe")!.isDirector = false;
    ownerChat(d, COLIN, ["approve the payout", "yes"]);
    ownerChat(d, AARON, ["approve the payout", "yes"]);
    const [r] = ownerChat(d, "own_joe", ["pay the payout"]);
    expect(r.reply).toBe("Only directors pay payouts.");
    expect(r.state.pending).toBeUndefined();
    expect(d.distributions.find((x) => x.quarter === "2026-Q3")!.status).toBe("awaiting");
  });

  test("an approval from an owner who is no longer a director doesn't count", () => {
    const d = seed();
    ownerChat(d, COLIN, ["approve the payout", "yes"]);
    ownerChat(d, AARON, ["approve the payout", "yes"]);
    d.owners.find((o) => o.id === COLIN)!.isDirector = false;
    const [r] = ownerChat(d, AARON, ["pay the payout"]);
    expect(r.reply).toBe("Q3 2026 (Jul–Sep) has 1 of 2 director approvals, so it can't be paid yet.");
  });

  test("setting change on YES; guardrail settings are admin only", () => {
    const d = seed();
    ownerChat(d, COLIN, ["set the deposit to $300", "yes"]);
    expect(d.settings.deposit).toBe(300);
    const [r] = ownerChat(d, COLIN, ["set approvals to 1"]);
    expect(r.reply).toMatch(/only be changed in the admin/);
    expect(d.settings.approvalsRequired).toBe(2);
  });

  test("knowledge line added on YES", () => {
    const d = seed();
    ownerChat(d, COLIN, ["add to keg guide: We now carry a second G-type coupler.", "yes"]);
    expect(d.kb.find((p) => p.slug === "keg-guide")!.body).toMatch(/- We now carry a second G-type coupler\.$/);
  });

  test("cancel within the limit runs on YES; a big refund goes to the admin", () => {
    const d = seed();
    const [, done] = ownerChat(d, COLIN, ["cancel SST-1057", "yes"]);
    expect(done.reply).toMatch(/cancelled SST-1057.*\$250 refund/);
    expect(byRef(d, "SST-1057").state).toBe("cancelled");
    const [big] = ownerChat(d, COLIN, ["cancel SST-1040"]);
    expect(big.reply).toMatch(/over the \$250 SMS limit/);
    expect(byRef(d, "SST-1040").state).toBe("balance_paid");
  });
});

describe("customer agent is unchanged", () => {
  test("a customer number still gets the customer agent", () => {
    const [r] = chat(seed(), "0499 000 111", ["What's on?"]);
    expect(r.reply).not.toMatch(/Unclaimed/);
  });
});

describe("two conversations share a name", () => {
  const REAL = "Harbour Collective (events)";
  // A customer who books under a real customer's name gets a conversation with that name, placed first.
  function withImpostor() {
    const d = seed();
    const real = d.conversations.find((x) => x.name === REAL)!;
    const fake: Conversation = { ...real, id: "conv_fake", channel: "sms", contact: "0413 555 818", messages: [], draft: undefined };
    d.conversations.unshift(fake);
    return { d, real, fake };
  }
  const got = (c: { messages: { from: string; body: string }[] }) => c.messages.filter((m) => m.from === "owner" && /4471/.test(m.body));

  test("a reply sends nothing and lists both with masked contacts", () => {
    const { d, real, fake } = withImpostor();
    const [r] = ownerChat(d, COLIN, [`tell ${REAL}: the gate code is 4471`]);
    expect(r.actions).toEqual([]);
    expect(r.reply).toBe(`That matches 2 conversations:\n1. ${REAL}, 0413 ••• 818\n2. ${REAL}, ev•••@harbourcollective.com.au\nReply with the number or the end of the contact.`);
    expect(got(real)).toHaveLength(0);
    expect(got(fake)).toHaveLength(0);
  });

  test.each(["2", "#2", "harbourcollective.com.au", "ev•••@harbourcollective.com.au", "the email one"])("picking the email one with %s sends only there", (pick) => {
    const { d, real, fake } = withImpostor();
    const [, r] = ownerChat(d, COLIN, [`tell ${REAL}: the gate code is 4471`, pick]);
    expect(r.reply).toMatch(/^Sent to Harbour Collective \(events\) by email to events@harbourcollective\.com\.au/);
    expect(got(real)).toHaveLength(1);
    expect(got(fake)).toHaveLength(0);
  });

  test("the phone tail picks the SMS one", () => {
    const { d, real, fake } = withImpostor();
    ownerChat(d, COLIN, [`tell ${REAL}: the gate code is 4471`, "818"]);
    expect(got(fake)).toHaveLength(1);
    expect(got(real)).toHaveLength(0);
  });

  test("a text that is not a pick drops the list and runs as a new message", () => {
    const { d, real, fake } = withImpostor();
    const [, r, after] = ownerChat(d, COLIN, [`tell ${REAL}: the gate code is 4471`, "What's on?", "2"]);
    expect(r.reply).toMatch(/Unclaimed/);
    expect(after.actions).toEqual([]);
    expect(got(real).length + got(fake).length).toBe(0);
  });

  test("an out-of-range number picks nothing", () => {
    const { d, real, fake } = withImpostor();
    const [, r] = ownerChat(d, COLIN, [`tell ${REAL}: the gate code is 4471`, "3"]);
    expect(r.actions).toEqual([]);
    expect(got(real).length + got(fake).length).toBe(0);
  });

  test("send the draft asks which, then stages the picked one by id", () => {
    const { d, real, fake } = withImpostor();
    fake.draft = "Hi, one of the owners here. We can do festival rates, call us on Monday to talk it through.";
    const [ask, staged, done] = ownerChat(d, COLIN, ["send the draft for Harbour", "2", "yes"]);
    expect(ask.reply).toMatch(/^That matches 2 conversations/);
    expect(staged.reply).toMatch(/^To confirm: send Harbour Collective \(events\) the agent's draft by email to events@harbourcollective\.com\.au/);
    expect(done.reply).toMatch(/^Done\. I sent Harbour/);
    expect(real.messages.at(-1)).toMatchObject({ from: "owner", via: "email" });
    expect(fake.messages).toHaveLength(0);
  });

  test("hand back asks which and keeps 'anyway' through the pick", () => {
    const { d, real, fake } = withImpostor();
    fake.agentActive = true;
    fake.escalated = undefined;
    const [ask, r] = ownerChat(d, COLIN, ["hand back Harbour anyway", "2"]);
    expect(ask.reply).toMatch(/^That matches 2 conversations/);
    expect(r.reply).toMatch(/^Handed Harbour Collective \(events\) back to the agent\. Heads up/);
    expect(real.agentActive).toBe(true);
  });

  test("one exact match plus a partial match still sends to the exact one", () => {
    const { d, real, fake } = withImpostor();
    fake.name = `${REAL} 2`;
    const [r] = ownerChat(d, COLIN, [`tell ${REAL}: the gate code is 4471`]);
    expect(r.reply).toMatch(/^Sent to Harbour Collective \(events\) by email/);
    expect(got(real)).toHaveLength(1);
    expect(got(fake)).toHaveLength(0);
  });
});
