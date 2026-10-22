// Business rules. Every function takes a mutable draft of Data (the store clones first).
import { findSuburb } from "./config";
import type {
  Account,
  Block,
  Booking,
  Channel,
  Data,
  Distribution,
  LedgerEntry,
  Payment,
  PaymentType,
  Settings,
} from "./types";
import {
  addDays,
  addMonths,
  daysBetween,
  money,
  quarterOf,
  stripeFee,
  todayISO,
  uid,
} from "./util";

export const EVENT_COSTS = { fuelPerKm: 0.22, co2: 35, cleaning: 8 };

// ---------- quoting & availability ----------

export function quote(s: Settings, block: Block, suburb: string) {
  const sub = findSuburb(suburb);
  const price = block === 4 ? s.price4 : s.price8;
  const minutes = sub?.minutes ?? 0;
  const travelFee = sub && minutes > s.travelThresholdMin ? s.travelFee : 0;
  return {
    inArea: !!sub,
    minutes,
    km: sub?.km ?? 0,
    price,
    travelFee,
    total: price + travelFee,
    deposit: Math.min(s.deposit, price + travelFee),
    bond: s.bond,
  };
}

export function liveBookings(d: Data, now = new Date()) {
  return d.bookings.filter(
    (b) =>
      b.state !== "cancelled" &&
      !(b.state === "held" && b.heldUntil && Date.parse(b.heldUntil) < now.getTime()),
  );
}

export type DayStatus = "free" | "booked" | "held" | "personal" | "blackout" | "past" | "too_far";

export function dayStatus(d: Data, date: string, now = new Date()): DayStatus {
  const today = todayISO(now);
  if (date <= today) return "past";
  if (date > addMonths(today, d.settings.bookAheadMonths)) return "too_far";
  if (d.blackouts.includes(date)) return "blackout";
  const b = liveBookings(d, now).find((x) => x.date === date);
  if (!b) return "free";
  if (b.kind === "personal") return "personal";
  return b.state === "held" ? "held" : "booked";
}

// Personal-use bookings yield to paid ones, so they count as free for customers.
export function isBookable(d: Data, date: string, now = new Date()): boolean {
  const s = dayStatus(d, date, now);
  return s === "free" || s === "personal";
}

export function nextFreeDates(d: Data, from: string, count: number, weekendsOnly = false): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 200 && out.length < count; i++) {
    cur = addDays(cur, 1);
    const wd = new Date(cur + "T00:00:00Z").getUTCDay();
    if (weekendsOnly && wd !== 0 && wd !== 6) continue;
    if (isBookable(d, cur)) out.push(cur);
  }
  return out;
}

// ---------- ledger & payments ----------

export function post(d: Data, date: string, account: Account, amount: number, memo: string, ref?: string) {
  const e: LedgerEntry = { id: uid("le"), date, account, amount: Math.round(amount * 100) / 100, memo, ref };
  d.ledger.push(e);
  return e;
}

export function pay(
  d: Data,
  b: Booking,
  type: PaymentType,
  amount: number,
  at: string,
  card = "Visa •• 4242",
): Payment {
  const fee = type === "deposit" || type === "balance" ? stripeFee(amount) : 0;
  const p: Payment = { id: "pi_" + uid("").slice(1), bookingId: b.id, type, amount, fee, status: "succeeded", at, card };
  d.payments.push(p);
  const date = todayISO(new Date(at));
  if (type === "deposit" || type === "balance") {
    post(d, date, "revenue", amount, `${b.ref} ${type}`, b.id);
    post(d, date, "stripe_fees", -fee, `Stripe fee ${b.ref}`, b.id);
  } else if (type === "refund") {
    post(d, date, "refunds", -amount, `${b.ref} refund`, b.id);
  } else if (type === "bond_capture") {
    post(d, date, "bond", amount, `${b.ref} bond captured`, b.id);
  }
  return p;
}

export function paidSoFar(d: Data, bookingId: string) {
  return d.payments
    .filter((p) => p.bookingId === bookingId && p.status === "succeeded")
    .reduce((s, p) => s + (p.type === "deposit" || p.type === "balance" ? p.amount : p.type === "refund" ? -p.amount : 0), 0);
}

// ---------- booking lifecycle ----------

export interface NewBooking {
  date: string;
  block: Block;
  startTime?: string;
  suburb: string;
  name: string;
  email?: string;
  phone?: string;
  eventType?: string;
  guests?: number;
  notes?: string;
  via: Channel;
  id?: string;
  ref?: string;
}

export function nextRef(d: Data) {
  d.seq += 1;
  return `SST-${d.seq}`;
}

export function upsertCustomer(d: Data, name: string, email?: string, phone?: string) {
  const norm = (x?: string) => (x ?? "").replace(/\s+/g, "").toLowerCase();
  let c = d.customers.find((x) => (phone && norm(x.phone) === norm(phone)) || (email && norm(x.email) === norm(email)));
  if (!c) {
    c = { id: uid("cus"), name, email: email ?? "", phone: phone ?? "" };
    d.customers.push(c);
  } else {
    if (email && !c.email) c.email = email;
    if (phone && !c.phone) c.phone = phone;
  }
  return c;
}

