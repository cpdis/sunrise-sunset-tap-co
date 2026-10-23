import { describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/agent/route";
import { runClaude } from "@/lib/agent/claude";
import { checkAvailability, customerBookings, holdAndLink, type ToolCtx } from "@/lib/agent/tools";
import { createHold } from "@/lib/domain";
import { snapshot } from "@/lib/views";
import { NOW, chat, seed } from "./helpers";

const ME = "0499 000 111";
const types = (r: { actions: { type: string }[] }) => r.actions.map((a) => a.type);

// The Claude path has no API key here, so a scripted client stands in: each create() returns the next reply.
const claude = vi.hoisted(() => ({ replies: [] as unknown[] }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { beta = { messages: { create: async () => claude.replies.shift() } }; } }));
const toolUse = (name: string, input: Record<string, unknown>) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `tu_${name}`, name, input }] });
const says = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });


describe("FAQ routing", () => {
  test.each([
    ["Do you supply staff?", /No staff stay/],
    ["do you provide bartenders?", /No staff stay/],
    ["I'm the venue owner, do you need power?", /power/i],
    ["What's your cancellation policy?", /30 days/],
    ["cancel", /30 days/],
    ["Can I bring my own kegs?", /You supply the drinks/],
    ["can we extend by an hour on the day?", /No hourly extensions/],
    ["What's the deal with kegs?", /Couplers/],
  ])("%s", (q, re) => {
    const [r] = chat(seed(), ME, [q]);
    expect(r.reply).toMatch(re);
    expect(types(r)).not.toContain("escalate");
  });

  test("price question gets a price, not a name request", () => {
    const [, r] = chat(seed(), ME, ["Can we keep it for two days?", "how much is it"]);
    expect(r.reply).toMatch(/\$600.*\$1,000/);
  });
});

