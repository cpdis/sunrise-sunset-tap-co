import { describe, expect, test } from "vitest";
import { toolWords } from "@/components/ui";
import { applyOwnerAction, handBack, ownerReply, owesReply, replyRoute, setAgentActive } from "@/lib/ops";
import { NOW, chat, seed } from "./helpers";

const COLIN = "own_colin";
const harbour = (d: ReturnType<typeof seed>) => d.conversations.find((x) => x.name.startsWith("Harbour"))!;

describe("inbox hand-overs", () => {
  test("replies route by contact: callers get SMS, forms get email", () => {
    expect(replyRoute({ contact: "0433 210 877" })).toEqual({ via: "sms", to: "0433 210 877" });
    expect(replyRoute({ contact: "tom@example.com" })).toEqual({ via: "email", to: "tom@example.com" });
  });

  test("an owner reply records who, where and clears the hand-over and draft", () => {
    const d = seed();
    const c = harbour(d);
    expect(c.draft).toBeTruthy();
    ownerReply(d, c.id, "We can do single days.", COLIN);
    expect(c.messages.at(-1)).toMatchObject({ from: "owner", ownerId: COLIN, via: "email", to: "events@harbourcollective.com.au" });
    expect(c.escalated).toBeUndefined();
    expect(c.draft).toBeUndefined();
    expect(c.handledBy).toBe(COLIN);
    expect(c.messages.some((m) => m.from === "system" && m.body.startsWith("Agent handed over:"))).toBe(true);
  });

  test("send_draft sends the agent's draft as the owner", () => {
    const d = seed();
    const c = harbour(d);
    const draft = c.draft!;
    applyOwnerAction(d, { type: "send_draft", convId: c.id }, COLIN);
    expect(c.messages.at(-1)).toMatchObject({ from: "owner", body: draft, ownerId: COLIN });
    expect(owesReply(c)).toBe(false);
  });

  test("hand back is refused while a reply is owed unless forced", () => {
    const d = seed();
    const c = harbour(d);
    applyOwnerAction(d, { type: "hand_back", convId: c.id }, COLIN);
    expect(c.agentActive).toBe(false);
    applyOwnerAction(d, { type: "hand_back", convId: c.id, force: true }, COLIN);
    expect(c.agentActive).toBe(true);
    expect(c.messages.at(-1)?.body).toBe("Colin handed back to the agent");
  });

  test("handBack is one guard for admin and SMS", () => {
    const d = seed();
    const c = harbour(d);
    expect(handBack(d, c.id, COLIN)).toMatchObject({ ok: false, reason: expect.stringMatching(/told an owner will reply/) });
    expect(c.agentActive).toBe(false);
    expect(handBack(d, c.id, COLIN, true)).toEqual({ ok: true });
    expect(c.agentActive).toBe(true);
  });

  test("clearing a flag-only hand-over does not claim a hand-back", () => {
    const d = seed();
    const c = d.conversations.find((x) => x.channel === "sms")!;
    c.escalated = "Short-notice request";
    expect(handBack(d, c.id, COLIN, true)).toEqual({ ok: true });
    expect(c.messages.at(-1)?.body).toBe("Colin cleared the flag");
  });

  test("the couldn't-answer hand-over carries no draft", () => {
    const [r] = chat(seed(), "0499 120 554", ["what colour are the taps"]);
    const esc = r.actions.find((a) => a.type === "escalate");
    expect(esc).toBeTruthy();
    expect(esc && "draft" in esc ? esc.draft : undefined).toBeUndefined();
  });

  test("take over names the owner", () => {
    const d = seed();
    const c = d.conversations.find((x) => x.channel === "sms")!;
    setAgentActive(d, c.id, false, COLIN);
    expect(c.messages.at(-1)?.body).toBe("Colin took over this conversation");
    expect(c.handledBy).toBe(COLIN);
  });

  test("rules hand-overs carry a draft the owner can send", () => {
    const d = seed();
    const [r] = chat(d, "0499 120 554", ["Can I get a discount for a school fete?"]);
    const esc = r.actions.find((a) => a.type === "escalate");
    expect(esc).toMatchObject({ type: "escalate", draft: expect.stringMatching(/^Hi, one of the owners here\./) });
  });
});

