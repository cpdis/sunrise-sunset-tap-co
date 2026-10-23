import { describe, expect, test } from "vitest";
import { balance, cashAt } from "@/lib/domain";
import { chat, ownerChat, seed } from "./helpers";

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
    expect(refused.reply).toMatch(/was told an owner would reply, and nobody has yet/);
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
