import { describe, expect, test } from "vitest";
import { chat, seed } from "./helpers";

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

describe("hand-over mode", () => {
  test("answers FAQs but won't hold a date", () => {
    const rs = chat(seed(), ME, ["Do you supply staff?", "Is the second Saturday in December free?", "Cottesloe, 8 hours", "Sam", "yes"], { handover: true });
    expect(rs[0].reply).toMatch(/No staff stay/);
    expect(rs.flatMap(types)).not.toContain("hold");
  });
});