// Escalating flags a conversation in this inbox and notifies the owners. Nobody contacts the customer, so no
// hand-over may promise when (R4).
describe("hand-over text promises no time", () => {
  const TIME_PROMISE = /\b(today|tomorrow|tonight|this (morning|arvo|afternoon|evening)|hours?|soon|by \w+day)\b/i;
  const NEW = "0499 120 554";
  const EVENING = new Date("2026-10-22T21:30:00+08:00");

  test.each([
    ["asks for a person", ["call me"]],
    ["asks for a discount", ["Can I get a discount for a school fete?"]],
    ["asks something the agent can't answer", ["what colour are the taps"]],
    ["asks at short notice", ["Are you free Tuesday?"]],
    ["gives a suburb that isn't listed", ["Is Sunday 29 November free?", "Narnia", "Mordor"]],
    ["never gives a date", ["Is Saturday 7 November free?", "Narnia", "Mordor", "x"]],
    ["asks to move a booking", ["Can I move my booking to Sunday 13 December?"]],
    ["sends a reference twice that isn't theirs", ["SST-1040", "SST-1040"]],
  ])("a customer who %s", (_, lines) => {
    for (const now of [NOW, EVENING]) {
      const rs = chat(seed(), NEW, lines, { now });
      expect(rs.flatMap((r) => r.actions.map((a) => a.type))).toContain("escalate");
      for (const r of rs) expect(r.reply).not.toMatch(TIME_PROMISE);
    }
  });

  test("an over-limit cancel and a handed-over conversation", () => {
    const d = seed();
    const b = d.bookings.find((x) => x.state === "balance_paid" && x.date > "2026-10-29")!;
    const phone = d.customers.find((c) => c.id === b.customerId)!.phone;
    for (const r of chat(d, phone, [`cancel ${b.ref}`, "yes"])) expect(r.reply).not.toMatch(TIME_PROMISE);
    const [r] = chat(d, phone, ["can I book another date?"], { handover: true });
    expect(r.reply).toMatch(/An owner has this conversation/);
    expect(r.reply).not.toMatch(TIME_PROMISE);
  });

  test("the seeded inbox's hand-overs promise no time either", () => {
    const handovers = seed().conversations.flatMap((c) => c.messages.filter((m) => m.from === "agent" && m.tools?.includes("escalate_to_owner")));
    expect(handovers.length).toBeGreaterThan(0);
    for (const m of handovers) expect(m.body).not.toMatch(TIME_PROMISE);
  });
});

describe("tool badges follow what happened", () => {
  test("a cancel quote reads as a quote, not a cancellation", () => {
    const d = seed();
    const b = d.bookings.find((x) => x.ref === "SST-1052")!;
    const phone = d.customers.find((c) => c.id === b.customerId)!.phone;
    const [quote, done] = chat(d, phone, ["cancel SST-1052", "yes {code}"]);
    expect(toolWords(quote.tools)).toMatch(/quoted the cancellation/);
    expect(toolWords(quote.tools)).not.toMatch(/cancelled the booking/);
    expect(toolWords(done.tools)).toMatch(/cancelled the booking/);
  });

  test("a hold names one step, and only when it was made", () => {
    const rs = chat(seed(), NEW_SENDER, ["Is the second Saturday in December free?", "Cottesloe, 8 hours", "Sam", "yes"]);
    expect(toolWords(rs.at(-1)!.tools)).toMatch(/held the date and sent the deposit link/);
    expect(rs.slice(0, -1).every((r) => !r.tools.includes("hold_and_send_deposit_link"))).toBe(true);
  });
});

const NEW_SENDER = "0499 000 222";
