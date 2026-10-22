// Owner agent tools. An owner texting the business line can do what the admin does, by stakes:
// - low stakes run at once and are echoed back (claim a run, log the truck, calendar, reply to a customer);
// - money, settings and knowledge are staged and run only when the owner's next text is YES;
// - refunds over the agent limit, bond captures, share transfers and the guardrail settings stay in the admin.
// Like the customer tools, these run on the server against a snapshot and return actions for the client store.
import { ADMIN_ONLY_SETTINGS, SETTING_GROUPS } from "../config";
import { ACCOUNT_LABEL, cancelPolicy, dayStatus } from "../domain";
import type { Account, AgentAction, AgentState, Channel, Data, Distribution, Owner, PendingOwnerAction, Settings, TruckLog } from "../types";
import { daysBetween, fmtDate, money, quarterLabel, todayISO } from "../util";

export interface OwnerInboxItem {
  id: string;
  name: string;
  channel: Exclude<Channel, "admin">;
  escalated?: string;
  agentActive: boolean;
  last?: string;
}

// Owners see everything in the admin, so the owner agent does too, except the ledger: the client sends totals instead.
export type OwnerSnapshot = Pick<Data, "settings" | "owners" | "bookings" | "customers" | "distributions" | "truck" | "kb" | "blackouts" | "seq"> & {
  inbox: OwnerInboxItem[];
  money: { cash: number; reserve: number; revenue30: number; profit30: number; held: number; owedRunners: Record<string, number> };
};

export interface OwnerCtx {
  data: OwnerSnapshot;
  owner: Owner;
  now: Date;
  actions: AgentAction[];
  used: string[];
  // Set by a staged tool; the engine stores it in the conversation state.
  staged?: PendingOwnerAction;
}

const d = (ctx: OwnerCtx) => ctx.data as unknown as Data;
const today = (ctx: OwnerCtx) => todayISO(ctx.now);
const ownerName = (ctx: OwnerCtx, id?: string) => ctx.data.owners.find((o) => o.id === id)?.name;
const customerName = (ctx: OwnerCtx, id?: string) => ctx.data.customers.find((c) => c.id === id)?.name ?? "Customer";
const live = (ctx: OwnerCtx) => ctx.data.bookings.filter((b) => b.state !== "cancelled" && b.state !== "completed" && b.date >= today(ctx));

function stage(ctx: OwnerCtx, tool: string, args: Record<string, unknown>, summary: string) {
  ctx.staged = { tool, args, summary };
  return { ok: true as const, needsYes: true, summary };
}

// ---------- read ----------

export function whatsOn(ctx: OwnerCtx) {
  ctx.used.push("whats_on");
  const me = ctx.owner.id;
  const soon = live(ctx).filter((b) => b.kind === "paid" && daysBetween(today(ctx), b.date) <= 30).sort((a, b) => a.date.localeCompare(b.date));
  const runsOf = (b: Data["bookings"][number], pred: (id?: string) => boolean) => (["deliver", "collect"] as const).filter((w) => pred(b[w].ownerId));
  return {
    myRuns: soon.filter((b) => runsOf(b, (id) => id === me).length).map((b) => ({ ref: b.ref, date: fmtDate(b.date, { dow: true }), suburb: b.suburb, runs: runsOf(b, (id) => id === me) })),
    unclaimed: soon.filter((b) => b.state !== "held" && runsOf(b, (id) => !id).length).map((b) => ({ ref: b.ref, date: fmtDate(b.date, { dow: true }), suburb: b.suburb, runs: runsOf(b, (id) => !id) })),
    needsAPerson: ctx.data.inbox.filter((c) => c.escalated).map((c) => ({ name: c.name, why: c.escalated })),
    payouts: ctx.data.distributions.filter((x) => x.status === "awaiting").map((x) => ({ quarter: quarterLabel(x.quarter), amount: x.lines.reduce((s, l) => s + l.amount + l.runnerFees, 0), approvals: x.approvals.length, needsMe: ctx.owner.isDirector && !x.approvals.includes(me) })),
    owedToMe: ctx.data.money.owedRunners[me] ?? 0,
    cash: ctx.data.money.cash,
    revenue30: ctx.data.money.revenue30,
  };
}

