import { describe, expect, test } from "vitest";
import { POST } from "@/app/api/agent/route";
import { checkAvailability, holdAndLink, type ToolCtx } from "@/lib/agent/tools";
import { snapshot } from "@/lib/store";
import { NOW, chat, seed } from "./helpers";

const ME = "0499 000 111";
const types = (r: { actions: { type: string }[] }) => r.actions.map((a) => a.type);

describe("FAQ routing", () => {
  test.each([
    ["Do you supply staff?", /No staff stay/],
    ["do you provide bartenders?", /No staff stay/],
    ["I'm the venue owner, do you need power?", /power/i],
    ["What's your cancellation policy?", /30 days/],
    ["cancel", /30 days/],
    ["Can I bring my own kegs?", /You bring the drinks/],
    ["can we extend by an hour on the day?", /No hourly extensions/],
    ["What's the deal with kegs?", /couplers/],
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

  test("someone else's ref is not disclosed", () => {
    const [r] = chat(seed(), ME, ["SST-1040"]);
    expect(types(r)).toContain("escalate");
    expect(r.reply).toMatch(/different number/);
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
    expect(rs[1].reply).toMatch(/4 × 50L/);
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