describe("booking flow", () => {
  test("free date to held booking with checkout link", () => {
    const rs = chat(seed(), ME, ["Is the second Saturday in December free?", "Cottesloe, 8 hours", "Sam", "yes"]);
    expect(rs[0].reply).toMatch(/is free/);
    expect(rs[3].actions.map((a) => a.type)).toContain("hold");
    expect(rs[3].reply).toMatch(/\/checkout\//);
  });

  test("start time carries into the hold", () => {
    const rs = chat(seed(), ME, ["Is Sunday 29 November free? 6am start in Kings Park", "4 hours", "Sam", "yes"]);
    const last = rs.at(-1)!;
    expect(types(last)).toContain("hold");
    expect(last.reply).toMatch(/6am/);
  });

  test("short notice goes to an owner but the agent stays on", () => {
    const [r] = chat(seed(), ME, ["Are you free Tuesday?"]);
    expect(types(r)).toContain("escalate");
    expect(r.reply).toMatch(/less than 7 days/);
  });

  test("unknown suburb escalates after two misses", () => {
    const rs = chat(seed(), ME, ["Is Sunday 29 November free?", "Narnia", "Mordor"]);
    expect(types(rs[2])).toContain("escalate");
  });

  test("no date after repeated asks escalates instead of looping", () => {
    const rs = chat(seed(), ME, ["Is Saturday 7 November free?", "Narnia", "Mordor", "x"]);
    expect(rs.slice(1).some((r) => types(r).includes("escalate"))).toBe(true);
  });

  // Review C18: SST-1040 is a real booking under another number, SST-9999 doesn't exist. A stranger can't tell them apart.
  test("someone else's ref and a made-up one get the same reply and no hand-over", () => {
    const d = seed();
    expect(d.bookings.some((b) => b.ref === "SST-1040")).toBe(true);
    const [real] = chat(d, ME, ["SST-1040"]);
    const [fake] = chat(d, ME, ["SST-9999"]);
    expect(real.reply.replace("SST-1040", "REF")).toBe(fake.reply.replace("SST-9999", "REF"));
    expect(real.reply).not.toMatch(/different number|booked under/);
    expect([...types(real), ...types(fake)]).not.toContain("escalate");
  });

  test("a second ref that isn't theirs goes to an owner, the same way for real and made-up refs", () => {
    const d = seed();
    const real = chat(d, ME, ["SST-1040", "cancel SST-1040"]);
    const fake = chat(d, ME, ["SST-9999", "cancel SST-9999"]);
    expect(real[1].reply.replace("SST-1040", "REF")).toBe(fake[1].reply.replace("SST-9999", "REF"));
    expect(types(real[1])).toContain("escalate");
    expect(types(fake[1])).toContain("escalate");
    expect([...types(real[1]), ...types(fake[1])]).not.toContain("cancel");
  });
});

describe("confirmations", () => {
  // SST-1052 (Sat 5 Dec) is a confirmed booking under this number in the seed.
  const OWNER_OF_1052 = "0450 926 727";
  const cancels = (rs: { actions: { type: string }[] }[]) => rs.flatMap(types).includes("cancel");

  test("'No, don't cancel it' after a cancel quote keeps the booking", () => {
    const rs = chat(seed(), OWNER_OF_1052, ["cancel SST-1052", "No, don't cancel it"]);
    expect(rs[0].reply).toMatch(/Reply YES to cancel/);
    expect(cancels(rs)).toBe(false);
    expect(rs[1].reply).toMatch(/stays as is/);
  });

  test("a topic change ends the pending cancel", () => {
    const rs = chat(seed(), OWNER_OF_1052, ["cancel SST-1052", "how many kegs fit?", "yes sounds good"]);
    expect(rs[1].reply).toMatch(/4 kegs of 50L/);
    expect(cancels(rs)).toBe(false);
  });

  test.each(["yes", "Yes please", "yep, cancel it"])("'%s' still cancels", (reply) => {
    const rs = chat(seed(), OWNER_OF_1052, ["cancel SST-1052", reply]);
    expect(types(rs[1])).toContain("cancel");
  });

  test("'Don't book it.' after a quote creates no hold", () => {
    const rs = chat(seed(), ME, ["Is the second Saturday in December free?", "Cottesloe, 8 hours", "Sam", "Don't book it."]);
    expect(rs[2].reply).toMatch(/Want the link/);
    expect(rs.flatMap(types)).not.toContain("hold");
    expect(rs[3].reply).toMatch(/haven't held anything/);
  });

  test("a refusal is not taken as a booking name", () => {
    const rs = chat(seed(), ME, ["Is the second Saturday in December free?", "Cottesloe, 8 hours", "No thanks, too expensive", "yes"]);
    expect(rs[1].reply).toMatch(/What name/);
    expect(rs.flatMap(types)).not.toContain("hold");
    expect(rs[2].reply).toMatch(/haven't held anything/);
  });

  test("'book' in the first message does not skip the price check", () => {
    const rs = chat(seed(), ME, ["Can I book the second Saturday in December?", "Cottesloe, 8 hours", "Sam"]);
    expect(rs.flatMap(types)).not.toContain("hold");
    expect(rs[2].reply).toMatch(/Want the link/);
  });
});

describe("honest replies", () => {
  const TIME_PROMISE = /\b(today|tomorrow|tonight|this (morning|arvo|afternoon|evening)|within|hours?|soon)\b/i;

  test("'call me' hands over with no time promise and no promise of a call", () => {
    const [r] = chat(seed(), ME, ["call me"]);
    expect(types(r)).toContain("escalate");
    expect(r.reply).not.toMatch(TIME_PROMISE);
    expect(r.reply).not.toMatch(/\b(call|ring|phone) you\b/i);
  });

  test("a cancel refund is requested, not sent", () => {
    const d = seed();
    const b = d.bookings.find((x) => x.ref === "SST-1052")!;
    const phone = d.customers.find((c) => c.id === b.customerId)!.phone;
    const [, r] = chat(d, phone, ["cancel SST-1052", "yes"]);
    expect(types(r)).toContain("cancel");
    expect(r.reply).toMatch(/requested a \$\d[\d,]* refund/);
    expect(r.reply).not.toMatch(/on its way|business days/);
  });

  test("an over-limit cancel more than the window out quotes a full refund, not a kept deposit", () => {
    const d = seed();
    d.settings.refundLimit = 100;
    const b = d.bookings.find((x) => x.ref === "SST-1052")!;
    const phone = d.customers.find((c) => c.id === b.customerId)!.phone;
    const [q, yes] = chat(d, phone, ["cancel SST-1052", "yes"]);
    expect(q.reply).toMatch(/full refund of \$250/);
    expect(q.reply).not.toMatch(/deposit is kept|less than/);
    expect(q.reply).toMatch(/needs an owner's OK/);
    expect(q.tools).toContain("cancel_quote");
    expect(q.tools).not.toContain("cancel_booking");
    expect(types(yes)).toEqual(["escalate"]);
    expect(yes.tools).toContain("escalate_to_owner");
    expect(yes.reply).toMatch(/Nothing is cancelled/);
  });

  test("a booked customer's date change goes to an owner and holds nothing", () => {
    const d = seed();
    const b = d.bookings.find((x) => x.ref === "SST-1052")!;
    const phone = d.customers.find((c) => c.id === b.customerId)!.phone;
    const rs = chat(d, phone, ["Can I move my booking to Sunday 13 December?", "Cottesloe, 8 hours", "yes"]);
    expect(rs[0].actions).toContainEqual(expect.objectContaining({ type: "escalate", keepAgent: false, reason: expect.stringMatching(/SST-1052/) }));
    expect(rs[0].reply).toMatch(/passed your request/);
    expect(rs[0].reply).not.toMatch(/SST-1052: /);
    expect(rs[0].state.date).toBeUndefined();
    expect(rs.flatMap(types)).not.toContain("hold");
  });

  test("a date change without a date, or from an unknown number, goes to an owner too", () => {
    for (const [who, text] of [["0450 926 727", "I need to reschedule"], [ME, "Can I move my booking to Sunday 13 December?"]]) {
      const [r] = chat(seed(), who, [text]);
      expect(types(r)).toEqual(["escalate"]);
    }
  });

  test("mid-booking, changing the date changes the draft", () => {
    const rs = chat(seed(), ME, ["Is the second Saturday in December free?", "Cottesloe, 8 hours", "can I change the date to Sunday 13 December?"]);
    expect(rs.flatMap(types)).not.toContain("escalate");
    expect(rs[2].state.date).toBe("2026-12-13");
  });

  test("a second hold while one is unpaid sends the first link back", () => {
    const d = seed();
    const first = createHold(d, { date: "2026-12-12", block: 8, suburb: "Cottesloe", name: "Sam", phone: ME, via: "sms" }, NOW);
    const rs = chat(d, ME, ["Is Sunday 29 November free?", "Kings Park, 4 hours", "Sam", "yes"]);
    const last = rs.at(-1)!;
    expect(rs.flatMap(types)).not.toContain("hold");
    expect(last.reply).toMatch(new RegExp(`already have ${first.ref} held`));
    expect(last.reply).toContain(`https://x.test/checkout/${first.id}`);
  });

  test("two holds in one turn: the second gets the first one's link", () => {
    const d = seed();
    const ctx: ToolCtx = { data: snapshot(d, ME), contact: ME, channel: "sms", now: NOW, actions: [], used: [], origin: "https://x.test" };
    const a = holdAndLink(ctx, "2026-12-12", 8, "Cottesloe", "Sam");
    const b = holdAndLink(ctx, "2026-11-29", 4, "Cottesloe", "Sam");
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, heldRef: a.ok ? a.ref : "", link: a.ok ? a.link : "" });
    expect(types(ctx)).toEqual(["hold"]);
  });
});

describe("answers come from the knowledge base", () => {
  const edit = (d: ReturnType<typeof seed>, slug: string, from: RegExp, to: string) => {
    const p = d.kb.find((x) => x.slug === slug)!;
    p.body = p.body.replace(from, to);
  };

  test("after the keg guide says no G-type couplers, the fallback doesn't offer them", () => {
    const d = seed();
    edit(d, "keg-guide", /- Couplers:.*$/m, "- Couplers: we carry S-type and A-type only. We have no G-type couplers, so Guinness kegs won't fit.");
    for (const q of ["Do you have a G-type coupler for Guinness?", "What's the deal with kegs?"]) {
      const [r] = chat(d, ME, [q]);
      expect(r.reply).toMatch(/no G-type couplers/);
      expect(r.reply).not.toMatch(/and G-type|G types/);
      expect(r.tools).toContain("kb:keg-guide");
    }
  });

  test("price answers follow the pricing page and the settings", () => {
    const d = seed();
    d.settings.price4 = 650;
    edit(d, "pricing", /^- Includes .*$/m, "- Includes delivery, setup and glassware.");
    const [r] = chat(d, ME, ["how much do you charge?"]);
    expect(r.reply).toMatch(/Half day \(4 hours\): \$650/);
    expect(r.reply).toMatch(/Includes delivery, setup and glassware\./);
  });

  test("a page that no longer answers the question goes to an owner", () => {
    const d = seed();
    d.kb = d.kb.filter((p) => p.slug !== "keg-guide");
    const [r] = chat(d, ME, ["What couplers do you have?"]);
    expect(types(r)).toContain("escalate");
    expect(r.reply).not.toMatch(/S-type/);
  });
});

describe("contact matching", () => {
  test("a blank contact sees no bookings, even with customers missing an email", () => {
    const d = seed();
    d.customers[0].email = "";
    const ctx = { data: d, contact: "   ", now: NOW } as unknown as ToolCtx;
    expect(customerBookings(ctx)).toEqual([]);
    const [r] = chat(d, "   ", ["what's my booking?"]);
    expect(r.reply).not.toMatch(/SST-\d+/);
  });

  test("an SMS cancel over the refund limit still goes to an owner", () => {
    const d = seed();
    const b = d.bookings.find((x) => x.state === "balance_paid" && x.date > "2026-10-29")!;
    const phone = d.customers.find((c) => c.id === b.customerId)!.phone;
    const rs = chat(d, phone, [`cancel ${b.ref}`, "yes"]);
    expect(rs.flatMap(types)).not.toContain("cancel");
    expect(rs[1].actions).toContainEqual(expect.objectContaining({ type: "escalate", reason: expect.stringMatching(/needs owner approval/) }));
  });
});

describe("hand-over mode", () => {
  test("answers FAQs but won't hold a date", () => {
    const rs = chat(seed(), ME, ["Do you supply staff?", "Is the second Saturday in December free?", "Cottesloe, 8 hours", "Sam", "yes"], { handover: true });
    expect(rs[0].reply).toMatch(/No staff stay/);
    expect(rs.flatMap(types)).not.toContain("hold");
  });
});

describe("malformed dates and times", () => {
  const ctxFor = (d: ReturnType<typeof seed>): ToolCtx => ({ data: snapshot(d, ME), contact: ME, channel: "sms", now: NOW, actions: [], used: [], origin: "https://x.test" });

  // Review A06: "2026-11-21 " read as free on a booked date and returned a hold.
  test.each(["2026-11-21 ", "2026-12-32"])("hold_and_send_deposit_link refuses %j", (date) => {
    const d = seed();
    const ctx = ctxFor(d);
    expect(holdAndLink(ctx, date, 8, "Subiaco", "Sam", "12:00")).toEqual({ ok: false, reason: "That isn't a real date." });
    expect(checkAvailability(ctx, date)).toMatchObject({ free: false, status: "invalid" });
    expect(ctx.actions).toEqual([]);
  });

  test.each([
    ["19:45", 4, "4 hours must start by 7pm to finish by 11pm."],
    ["14:99", 4, "A start time needs to be HH:MM on a 24-hour clock."],
  ] as const)("start %s for %i hours is refused", (start, block, reason) => {
    const d = seed();
    const ctx = ctxFor(d);
    const date = checkAvailability(ctx, "2026-12-12").free ? "2026-12-12" : checkAvailability(ctx, "2026-12-12").alternatives[0];
    expect(holdAndLink(ctx, date, block, "Subiaco", "Sam", start)).toEqual({ ok: false, reason });
    expect(ctx.actions).toEqual([]);
  });

  test("the rules engine still fits a late start to the latest one", () => {
    const rs = chat(seed(), ME, ["Is the second Saturday in December free? 7:45pm start in Kings Park", "4 hours", "Sam", "yes"]);
    const hold = rs.at(-1)!.actions.find((a) => a.type === "hold");
    expect(hold).toMatchObject({ startTime: "19:00" });
  });
});

describe("/api/agent body checks", () => {
  const post = (body: string, ip: string) =>
    POST(new Request("http://localhost:3000/api/agent", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "x-forwarded-for": ip }, body }));

  test.each([
    ["malformed JSON", "{not json"],
    ["no conversation", JSON.stringify({ snapshot: snapshot(seed(), ME) })],
    ["no messages", JSON.stringify({ snapshot: snapshot(seed(), ME), conversation: { channel: "sms", contact: "1" } })],
    ["a non-object body", "[1,2]"],
  ])("%s returns 400", async (_, body) => {
    expect((await post(body, `10.0.0.${body.length % 250}`)).status).toBe(400);
  });

  test("the size cap counts bytes, not characters", async () => {
    // 70,000 emoji: about 140,000 UTF-16 characters but 280,000 bytes, over the 256,000-byte cap.
    const body = JSON.stringify({ pad: "🍺".repeat(70_000) });
    expect(body.length).toBeLessThan(256_000);
    expect((await post(body, "10.0.1.1")).status).toBe(413);
  });

  test("a well-formed message still gets a reply", async () => {
    const conversation = { channel: "sms", contact: ME, name: "New contact", state: {}, agentActive: true, messages: [{ id: "m1", from: "customer", body: "Do you supply staff?", at: NOW.toISOString() }] };
    const r = await post(JSON.stringify({ snapshot: snapshot(seed(), ME), conversation }), "10.0.1.2");
    expect(r.status).toBe(200);
    expect((await r.json()).reply).toMatch(/No staff stay/);
  });
});