export function findBookings(ctx: OwnerCtx, q: { ref?: string; date?: string; suburb?: string; name?: string }) {
  ctx.used.push("find_booking");
  const all = q.ref ? ctx.data.bookings : live(ctx);
  const hits = all
    .filter((b) => !q.ref || b.ref.toUpperCase() === q.ref.toUpperCase())
    .filter((b) => !q.date || b.date === q.date)
    .filter((b) => !q.suburb || b.suburb.toLowerCase().includes(q.suburb.toLowerCase()))
    .filter((b) => !q.name || customerName(ctx, b.customerId).toLowerCase().includes(q.name.toLowerCase()))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map((b) => ({
      ref: b.ref,
      kind: b.kind,
      who: b.kind === "personal" ? `${ownerName(ctx, b.ownerId)} (own use)` : customerName(ctx, b.customerId),
      phone: ctx.data.customers.find((c) => c.id === b.customerId)?.phone,
      date: fmtDate(b.date, { dow: true, year: true }),
      block: b.block,
      start: b.startTime,
      suburb: b.suburb,
      state: b.state,
      total: b.total,
      deliver: ownerName(ctx, b.deliver.ownerId) ?? "unclaimed",
      collect: ownerName(ctx, b.collect.ownerId) ?? "unclaimed",
    }));
  return { bookings: hits, day: q.date ? dayStatus(d(ctx), q.date, ctx.now) : undefined };
}

export function inboxList(ctx: OwnerCtx) {
  ctx.used.push("inbox");
  return ctx.data.inbox.filter((c) => c.escalated || !c.agentActive).map((c) => ({ name: c.name, why: c.escalated ?? "An owner is handling it", last: c.last }));
}

// ---------- low stakes: run at once ----------

type Which = "deliver" | "collect" | "both";

