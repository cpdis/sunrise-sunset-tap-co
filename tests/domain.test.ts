import { describe, expect, test } from "vitest";
import {
  BALANCE_RETRIES, balance, balanceStuck, cancelBooking, cashAt, completeBooking, computeDistribution, createHold,
  dayStatus, heldFor, nextFreeDates, payDeposit, payDistribution, periodTotals, runJobs, truckBookValue,
} from "@/lib/domain";
import { DEFAULT_SETTINGS, fitStart, settingProblem, startProblem } from "@/lib/config";
import { addExpense, approveDistribution, payOut, returnedClean, updateSettings } from "@/lib/ops";
import { buildSeed } from "@/lib/seed";
import type { Data, Distribution, Settings } from "@/lib/types";
import { addDays, todayISO } from "@/lib/util";
import { NOW, seed } from "./helpers";

const TODAY = todayISO(NOW);

function freeDate(d: Data, minDays: number) {
  return nextFreeDates(d, addDays(TODAY, minDays), 1, false, NOW)[0];
}

function hold(d: Data, date: string, agreed = true) {
  return createHold(d, { date, block: 4, suburb: "Subiaco", name: "Test Person", phone: "0400 000 000", via: "web", agreed }, NOW);
}

describe("booking rules", () => {
  test("days inside minimum notice are short_notice, not bookable", () => {
    const d = seed();
    const soon = addDays(TODAY, d.settings.minNoticeDays - 1);
    if (dayStatus(d, soon, NOW) !== "booked") expect(dayStatus(d, soon, NOW)).toBe("short_notice");
    expect(nextFreeDates(d, TODAY, 5, false, NOW).every((x) => x >= addDays(TODAY, d.settings.minNoticeDays))).toBe(true);
  });

  test("deposit needs the hire terms accepted", () => {
    const d = seed();
    const b = hold(d, freeDate(d, 60), false);
    expect(() => payDeposit(d, b.id, "Visa •• 4242", NOW)).toThrow(/terms/);
    payDeposit(d, b.id, "Visa •• 4242", NOW, true);
    expect(b.state).toBe("confirmed");
  });
});