describe("Claude path keeps the same cancel rule", () => {
  // SST-1052 is a confirmed booking under this number in the seed.
  const PHONE = "0450 926 727";
  const ctxFor = (d: ReturnType<typeof seed>, contact = PHONE): ToolCtx => ({ data: snapshot(d, contact), contact, channel: "sms", now: NOW, actions: [], used: [], origin: "https://x.test" });
  const history = (...bodies: string[]) => bodies.map((body, i) => ({ id: `m${i}`, from: i % 2 ? ("agent" as const) : ("customer" as const), body, at: NOW.toISOString() }));
  const id1052 = (d: ReturnType<typeof seed>) => d.bookings.find((b) => b.ref === "SST-1052")!.id;

  test("confirmed=true with no quote last turn only quotes, and the quote is saved", async () => {
    const d = seed();
    claude.replies.push(toolUse("cancel_booking", { booking: "SST-1052", confirmed: true }), says("SST-1052 would get a full refund of $250. Reply YES to cancel."));
    const r = await runClaude(ctxFor(d), history("cancel SST-1052"), {});
    expect(r.actions).toEqual([]);
    expect(r.tools).toEqual(["cancel_quote"]);
    expect(r.state).toMatchObject({ awaiting: "confirm_cancel", bookingId: id1052(d) });
  });

  test("a clear yes to last turn's quote cancels", async () => {
    const d = seed();
    claude.replies.push(toolUse("cancel_booking", { booking: "SST-1052", confirmed: true }), says("Done, SST-1052 is cancelled."));
    const r = await runClaude(ctxFor(d), history("cancel SST-1052", "Reply YES to cancel.", "yes"), { awaiting: "confirm_cancel", bookingId: id1052(d) });
    expect(types(r)).toEqual(["cancel"]);
    expect(r.state.awaiting).toBeUndefined();
  });

  test("'No, don't cancel it' never cancels, even if the model says confirmed", async () => {
    const d = seed();
    claude.replies.push(toolUse("cancel_booking", { booking: "SST-1052", confirmed: true }), says("No worries."));
    const r = await runClaude(ctxFor(d), history("cancel SST-1052", "Reply YES to cancel.", "No, don't cancel it"), { awaiting: "confirm_cancel", bookingId: id1052(d) });
    expect(types(r)).not.toContain("cancel");
  });

  test("a yes cancels only the booking that was quoted", async () => {
    const d = seed();
    claude.replies.push(toolUse("cancel_booking", { booking: "SST-1052", confirmed: true }), says("Reply YES to cancel."));
    const r = await runClaude(ctxFor(d), history("cancel it", "Reply YES to cancel.", "yes"), { awaiting: "confirm_cancel", bookingId: "bk_other" });
    expect(types(r)).not.toContain("cancel");
  });

  test("a refused loop drops what it did and promises no time", async () => {
    claude.replies.push(toolUse("hold_and_send_deposit_link", { date: "2026-12-12", block: 8, start_time: "12:00", suburb: "Cottesloe", name: "Sam" }), { stop_reason: "refusal", content: [] });
    const r = await runClaude(ctxFor(seed(), ME), history("book Sat 12 Dec in Cottesloe for 8 hours"), {});
    expect(types(r)).toEqual(["escalate"]);
    expect(r.tools).toEqual(["escalate_to_owner"]);
    expect(r.reply).toBe("I've passed this to the owners.");
  });
});
