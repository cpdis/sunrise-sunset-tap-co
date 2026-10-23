// Business rules. Every function takes a mutable draft of Data (the store clones first).
import { defaultStart, findSuburb, startProblem } from "./config";
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
  isISODate,
  money,
  quarterLabel,
  quarterOf,
  sameContact,
  stripeFee,
  todayISO,
  uid,
} from "./util";

export const EVENT_COSTS = { fuelPerKm: 0.22, co2: 35, cleaning: 8, breakage: 15 };
// Straight-line over the ATO effective life of a light truck (8 years).
export const TRUCK_COST = 27000;
export const TRUCK_DEPRECIATION_MONTHLY = Math.round((TRUCK_COST / 8 / 12) * 100) / 100;

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

export type DayStatus = "free" | "booked" | "held" | "personal" | "blackout" | "past" | "too_far" | "short_notice" | "invalid";

export function dayStatus(d: Data, date: string, now = new Date()): DayStatus {
  // Every check below compares date strings, so anything but a real YYYY-MM-DD is refused first.
  if (!isISODate(date)) return "invalid";
  const today = todayISO(now);
  if (date <= today) return "past";
  if (date > addMonths(today, d.settings.bookAheadMonths)) return "too_far";
  if (d.blackouts.includes(date)) return "blackout";
  const b = liveBookings(d, now).find((x) => x.date === date);
  if (b && b.kind === "paid") return b.state === "held" ? "held" : "booked";
  // Inside the notice period an open day can't be booked online; an owner decides.
  if (daysBetween(today, date) < d.settings.minNoticeDays) return "short_notice";
  return b ? "personal" : "free";
}

// Personal-use bookings yield to paid ones, so they count as free for customers.
export function isBookable(d: Data, date: string, now = new Date()): boolean {
  const s = dayStatus(d, date, now);
  return s === "free" || s === "personal";
}

export function nextFreeDates(d: Data, from: string, count: number, weekendsOnly = false, now = new Date()): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 200 && out.length < count; i++) {
    cur = addDays(cur, 1);
    const wd = new Date(cur + "T00:00:00Z").getUTCDay();
    if (weekendsOnly && wd !== 0 && wd !== 6) continue;
    if (isBookable(d, cur, now)) out.push(cur);
  }
  return out;
}

// ---------- ledger & payments ----------

export function post(d: Data, date: string, account: Account, amount: number, memo: string, ref?: string, ownerId?: string) {
  const e: LedgerEntry = { id: uid("le"), date, account, amount: Math.round(amount * 100) / 100, memo, ref, ownerId };
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
  // Customer money is a liability until the hire happens (recognise) or the deposit is forfeited.
  if (type === "deposit" || type === "balance") {
    post(d, date, "deposits", amount, `${b.ref} ${type} received`, b.id);
    post(d, date, "stripe_fees", -fee, `Stripe fee ${b.ref}`, b.id);
  } else if (type === "refund") {
    post(d, date, "deposits", -amount, `${b.ref} refund`, b.id);
  } else if (type === "bond_capture") {
    post(d, date, "bond", amount, `${b.ref} bond captured`, b.id);
  }
  return p;
}

// What the business is holding for a booking that it hasn't earned yet.
export function heldFor(d: Data, bookingId: string) {
  return d.ledger.filter((e) => e.account === "deposits" && e.ref === bookingId).reduce((s, e) => s + e.amount, 0);
}

function recognise(d: Data, b: Booking, date: string, amount: number, memo: string) {
  if (amount <= 0) return;
  post(d, date, "deposits", -amount, `${b.ref} ${memo}`, b.id);
  post(d, date, "revenue", amount, `${b.ref} ${memo}`, b.id);
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
  agreed?: boolean;
}

export function nextRef(d: Data) {
  d.seq += 1;
  return `SST-${d.seq}`;
}

// The customer this booking belongs to. A record matches only when every contact given is already on it, so
// a form with someone's phone and a new email makes a new customer instead of adding that email to theirs.
// Nothing here ever adds a contact to an existing record.
export function upsertCustomer(d: Data, name: string, email?: string, phone?: string) {
  const e = email?.trim() ?? "";
  const p = phone?.trim() ?? "";
  const c = e || p ? d.customers.find((x) => (!e || sameContact(x.email, e)) && (!p || sameContact(x.phone, p))) : undefined;
  if (c) return c;
  const fresh = { id: uid("cus"), name, email: e, phone: p };
  d.customers.push(fresh);
  return fresh;
}

