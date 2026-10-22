import { describe, expect, test } from "vitest";
import {
  BALANCE_RETRIES, balance, balanceStuck, cancelBooking, cashAt, completeBooking, computeDistribution, createHold,
  dayStatus, heldFor, nextFreeDates, payDeposit, payDistribution, periodTotals, runJobs, truckBookValue,
} from "@/lib/domain";
import { buildSeed } from "@/lib/seed";
import type { Data } from "@/lib/types";
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
    const b = hold(d, addDays(TODAY, d.settings.cancelDays + 1));
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