describe("input validation", () => {
  test.each(["2026-11-21 ", "2026-12-32", "2026-02-30", "21/11/2026", ""])("dayStatus refuses %j", (date) => {
    const d = seed();
    expect(dayStatus(d, date, NOW)).toBe("invalid");
    expect(() => hold(d, date)).toThrow(/can't be booked/);
  });

  test("a second hold on the same date is refused", () => {
    const d = seed();
    const date = freeDate(d, 60);
    hold(d, date);
    expect(dayStatus(d, date, NOW)).toBe("held");
    expect(() => hold(d, date)).toThrow(/can't be booked \(held\)/);
    expect(d.bookings.filter((b) => b.date === date && b.state !== "cancelled")).toHaveLength(1);
  });

  test("createHold refuses a booked date and a start that ends after closing", () => {
    const d = seed();
    const booked = d.bookings.find((b) => b.kind === "paid" && b.state === "confirmed" && b.date > TODAY)!;
    expect(() => hold(d, booked.date)).toThrow(/can't be booked \(booked\)/);
    const date = freeDate(d, 60);
    const at = (startTime: string) => () => createHold(d, { date, block: 4, startTime, suburb: "Subiaco", name: "T", phone: "0400 000 000", via: "web" }, NOW);
    expect(at("19:45")).toThrow(/must start by 7pm to finish by 11pm/);
    expect(at("14:99")).toThrow(/HH:MM/);
    expect(at("19:00")()).toMatchObject({ startTime: "19:00" });
  });
});

describe("start times", () => {
  test("startProblem and fitStart work in minutes, not just hours", () => {
    expect(startProblem(4, "19:45")).toMatch(/must start by 7pm/);
    expect(startProblem(4, "14:99")).toMatch(/HH:MM/);
    expect(startProblem(8, "05:30")).toMatch(/6am at the earliest/);
    expect(startProblem(4, "19:00")).toBeUndefined();
    expect(fitStart(4, "19:45")).toBe("19:00");
    expect(fitStart(8, "05:30")).toBe("06:00");
    expect(fitStart(4, "14:99")).toBe("14:00");
  });
});

describe("setting ranges", () => {
  test("updateSettings stores only in-range values", () => {
    const d = seed();
    const dropped = updateSettings(d, { deposit: -5, taxRate: 2, holdMinutes: 12.5, minNoticeDays: 10 });
    expect(dropped.sort()).toEqual(["deposit", "holdMinutes", "taxRate"]);
    expect(d.settings).toMatchObject({ deposit: 250, taxRate: 0.25, holdMinutes: 30, minNoticeDays: 10 });
  });

  test("every default sits inside its range", () => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) expect(settingProblem(k as keyof Settings, v), k).toBeUndefined();
  });
});

describe("deferred revenue", () => {
  test("customer money is a liability until the hire completes", () => {
    const d = seed();
    const b = hold(d, freeDate(d, 60));
    const rev0 = balance(d, "revenue");
    payDeposit(d, b.id, "Visa •• 4242", NOW);
    expect(heldFor(d, b.id)).toBe(b.deposit);
    expect(balance(d, "revenue")).toBe(rev0);
    completeBooking(d, b, b.date);
    expect(heldFor(d, b.id)).toBe(0);
    expect(balance(d, "revenue") - rev0).toBe(b.deposit);
  });

  test("cancel more than 30 days out refunds everything, recognises nothing", () => {
    const d = seed();
    const b = hold(d, freeDate(d, d.settings.cancelDays));
    payDeposit(d, b.id, "Visa •• 4242", NOW);
    const rev0 = balance(d, "revenue");
    const pol = cancelBooking(d, b.id, NOW)!;
    expect(pol.fullRefund).toBe(true);
    expect(pol.refund).toBe(b.deposit);
    expect(heldFor(d, b.id)).toBe(0);
    expect(balance(d, "revenue")).toBe(rev0);
  });

  test("cancel at exactly 30 days forfeits the deposit as revenue", () => {
    const d = seed();
    const date = addDays(TODAY, d.settings.cancelDays);
    if (dayStatus(d, date, NOW) !== "free") return;
    const b = hold(d, date);
    payDeposit(d, b.id, "Visa •• 4242", NOW);
    const rev0 = balance(d, "revenue");
    const pol = cancelBooking(d, b.id, NOW)!;
    expect(pol.fullRefund).toBe(false);
    expect(pol.kept).toBe(b.deposit);
    expect(balance(d, "revenue") - rev0).toBe(b.deposit);
    expect(heldFor(d, b.id)).toBe(0);
  });
});

describe("failed balance", () => {
  test("retries once a day, flags an owner after 3, releases 7 days out", () => {
    const d = seed();
    const b = hold(d, freeDate(d, 30));
    payDeposit(d, b.id, "Visa •• 4242", NOW);
    b.cardDeclines = true;
    const due = addDays(b.date, -d.settings.balanceDaysBefore);
    const at = (iso: string, h = 10) => new Date(`${iso}T${String(h).padStart(2, "0")}:00:00+08:00`);
    runJobs(d, at(due));
    runJobs(d, at(due, 15));
    expect(b.balanceAttempts).toBe(1);
    runJobs(d, at(addDays(due, 1)));
    runJobs(d, at(addDays(due, 2)));
    expect(b.balanceAttempts).toBe(BALANCE_RETRIES);
    expect(balanceStuck(b)).toBe(true);
    runJobs(d, at(addDays(due, 3)));
    expect(b.balanceAttempts).toBe(BALANCE_RETRIES);
    expect(b.state).toBe("confirmed");
    runJobs(d, at(addDays(b.date, -7)));
    expect(b.state).toBe("cancelled");
    expect(heldFor(d, b.id)).toBe(0);
  });
});

describe("runner fees and payouts", () => {
  test("completing a hire owes each runner their fee", () => {
    const d = seed();
    const b = hold(d, freeDate(d, 60));
    payDeposit(d, b.id, "Visa •• 4242", NOW);
    b.deliver.ownerId = d.owners[0].id;
    b.collect.ownerId = d.owners[1].id;
    const owed0 = balance(d, "owed_runners", undefined, d.owners[0].id);
    completeBooking(d, b, b.date);
    expect(balance(d, "owed_runners", undefined, d.owners[0].id) - owed0).toBe(d.settings.runnerFee);
  });

  test("a payout clears runner fees and never spends customer money", () => {
    const d = seed();
    const pending = d.distributions.find((x) => x.status !== "paid");
    expect(pending).toBeDefined();
    const dist = pending!;
    expect(computeDistribution(d, dist.quarter).distributable).toBe(dist.distributable);
    expect(dist.distributable).toBeGreaterThanOrEqual(0);
    const fees = dist.lines.reduce((s, l) => s + l.runnerFees, 0);
    expect(fees).toBe(dist.owedRunners);
    const owed0 = balance(d, "owed_runners");
    pending!.approvals = d.owners.slice(0, 2).map((o) => o.id);
    payDistribution(d, pending!.id, NOW);
    expect(balance(d, "owed_runners")).toBeCloseTo(owed0 - fees, 2);
    expect(cashAt(d)).toBeGreaterThanOrEqual(balance(d, "deposits"));
  });
});

describe("money checks at settlement", () => {
  const COLIN = "own_colin";
  const AARON = "own_aaron";
  const JOE = "own_joe";
  const JAN = new Date("2027-01-15T10:00:00+08:00");
  const cents = (x: number) => Math.round(x * 100);
  const q3 = (d: Data) => d.distributions.find((x) => x.quarter === "2026-Q3")!;
  const fees = (x: Distribution) => x.lines.reduce((s, l) => s + l.runnerFees, 0);
  // Upcoming paid hires in Q4 2026, after the seeded today.
  const q4Hires = (d: Data) => d.bookings.filter((b) => b.kind === "paid" && (b.state === "confirmed" || b.state === "balance_paid") && b.date > TODAY && b.date <= "2026-12-31");
  const approveQ3 = (d: Data) => [COLIN, AARON].forEach((id) => approveDistribution(d, q3(d).id, id));

  test("approve, post an $11,203 expense, then pay: refused at pay time", () => {
    const d = seed();
    approveQ3(d);
    addExpense(d, TODAY, "maintenance", 11203, "Engine rebuild");
    const cash = cashAt(d);
    expect(() => payDistribution(d, q3(d).id, NOW)).toThrow(/can't be paid yet\. \$840 of it would come out of customer money/);
    payOut(d, q3(d).id, COLIN);
    expect(q3(d).status).toBe("awaiting");
    expect(cashAt(d)).toBe(cash);
    expect(d.jobs[0].text).toMatch(/^Payout 2026-Q3 not paid: /);
  });

  test("a pay that would take cash below customer deposits is refused, so cash stays above them", () => {
    const d = seed();
    approveQ3(d);
    // Leaves $500 over deposits held: less than the $840 of runner fees plus the reserve.
    addExpense(d, TODAY, "maintenance", cashAt(d) - balance(d, "deposits") - 500, "Engine rebuild");
    payOut(d, q3(d).id, COLIN);
    expect(q3(d).status).toBe("awaiting");
    expect(cashAt(d) - balance(d, "deposits")).toBeCloseTo(500, 2);
  });

  test("Q3 unpaid into January with Q4 computed: each runner fee is paid once and owed runners ends at $0", () => {
    const d = seed();
    q4Hires(d).forEach((b, i) => {
      b.deliver.ownerId = d.owners[i % d.owners.length].id;
      b.collect.ownerId = d.owners[(i + 3) % d.owners.length].id;
      completeBooking(d, b, b.date);
    });
    const owed = balance(d, "owed_runners", "2026-12-31");
    const q4 = computeDistribution(d, "2026-Q4");
    d.distributions.push(q4);
    const listed = [q3(d), q4].flatMap((x) => x.lines.flatMap((l) => l.runnerFeeEntries));
    expect(new Set(listed).size).toBe(listed.length);
    // Seeded: $840 owed for Q3 and $2,760 for Q4 so far. Q4 used to list Q3's $840 again.
    expect([fees(q3(d)), fees(q4), owed]).toEqual([840, 2760, 3600]);
    for (const x of [q3(d), q4]) {
      x.approvals = [COLIN, AARON];
      payDistribution(d, x.id, JAN);
    }
    expect(cents(balance(d, "owed_runners"))).toBe(0);
  });

  test("a $60.50 runner fee across mixed runners pays $60.50 each and owed runners ends at $0.00", () => {
    const d = seed();
    approveQ3(d);
    payDistribution(d, q3(d).id, NOW);
    d.settings.runnerFee = 60.5;
    const [b1, b2] = q4Hires(d);
    b1.deliver.ownerId = COLIN;
    b1.collect.ownerId = AARON;
    b2.deliver.ownerId = JOE;
    b2.collect.ownerId = JOE;
    const owed0 = (id: string) => balance(d, "owed_runners", undefined, id);
    const before = [COLIN, AARON, JOE].map(owed0);
    completeBooking(d, b1, b1.date);
    completeBooking(d, b2, b2.date);
    const q4 = computeDistribution(d, "2026-Q4");
    const line = (id: string) => q4.lines.find((l) => l.ownerId === id)!.runnerFees;
    // October's $60 runs plus the new ones, to the cent: Colin and Aaron $120.50, not $121.
    expect([COLIN, AARON, JOE].map(line)).toEqual([before[0] + 60.5, before[1] + 60.5, before[2] + 121]);
    expect(line(COLIN)).toBe(120.5);
    d.distributions.push(q4);
    q4.approvals = [COLIN, AARON];
    payDistribution(d, q4.id, JAN);
    expect([COLIN, AARON, JOE].map((id) => cents(owed0(id)))).toEqual([0, 0, 0]);
    expect(cents(balance(d, "owed_runners"))).toBe(0);
  });

  test("approvals count only current directors", () => {
    const d = seed();
    approveQ3(d);
    d.owners.find((o) => o.id === COLIN)!.isDirector = false;
    expect(() => payDistribution(d, q3(d).id, NOW)).toThrow(/1 of 2 director approvals/);
    approveDistribution(d, q3(d).id, JOE);
    payDistribution(d, q3(d).id, NOW);
    expect(q3(d).status).toBe("paid");
  });

  test("only a director pays", () => {
    const d = seed();
    approveQ3(d);
    d.owners.find((o) => o.id === JOE)!.isDirector = false;
    payOut(d, q3(d).id, JOE);
    expect(q3(d).status).toBe("awaiting");
    expect(d.jobs[0].text).toBe("Payout 2026-Q3 not paid: Joe isn't a director");
    payOut(d, q3(d).id, AARON);
    expect(q3(d).status).toBe("paid");
  });
});

describe("bond", () => {
  test("stays held after the event day until an owner checks the truck back clean", () => {
    const d = seed();
    const b = d.bookings.filter((x) => x.kind === "paid" && x.state === "balance_paid" && x.date > TODAY).sort((a, x) => a.date.localeCompare(x.date))[0];
    const at = (iso: string) => new Date(`${iso}T07:00:00+08:00`);
    expect(b.bondStatus).toBe("held");
    // Not before the hire.
    returnedClean(d, b.id, "own_colin", at(addDays(b.date, -1)));
    expect(b.bondStatus).toBe("held");
    for (let day = addDays(TODAY, 1); day <= addDays(b.date, 2); day = addDays(day, 1)) runJobs(d, at(day));
    expect(b.state).toBe("completed");
    expect(b.bondStatus).toBe("held");
    returnedClean(d, b.id, "own_colin", at(addDays(b.date, 2)));
    expect(b.bondStatus).toBe("released");
    expect(d.payments.filter((p) => p.bookingId === b.id && p.type === "bond_release")).toHaveLength(1);
    expect(d.jobs[0].text).toBe(`Colin checked ${b.ref} back clean; released the $300 bond`);
  });

  test("the seed's past hires were checked back, so none is left holding a bond", () => {
    expect(seed().bookings.filter((b) => b.state === "completed" && b.bondStatus === "held")).toEqual([]);
  });
});

describe("seed scenarios", () => {
  test.each([
    ["bear", 20, 30],
    ["base", 32, 40],
    ["bull", 45, 60],
  ] as const)("%s has a plausible year", (sc, lo, hi) => {
    const d = buildSeed(NOW, sc);
    const hires = d.bookings.filter((b) => b.kind === "paid" && b.state === "completed").length;
    expect(hires).toBeGreaterThanOrEqual(lo);
    expect(hires).toBeLessThanOrEqual(hi);
    expect(d.owners.every((o) => o.isDirector)).toBe(true);
    expect(truckBookValue(d)).toBeLessThan(27000);
    const y = periodTotals(d, addDays(TODAY, -365), TODAY);
    expect(y.expenses).toBeGreaterThan(0);
  });

  test("seed is deterministic", () => {
    const a = buildSeed(NOW, "base");
    const b = buildSeed(NOW, "base");
    expect(a.bookings.map((x) => x.date)).toEqual(b.bookings.map((x) => x.date));
  });
});