export function claimRun(ctx: OwnerCtx, q: { ref?: string; suburb?: string; date?: string; which: Which }) {
  ctx.used.push("claim_run");
  const want = q.which === "both" ? (["deliver", "collect"] as const) : ([q.which] as const);
  const open = live(ctx)
    .filter((b) => b.kind === "paid" && b.state !== "held")
    .filter((b) => !q.ref || b.ref.toUpperCase() === q.ref.toUpperCase())
    .filter((b) => !q.suburb || b.suburb.toLowerCase().includes(q.suburb.toLowerCase()))
    .filter((b) => !q.date || b.date === q.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return { ok: false as const, reason: "No upcoming confirmed booking matches that." };
  // Prefer the first booking where the run is still free; otherwise take it over from whoever has it.
  const b = open.find((x) => want.some((w) => !x[w].ownerId)) ?? open[0];
  const which = want.filter((w) => b[w].ownerId !== ctx.owner.id);
  if (!which.length) return { ok: false as const, reason: `You already have that run for ${b.ref}.` };
  const from = which.map((w) => ownerName(ctx, b[w].ownerId));
  ctx.actions.push({ type: "claim_run", bookingId: b.id, which: [...which] });
  return { ok: true as const, ref: b.ref, date: fmtDate(b.date, { dow: true }), suburb: b.suburb, start: b.startTime, runs: which, takenFrom: from.filter((x): x is string => !!x), runnerFee: ctx.data.settings.runnerFee * which.length };
}

export function lastOdometer(ctx: OwnerCtx) {
  return Math.max(0, ...ctx.data.truck.map((l) => l.odometer ?? 0));
}

export function logTruck(ctx: OwnerCtx, q: { type: TruckLog["type"]; odometer?: number; notes?: string }) {
  ctx.used.push("log_truck");
  const last = lastOdometer(ctx);
  if (q.odometer !== undefined && q.odometer < last) return { ok: false as const, reason: `The last reading was ${last.toLocaleString()} km, so ${q.odometer.toLocaleString()} km can't be right.` };
  if (q.odometer !== undefined && q.odometer - last > 5000) return { ok: false as const, reason: `That's ${(q.odometer - last).toLocaleString()} km since the last reading (${last.toLocaleString()} km). Check the number and send it again.` };
  const notes = q.notes?.trim() || (q.type === "odometer" ? "Odometer reading" : q.type);
  ctx.actions.push({ type: "truck_log", log: { date: today(ctx), type: q.type, notes: `${notes} (by SMS, ${ctx.owner.name})`, odometer: q.odometer } });
  return { ok: true as const, type: q.type, odometer: q.odometer, sinceLast: q.odometer ? q.odometer - last : undefined };
}

export function calendar(ctx: OwnerCtx, q: { action: "block" | "unblock" | "own_use"; date: string; note?: string }) {
  ctx.used.push("calendar");
  const st = dayStatus(d(ctx), q.date, ctx.now);
  const label = fmtDate(q.date, { dow: true, year: true });
  if (st === "past") return { ok: false as const, reason: `${label} has passed.` };
  if (q.action === "unblock") {
    if (st !== "blackout") return { ok: false as const, reason: `${label} isn't blocked out.` };
    ctx.actions.push({ type: "blackout", date: q.date, on: false });
    return { ok: true as const, label, done: "unblocked" };
  }
  if (st === "booked" || st === "held") return { ok: false as const, reason: `${label} has a customer booking.` };
  if (q.action === "block") {
    if (st === "blackout") return { ok: false as const, reason: `${label} is already blocked out.` };
    ctx.actions.push({ type: "blackout", date: q.date, on: true });
    return { ok: true as const, label, done: "blocked out" };
  }
  if (st === "blackout") return { ok: false as const, reason: `${label} is blocked out.` };
  if (st === "personal") return { ok: false as const, reason: `${label} is already booked for an owner's own use.` };
  ctx.actions.push({ type: "own_use", date: q.date, note: q.note?.trim() || `Own use (${ctx.owner.name})` });
  return { ok: true as const, label, done: "booked for your own use", note: "A paid booking on the same day still takes priority." };
}

function findConversation(ctx: OwnerCtx, who: string) {
  const w = who.toLowerCase().trim();
  const hits = ctx.data.inbox.filter((c) => c.name.toLowerCase().includes(w));
  return hits.length === 1 ? hits[0] : hits.find((c) => c.name.toLowerCase() === w) ?? (hits.length ? { ambiguous: hits.map((c) => c.name) } : undefined);
}

export function replyToCustomer(ctx: OwnerCtx, who: string, text: string) {
  ctx.used.push("inbox");
  const c = findConversation(ctx, who);
  if (!c) return { ok: false as const, reason: `No conversation matches "${who}".` };
  if ("ambiguous" in c) return { ok: false as const, reason: `That matches ${c.ambiguous.join(", ")}. Which one?` };
  ctx.actions.push({ type: "owner_reply", convId: c.id, body: text.trim() });
  return { ok: true as const, to: c.name, channel: c.channel, body: text.trim() };
}

export function handBack(ctx: OwnerCtx, who: string) {
  ctx.used.push("inbox");
  const c = findConversation(ctx, who);
  if (!c) return { ok: false as const, reason: `No conversation matches "${who}".` };
  if ("ambiguous" in c) return { ok: false as const, reason: `That matches ${c.ambiguous.join(", ")}. Which one?` };
  if (c.agentActive && !c.escalated) return { ok: false as const, reason: `The agent already has ${c.name}.` };
  ctx.actions.push({ type: "hand_back", convId: c.id });
  return { ok: true as const, to: c.name };
}

// ---------- staged: run only after YES ----------

export const EXPENSE_ACCOUNTS: Account[] = ["fuel", "co2", "cleaning", "maintenance", "breakage", "insurance", "rego", "software", "accounting", "marketing"];

export function addExpense(ctx: OwnerCtx, q: { account: Account; amount: number; memo: string; date?: string }, commit = false) {
  ctx.used.push("add_expense");
  if (!EXPENSE_ACCOUNTS.includes(q.account)) return { ok: false as const, reason: `Expenses go to one of: ${EXPENSE_ACCOUNTS.join(", ")}.` };
  if (!(q.amount > 0)) return { ok: false as const, reason: "The amount needs to be more than $0." };
  const date = q.date && q.date <= today(ctx) ? q.date : today(ctx);
  const amount = Math.round(q.amount * 100) / 100;
  const memo = `${q.memo.trim() || q.account} (${ctx.owner.name}, by SMS)`;
  const summary = `add a ${money(amount, amount % 1 !== 0)} ${ACCOUNT_LABEL[q.account]} expense dated ${fmtDate(date)}: "${q.memo.trim() || q.account}"`;
  if (!commit) return stage(ctx, "add_expense", { ...q, amount, date }, summary);
  ctx.actions.push({ type: "expense", date, account: q.account, amount, memo });
  return { ok: true as const, done: true, summary };
}

function openPayout(ctx: OwnerCtx): Distribution | undefined {
  return [...ctx.data.distributions].filter((x) => x.status === "awaiting").sort((a, b) => a.quarter.localeCompare(b.quarter))[0];
}

export function payout(ctx: OwnerCtx, q: { action: "approve" | "pay" }, commit = false) {
  ctx.used.push("payout");
  const dist = openPayout(ctx);
  if (!dist) return { ok: false as const, reason: "No payout is waiting." };
  const need = ctx.data.settings.approvalsRequired;
  const label = quarterLabel(dist.quarter);
  const total = dist.lines.reduce((s, l) => s + l.amount + l.runnerFees, 0);
  if (q.action === "approve") {
    if (!ctx.owner.isDirector) return { ok: false as const, reason: "Only directors approve payouts." };
    if (dist.approvals.includes(ctx.owner.id)) return { ok: false as const, reason: `You've already approved ${label} (${dist.approvals.length} of ${need}).` };
    const after = dist.approvals.length + 1;
    const summary = `approve the ${label} payout of ${money(total)} (${money(dist.distributable)} dividends plus ${money(total - dist.distributable)} runner fees). That makes ${after} of ${need} approvals`;
    if (!commit) return stage(ctx, "payout", q, summary);
    ctx.actions.push({ type: "approve_payout", distId: dist.id });
    return { ok: true as const, done: true, summary, ready: after >= need };
  }
  if (dist.approvals.length < need) return { ok: false as const, reason: `${label} has ${dist.approvals.length} of ${need} director approvals, so it can't be paid yet.` };
  if (total <= 0) return { ok: false as const, reason: `${label} has nothing to pay.` };
  const summary = `pay the ${label} payout: ${money(total)} by bank transfer to ${dist.lines.filter((l) => l.amount + l.runnerFees > 0).length} owners (simulated)`;
  if (!commit) return stage(ctx, "payout", q, summary);
  ctx.actions.push({ type: "pay_payout", distId: dist.id });
  return { ok: true as const, done: true, summary };
}

export function cancelForCustomer(ctx: OwnerCtx, ref: string, commit = false) {
  ctx.used.push("cancel_booking");
  const b = live(ctx).find((x) => x.ref.toUpperCase() === ref.toUpperCase());
  if (!b) return { ok: false as const, reason: `No upcoming booking ${ref}.` };
  if (b.kind === "personal") return { ok: false as const, reason: `${b.ref} is own use. Cancel it from the calendar.` };
  const pol = cancelPolicy(ctx.data.settings, b, ctx.now);
  const limit = ctx.data.settings.refundLimit;
  if (pol.refund > limit) return { ok: false as const, reason: `That refund is ${money(pol.refund)}, over the ${money(limit)} SMS limit. Cancel ${b.ref} in the admin.` };
  const summary = `cancel ${b.ref} (${customerName(ctx, b.customerId)}, ${fmtDate(b.date, { dow: true })}, ${b.suburb}) with a ${money(pol.refund)} refund and ${money(pol.kept)} kept. The customer isn't texted, so let them know yourself`;
  if (!commit) return stage(ctx, "cancel_booking", { ref }, summary);
  ctx.actions.push({ type: "cancel", bookingId: b.id });
  return { ok: true as const, done: true, summary };
}

export const SMS_SETTINGS = SETTING_GROUPS.flatMap((g) => g.fields).filter((f) => !ADMIN_ONLY_SETTINGS.includes(f.k));

export function changeSetting(ctx: OwnerCtx, q: { key: string; value: number }, commit = false) {
  ctx.used.push("change_setting");
  if (ADMIN_ONLY_SETTINGS.includes(q.key as keyof Settings)) return { ok: false as const, reason: "That one can only be changed in the admin." };
  const f = SMS_SETTINGS.find((x) => x.k === q.key);
  if (!f) return { ok: false as const, reason: `I can change: ${SMS_SETTINGS.map((x) => x.label.toLowerCase()).join("; ")}.` };
  if (!Number.isFinite(q.value) || q.value < 0) return { ok: false as const, reason: "That needs to be a number of 0 or more." };
  const fmt = (v: number) => (f.unit === "$" ? money(v) : `${v}${f.unit ? ` ${f.unit}` : ""}`);
  const was = ctx.data.settings[f.k];
  if (was === q.value) return { ok: false as const, reason: `${f.label} is already ${fmt(was)}.` };
  const summary = `change "${f.label}" from ${fmt(was)} to ${fmt(q.value)}. The site, checkout and agent use it from the next booking`;
  if (!commit) return stage(ctx, "change_setting", q, summary);
  ctx.actions.push({ type: "settings", patch: { [f.k]: q.value } });
  return { ok: true as const, done: true, summary };
}

export function addKnowledge(ctx: OwnerCtx, q: { page: string; line: string }, commit = false) {
  ctx.used.push("add_knowledge");
  const w = q.page.toLowerCase();
  const p = ctx.data.kb.find((x) => x.slug === w) ?? ctx.data.kb.find((x) => x.title.toLowerCase().includes(w) || x.slug.includes(w));
  if (!p) return { ok: false as const, reason: `Pages: ${ctx.data.kb.map((x) => x.slug).join(", ")}.` };
  const line = q.line.trim().replace(/^-\s*/, "");
  if (!line) return { ok: false as const, reason: "What should the line say?" };
  const summary = `add to "${p.title}": "${line}". The agent tells customers this from the next message`;
  if (!commit) return stage(ctx, "add_knowledge", { page: p.slug, line }, summary);
  ctx.actions.push({ type: "kb_append", slug: p.slug, line });
  return { ok: true as const, done: true, summary };
}

// ---------- confirmation ----------

const YES = /^(y|yes|yep|yeah|yup|confirm|confirmed|do it|go|go ahead|ok|okay)\b/i;
const NO = /^(n|no|nope|nah|cancel|stop|don't|dont|leave it)\b/i;

// Runs a staged change on YES. The tool runs again against the fresh snapshot, so a change that stopped being
// valid since it was staged (someone else approved, the date got booked) is refused rather than forced through.
export function resolvePending(ctx: OwnerCtx, state: AgentState, text: string): string | undefined {
  const p = state.pending;
  if (!p) return undefined;
  state.pending = undefined;
  const t = text.trim();
  if (NO.test(t)) return "No worries, I've left it.";
  if (!YES.test(t)) return undefined;
  const a = p.args as never;
  const r =
    p.tool === "add_expense" ? addExpense(ctx, a, true)
    : p.tool === "payout" ? payout(ctx, a, true)
    : p.tool === "cancel_booking" ? cancelForCustomer(ctx, (p.args as { ref: string }).ref, true)
    : p.tool === "change_setting" ? changeSetting(ctx, a, true)
    : p.tool === "add_knowledge" ? addKnowledge(ctx, a, true)
    : { ok: false as const, reason: "I've lost track of that one. Send it again?" };
  if (!r.ok) return `I didn't do it: ${r.reason}`;
  const extra = "ready" in r && r.ready ? " It has enough approvals now. Text PAY THE PAYOUT to send it." : "";
  return `Done. I ${pastTense(p.summary)}.${extra}`;
}

// "add a $42 expense" -> "added a $42 expense"; the summaries all start with one of these verbs.
function pastTense(summary: string) {
  return summary.replace(/^(add|approve|pay|cancel|change)\b/, (v) => ({ add: "added", approve: "approved", pay: "paid", cancel: "cancelled", change: "changed" })[v as "add"]);
}