// Refuses a date that isn't bookable at `now` (R12: one live paid booking or hold per date) and a start time that
// doesn't fit the block, whichever surface asked. Callers check first; this is the last word.
export function createHold(d: Data, n: NewBooking, now = new Date()): Booking {
  if (!isBookable(d, n.date, now)) throw new Error(`${n.date} can't be booked (${dayStatus(d, n.date, now)})`);
  const startTime = n.startTime ?? defaultStart(n.block);
  const late = startProblem(n.block, startTime);
  if (late) throw new Error(`Start ${startTime}: ${late}`);
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
    startTime,
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
    agreementSigned: !!n.agreed,
    deliver: { done: false },
    collect: { done: false },
  };
  d.bookings.push(b);
  return b;
}

// The hire terms must have been accepted, either on the web form or at checkout. The receipt email goes on the
// booking, never on the customer: whoever holds a checkout link can't change a customer's contacts.
export function payDeposit(d: Data, bookingId: string, card: string, now = new Date(), agreed = false, receiptEmail?: string) {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b) throw new Error("Booking not found");
  if (b.state !== "held") return b;
  if (agreed) b.agreementSigned = true;
  if (!b.agreementSigned) throw new Error("Hire terms not accepted");
  if (receiptEmail?.trim()) b.receiptEmail = receiptEmail.trim();
  pay(d, b, "deposit", b.deposit, now.toISOString(), card);
  b.state = "confirmed";
  b.heldUntil = undefined;
  if (daysBetween(todayISO(now), b.date) <= d.settings.balanceDaysBefore) {
    pay(d, b, "balance", b.total - b.deposit, now.toISOString(), card);
    b.state = "balance_paid";
  }
  return b;
}

export function balanceDueDate(s: Settings, b: Booking) {
  return addDays(b.date, -s.balanceDaysBefore);
}

export const BALANCE_RETRIES = 3;
export const RELEASE_UNPAID_DAYS = 7;

// One off-session attempt at the balance. A declining card is retried daily, then left for an owner.
export function chargeBalance(d: Data, b: Booking, now = new Date()): "paid" | "declined" | undefined {
  if (b.state !== "confirmed") return;
  if (b.cardDeclines) {
    b.balanceAttempts = (b.balanceAttempts ?? 0) + 1;
    b.balanceFailedAt = now.toISOString();
    d.payments.push({ id: "pi_" + uid("").slice(1), bookingId: b.id, type: "balance", amount: b.total - b.deposit, fee: 0, status: "failed", at: now.toISOString(), card: "Card on file" });
    return "declined";
  }
  pay(d, b, "balance", b.total - b.deposit, now.toISOString());
  b.state = "balance_paid";
  b.balanceFailedAt = undefined;
  return "paid";
}

export function balanceStuck(b: Booking) {
  return b.state === "confirmed" && (b.balanceAttempts ?? 0) >= BALANCE_RETRIES;
}

export function cancelPolicy(s: Settings, b: Booking, now = new Date()) {
  const days = daysBetween(todayISO(now), b.date);
  const paid = b.state === "held" ? 0 : b.state === "balance_paid" ? b.total : b.deposit;
  const fullRefund = days > s.cancelDays;
  const refund = fullRefund ? paid : Math.max(0, paid - b.deposit);
  return { days, paid, refund, kept: paid - refund, fullRefund };
}

// Why a customer's own cancel needs an owner, or undefined when it doesn't. A refund over the agent's limit
// needs an owner from every customer surface (R11): SMS, email and the booking page.
export function cancelNeedsOwner(s: Settings, b: Booking, now = new Date()): string | undefined {
  const pol = cancelPolicy(s, b, now);
  if (pol.refund > s.refundLimit) return `Cancellation of ${b.ref} with refund ${money(pol.refund)} needs owner approval`;
}

export function cancelBooking(d: Data, bookingId: string, now = new Date()) {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b || b.state === "cancelled" || b.state === "completed") return null;
  const pol = cancelPolicy(d.settings, b, now);
  if (pol.refund > 0) pay(d, b, "refund", pol.refund, now.toISOString());
  recognise(d, b, todayISO(now), Math.min(pol.kept, heldFor(d, b.id)), "deposit forfeited on cancellation");
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
    recognise(d, b, date, heldFor(d, b.id), "hire completed");
    const fuel = Math.round(b.km * 2 * 2 * EVENT_COSTS.fuelPerKm);
    post(d, date, "fuel", -fuel, `${b.ref} fuel (2 return trips)`, b.id);
    post(d, date, "co2", -EVENT_COSTS.co2, `${b.ref} CO2 refill`, b.id);
    post(d, date, "cleaning", -EVENT_COSTS.cleaning, `${b.ref} line clean`, b.id);
    post(d, date, "breakage", -EVENT_COSTS.breakage, `${b.ref} glass breakage allowance`, b.id);
    // The fee is an expense now and owed to the runner until the quarterly payout.
    for (const run of [b.deliver, b.collect]) {
      const o = d.owners.find((x) => x.id === run.ownerId);
      post(d, date, "runner_fees", -d.settings.runnerFee, `${b.ref} run · ${o?.name ?? "owner"}`, b.id, run.ownerId);
      post(d, date, "owed_runners", d.settings.runnerFee, `${b.ref} run owed · ${o?.name ?? "owner"}`, b.id, run.ownerId);
    }
  }
}