export function createHold(d: Data, n: NewBooking, now = new Date()): Booking {
  const q = quote(d.settings, n.block, n.suburb);
  const c = upsertCustomer(d, n.name, n.email, n.phone);
  // A paid booking bumps a personal-use booking on the same day.
  for (const p of d.bookings.filter((x) => x.date === n.date && x.kind === "personal" && x.state !== "cancelled")) {
    p.state = "cancelled";
    p.cancelledAt = now.toISOString();
    p.notes = (p.notes ? p.notes + " · " : "") + "Bumped by a paid booking";
  }
  const b: Booking = {
    id: n.id ?? uid("bk"),
    ref: n.ref ?? nextRef(d),
    kind: "paid",
    customerId: c.id,
    date: n.date,
    block: n.block,
    startTime: n.startTime ?? (n.block === 4 ? "14:00" : "12:00"),
    suburb: n.suburb,
    travelMinutes: q.minutes,
    km: q.km,
    price: q.price,
    travelFee: q.travelFee,
    total: q.total,
    deposit: q.deposit,
    bond: q.bond,
    state: "held",
    bondStatus: "none",
    heldUntil: new Date(now.getTime() + d.settings.holdMinutes * 60000).toISOString(),
    createdAt: now.toISOString(),
    createdVia: n.via,
    eventType: n.eventType,
    guests: n.guests,
    notes: n.notes,
    agreementSigned: false,
    deliver: { done: false },
    collect: { done: false },
  };
  d.bookings.push(b);
  return b;
}

export function payDeposit(d: Data, bookingId: string, card: string, now = new Date()) {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b) throw new Error("Booking not found");
  if (b.state !== "held") return b;
  pay(d, b, "deposit", b.deposit, now.toISOString(), card);
  b.state = "confirmed";
  b.heldUntil = undefined;
  b.agreementSigned = true;
  if (daysBetween(todayISO(now), b.date) <= d.settings.balanceDaysBefore) {
    pay(d, b, "balance", b.total - b.deposit, now.toISOString(), card);
    b.state = "balance_paid";
  }
  return b;
}

export function balanceDueDate(s: Settings, b: Booking) {
  return addDays(b.date, -s.balanceDaysBefore);
}

export function chargeBalance(d: Data, b: Booking, now = new Date()) {
  if (b.state !== "confirmed") return;
  pay(d, b, "balance", b.total - b.deposit, now.toISOString());
  b.state = "balance_paid";
}

export function cancelPolicy(s: Settings, b: Booking, now = new Date()) {
  const days = daysBetween(todayISO(now), b.date);
  const paid = b.state === "held" ? 0 : b.state === "balance_paid" ? b.total : b.deposit;
  const fullRefund = days > s.cancelDays;
  const refund = fullRefund ? paid : Math.max(0, paid - b.deposit);
  return { days, paid, refund, kept: paid - refund, fullRefund };
}

export function cancelBooking(d: Data, bookingId: string, now = new Date()) {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b || b.state === "cancelled" || b.state === "completed") return null;
  const pol = cancelPolicy(d.settings, b, now);
  if (pol.refund > 0) pay(d, b, "refund", pol.refund, now.toISOString());
  if (b.bondStatus === "held") b.bondStatus = "released";
  b.state = "cancelled";
  b.cancelledAt = now.toISOString();
  return pol;
}

export function completeBooking(d: Data, b: Booking, date: string) {
  if (b.state === "cancelled" || b.state === "completed") return;
  b.state = "completed";
  b.deliver.done = true;
  b.collect.done = true;
  if (b.kind === "paid") {
    const fuel = Math.round(b.km * 2 * 2 * EVENT_COSTS.fuelPerKm);
    post(d, date, "fuel", -fuel, `${b.ref} fuel (2 return trips)`, b.id);
    post(d, date, "co2", -EVENT_COSTS.co2, `${b.ref} CO2 refill`, b.id);
    post(d, date, "cleaning", -EVENT_COSTS.cleaning, `${b.ref} line clean`, b.id);
    for (const run of [b.deliver, b.collect]) {
      const o = d.owners.find((x) => x.id === run.ownerId);
      post(d, date, "runner_fees", -d.settings.runnerFee, `${b.ref} run · ${o?.name ?? "owner"}`, b.id);
    }
  }
  if (b.bondStatus === "held") b.bondStatus = "released";
}

// ---------- scheduled jobs ----------