// ---------- scheduled jobs ----------

export function runJobs(d: Data, now = new Date()): string[] {
  const today = todayISO(now);
  const log: string[] = [];
  if (d.ledger.some((e) => e.account === "truck") && depreciate(d, today)) log.push("Posted this month's truck depreciation");
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
      const triedToday = b.balanceFailedAt && todayISO(new Date(b.balanceFailedAt)) >= today;
      if (b.cardDeclines && daysBetween(today, b.date) <= RELEASE_UNPAID_DAYS) {
        cancelBooking(d, b.id, now);
        b.notes = (b.notes ? b.notes + " · " : "") + `Released: balance unpaid ${RELEASE_UNPAID_DAYS} days out, deposit kept`;
        log.push(`Released ${b.ref}: balance still unpaid ${RELEASE_UNPAID_DAYS} days out`);
        continue;
      }
      if (!triedToday && (b.balanceAttempts ?? 0) < BALANCE_RETRIES) {
        const r = chargeBalance(d, b, now);
        if (r === "paid") log.push(`Charged balance ${money(b.total - b.deposit)} for ${b.ref}`);
        else if (balanceStuck(b)) log.push(`Balance for ${b.ref} declined ${BALANCE_RETRIES} times; needs an owner`);
        else log.push(`Balance for ${b.ref} declined (attempt ${b.balanceAttempts} of ${BALANCE_RETRIES}); retrying tomorrow`);
      }
    }
    if (b.state === "balance_paid" && b.bondStatus === "none" && daysBetween(today, b.date) <= d.settings.bondHoldDaysBefore) {
      b.bondStatus = "held";
      pay(d, b, "bond_hold", b.bond, now.toISOString());
      log.push(`Placed ${money(b.bond)} bond hold for ${b.ref}`);
    }
    if (b.state === "balance_paid" && b.date < today) {
      completeBooking(d, b, b.date);
      log.push(`Closed ${b.ref}${b.bondStatus === "held" ? "; bond held until an owner checks the truck back" : ""}`);
    }
  }
  return log;
}

// ---------- money ----------

// Capital, the truck and balance-sheet accounts don't count towards profit. Depreciation does,
// as a non-cash expense paired with an entry on the truck account.
const NON_OPERATING: Account[] = ["capital", "truck", "setup", "dividends", "deposits", "owed_runners"];

export function balance(d: Data, account: Account, asOf?: string, ownerId?: string) {
  return d.ledger
    .filter((e) => e.account === account && (!asOf || e.date <= asOf) && (!ownerId || e.ownerId === ownerId))
    .reduce((s, e) => s + e.amount, 0);
}

// Book value of the truck: cost less accumulated depreciation.
export function truckBookValue(d: Data, asOf?: string) {
  return -balance(d, "truck", asOf);
}

export function depreciate(d: Data, month: string) {
  const date = month.slice(0, 7) + "-01";
  const bought = d.ledger.find((e) => e.account === "truck")?.date;
  if (!bought || date <= bought) return false;
  if (d.ledger.some((e) => e.account === "depreciation" && e.date === date)) return false;
  post(d, date, "depreciation", -TRUCK_DEPRECIATION_MONTHLY, "Truck depreciation (8-year straight line)");
  post(d, date, "truck", TRUCK_DEPRECIATION_MONTHLY, "Truck depreciation (8-year straight line)");
  return true;
}

// Company tax on profit to date, not yet paid (the demo doesn't lodge a return).
export function taxPayable(d: Data, asOf?: string) {
  const first = d.ledger[0]?.date ?? todayISO();
  const { profit } = periodTotals(d, first, asOf ?? "9999-12-31");
  return Math.max(0, Math.round(profit * d.settings.taxRate));
}

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

// Cash the company may pay out as of a date: cash less customer money held for hires ahead, the reserve and runner
// fees owed. A quarter's tax provision comes off on top (computeDistribution, payoutRefusal).
export function freeCash(d: Data, asOf: string) {
  const free = cashAt(d, asOf) - reserveTarget(d, asOf) - balance(d, "deposits", asOf) - balance(d, "owed_runners", asOf);
  return Math.round(free * 100) / 100;
}

// Approvals that count: those from owners who are directors now.
export function directorApprovals(d: Pick<Data, "owners">, dist: Distribution) {
  return dist.approvals.filter((id) => d.owners.some((o) => o.id === id && o.isDirector));
}

const sumCents = (xs: number[]) => xs.reduce((s, x) => s + Math.round(x * 100), 0);

// What a payout transfers in all: dividends plus runner fees, to the cent.
export function payoutTotal(dist: Distribution) {
  return sumCents(dist.lines.flatMap((l) => [l.amount, l.runnerFees])) / 100;
}

// Why a payout can't be paid when `free` is today's freeCash, or undefined when it can. Runner fees settle money
// already kept back as owed, so only the dividends need room: what is free after the quarter's tax provision.
export function payoutRefusal(dist: Distribution, d: Pick<Data, "owners" | "settings">, free: number): string | undefined {
  const label = quarterLabel(dist.quarter);
  const n = directorApprovals(d, dist).length;
  const need = d.settings.approvalsRequired;
  if (n < need) return `${label} has ${n} of ${need} director approvals, so it can't be paid yet.`;
  const short = dist.distributable - (free - dist.taxProvision);
  if (short > 0) return `${label} can't be paid yet. ${money(Math.ceil(Math.min(payoutTotal(dist), short)))} of it would come out of customer money, the reserve, tax or other runner fees owed.`;
}

export function computeDistribution(d: Data, quarterKey: string): Distribution {
  const id = "dist_" + quarterKey;
  const [y, q] = quarterKey.split("-Q").map(Number);
  const start = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
  const { end } = quarterOf(start);
  const t = periodTotals(d, start, end);
  const taxProvision = Math.max(0, Math.round(t.profit * d.settings.taxRate));
  const afterTax = Math.max(0, t.profit - taxProvision);
  // Customer money for future hires, the reserve and runner fees owed aren't the company's to distribute.
  const cashRoom = Math.max(0, freeCash(d, end) - taxProvision);
  const totalShares = d.owners.reduce((s, o) => s + o.shares, 0);
  const raw = Math.min(afterTax, cashRoom);
  // Each runner fee is settled by one distribution: a later quarter skips fees an earlier one lists, paid or not.
  const claimed = new Set(d.distributions.filter((x) => x.id !== id).flatMap((x) => x.lines.flatMap((l) => l.runnerFeeEntries)));
  const owed = d.ledger.filter((e) => e.account === "owed_runners" && e.amount > 0 && e.date <= end && !claimed.has(e.id));
  const lines = d.owners.map((o) => {
    const fees = owed.filter((e) => e.ownerId === o.id);
    return {
      ownerId: o.id,
      shares: o.shares,
      // Round each owner's amount down to the nearest $10.
      amount: Math.floor((raw * o.shares) / totalShares / 10) * 10,
      // Summed in cents, so a $60.50 fee pays $60.50.
      runnerFees: sumCents(fees.map((e) => e.amount)) / 100,
      runnerFeeEntries: fees.map((e) => e.id),
    };
  });
  const distributable = lines.reduce((s, l) => s + l.amount, 0);
  return {
    id,
    quarter: quarterKey,
    start,
    end,
    revenue: Math.round(t.revenue),
    expenses: Math.round(t.expenses),
    profit: Math.round(t.profit),
    taxProvision,
    cash: Math.round(cashAt(d, end)),
    reserve: reserveTarget(d, end),
    deposits: Math.round(balance(d, "deposits", end)),
    owedRunners: Math.round(balance(d, "owed_runners", end)),
    distributable,
    lines,
    approvals: [],
    status: "awaiting",
  };
}

export function payDistribution(d: Data, distId: string, now = new Date()) {
  const dist = d.distributions.find((x) => x.id === distId);
  if (!dist || dist.status === "paid") return;
  const date = todayISO(now);
  // Checked again as it pays: an expense or refund since the quarter closed can leave less free cash than it showed.
  const why = payoutRefusal(dist, d, freeCash(d, date));
  if (why) throw new Error(why);
  for (const l of dist.lines) {
    if (l.amount <= 0 && l.runnerFees <= 0) continue;
    const o = d.owners.find((x) => x.id === l.ownerId);
    l.payoutId = "po_" + uid("").slice(1);
    if (l.amount > 0) post(d, date, "dividends", -l.amount, `${dist.quarter} dividend · ${o?.name}`, l.payoutId, l.ownerId);
    if (l.runnerFees > 0) post(d, date, "owed_runners", -l.runnerFees, `${dist.quarter} runner fees · ${o?.name}`, l.payoutId, l.ownerId);
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
  deposits: "Customer payments held",
  owed_runners: "Runner fees owed",
  depreciation: "Truck depreciation",
  accounting: "Accountant and ASIC",
  marketing: "Marketing",
  breakage: "Glass breakage",
};