export function runJobs(d: Data, now = new Date()): string[] {
  const today = todayISO(now);
  const log: string[] = [];
  for (const b of d.bookings) {
    if (b.state === "held" && b.heldUntil && Date.parse(b.heldUntil) < now.getTime()) {
      b.state = "cancelled";
      b.cancelledAt = now.toISOString();
      b.notes = (b.notes ? b.notes + " · " : "") + "Hold expired unpaid";
      log.push(`Released expired hold ${b.ref}`);
      continue;
    }
    if (b.kind !== "paid") {
      if (b.date < today && b.state !== "cancelled" && b.state !== "completed") {
        b.state = "completed";
      }
      continue;
    }
    if (b.state === "confirmed" && today >= balanceDueDate(d.settings, b)) {
      chargeBalance(d, b, now);
      log.push(`Charged balance ${money(b.total - b.deposit)} for ${b.ref}`);
    }
    if (b.state === "balance_paid" && b.bondStatus === "none" && daysBetween(today, b.date) <= d.settings.bondHoldDaysBefore) {
      b.bondStatus = "held";
      pay(d, b, "bond_hold", b.bond, now.toISOString());
      log.push(`Placed ${money(b.bond)} bond hold for ${b.ref}`);
    }
    if (b.state === "balance_paid" && b.date < today) {
      completeBooking(d, b, b.date);
      log.push(`Closed ${b.ref} and released bond`);
    }
  }
  return log;
}

// ---------- money ----------

const NON_OPERATING: Account[] = ["capital", "truck", "setup", "dividends"];

export function cashAt(d: Data, date?: string) {
  return d.ledger.filter((e) => !date || e.date <= date).reduce((s, e) => s + e.amount, 0);
}

export function periodTotals(d: Data, start: string, end: string) {
  const es = d.ledger.filter((e) => e.date >= start && e.date <= end && !NON_OPERATING.includes(e.account));
  const revenue = es.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const expenses = -es.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
  return { revenue, expenses, profit: revenue - expenses };
}

export function kmIn(d: Data, start: string, end: string) {
  return d.bookings
    .filter((b) => b.state === "completed" && b.date >= start && b.date <= end)
    .reduce((s, b) => s + b.km * 4, 0);
}

export function reserveTarget(d: Data, asOf: string) {
  const s = d.settings;
  const yearKm = kmIn(d, addDays(asOf, -365), asOf);
  return Math.round(s.reserveMonths * s.fixedMonthly + yearKm * s.maintPerKm + 500);
}

export function computeDistribution(d: Data, quarterKey: string): Distribution {
  const [y, q] = quarterKey.split("-Q").map(Number);
  const start = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
  const { end } = quarterOf(start);
  const t = periodTotals(d, start, end);
  const taxProvision = Math.max(0, Math.round(t.profit * d.settings.taxRate));
  const cash = Math.round(cashAt(d, end));
  const reserve = reserveTarget(d, end);
  const afterTax = Math.max(0, t.profit - taxProvision);
  const cashRoom = Math.max(0, cash - reserve - taxProvision);
  const totalShares = d.owners.reduce((s, o) => s + o.shares, 0);
  // Round each owner's amount down to the nearest $10.
  const raw = Math.min(afterTax, cashRoom);
  const lines = d.owners.map((o) => ({
    ownerId: o.id,
    shares: o.shares,
    amount: Math.floor((raw * o.shares) / totalShares / 10) * 10,
  }));
  const distributable = lines.reduce((s, l) => s + l.amount, 0);
  return {
    id: "dist_" + quarterKey,
    quarter: quarterKey,
    start,
    end,
    revenue: Math.round(t.revenue),
    expenses: Math.round(t.expenses),
    profit: Math.round(t.profit),
    taxProvision,
    cash,
    reserve,
    distributable,
    lines,
    approvals: [],
    status: "awaiting",
  };
}

export function payDistribution(d: Data, distId: string, now = new Date()) {
  const dist = d.distributions.find((x) => x.id === distId);
  if (!dist || dist.status === "paid") return;
  if (dist.approvals.length < d.settings.approvalsRequired) throw new Error("Needs more approvals");
  const date = todayISO(now);
  for (const l of dist.lines) {
    if (l.amount <= 0) continue;
    const o = d.owners.find((x) => x.id === l.ownerId);
    l.payoutId = "po_" + uid("").slice(1);
    post(d, date, "dividends", -l.amount, `${dist.quarter} dividend · ${o?.name}`, l.payoutId);
  }
  dist.status = "paid";
  dist.paidAt = now.toISOString();
}

export const ACCOUNT_LABEL: Record<Account, string> = {
  capital: "Owner capital",
  truck: "Truck purchase",
  setup: "Setup & fit-out",
  revenue: "Booking revenue",
  refunds: "Refunds",
  stripe_fees: "Stripe fees",
  runner_fees: "Runner fees",
  fuel: "Fuel",
  co2: "CO2",
  cleaning: "Line cleaning",
  insurance: "Insurance",
  rego: "Rego",
  maintenance: "Maintenance",
  software: "Software & phone",
  dividends: "Dividends",
  bond: "Bond recoveries",
};
