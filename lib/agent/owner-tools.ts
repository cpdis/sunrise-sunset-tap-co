// Owner agent tools. An owner texting the business line can do what the admin does, by stakes:
// - low stakes run at once and are echoed back (claim a run, log the truck, calendar, reply to a customer, hand back);
// - money, settings, knowledge and sending the agent's draft are staged and run only when the owner's next text is YES;
// - refunds over the agent limit, expenses over the SMS cap, bond captures, share transfers, and the money and
//   guardrail settings (ADMIN_ONLY_SETTINGS) stay in the admin.
// Like the customer tools, these run on the server against a snapshot and return actions for the client store.
import { ADMIN_ONLY_SETTINGS, SETTING_GROUPS, settingProblem } from "../config";
import { ACCOUNT_LABEL, cancelPolicy, dayStatus, directorApprovals, payoutRefusal, payoutTotal } from "../domain";
import type { Account, AgentAction, AgentState, Channel, Data, Distribution, Owner, PendingOwnerAction, Settings, TruckLog } from "../types";
import { handBack as opsHandBack, owesReply, replyRoute } from "../ops";
import { daysBetween, fmtDate, isISODate, money, quarterLabel, todayISO } from "../util";
import { parseConfirm } from "./confirm";

export interface OwnerInboxItem {
  id: string;
  name: string;
  channel: Exclude<Channel, "admin">;
  contact: string;
  escalated?: string;
  agentActive: boolean;
  last?: string;
  // The reply the agent drafted when it handed over (sent with send_draft).
  draft?: string;
}

// Owners see everything in the admin, so the owner agent does too, except the ledger: the client sends totals instead.
export type OwnerSnapshot = Pick<Data, "settings" | "owners" | "bookings" | "customers" | "distributions" | "truck" | "kb" | "blackouts" | "seq"> & {
  inbox: OwnerInboxItem[];
  // free: domain freeCash today, which a payout's dividends must fit in (payoutRefusal).
  money: { cash: number; reserve: number; revenue30: number; profit30: number; held: number; owedRunners: Record<string, number>; free: number };
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
    payouts: ctx.data.distributions.filter((x) => x.status === "awaiting").map((x) => ({ quarter: quarterLabel(x.quarter), amount: payoutTotal(x), approvals: directorApprovals(ctx.data, x).length, needsMe: ctx.owner.isDirector && !x.approvals.includes(me) })),
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
  return ctx.data.inbox.filter((c) => c.escalated || !c.agentActive).map((c) => ({ name: c.name, why: c.escalated ?? "An owner is handling it", last: c.last, draft: c.draft }));
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
  if (st === "invalid") return { ok: false as const, reason: "That isn't a real date." };
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

// The owner names a conversation by text, or a pick from an ambiguity list names it by id.
export type Who = string | { id: string };

// Customers choose their own names, so a name never picks one of two conversations that share it: an impostor
// can book as "Harbour Collective (events)". One exact match still beats partial ones ("Sophie" over "Sophie Tran").
function findConversation(ctx: OwnerCtx, who: Who): OwnerInboxItem | { ambiguous: OwnerInboxItem[] } | undefined {
  if (typeof who !== "string") return ctx.data.inbox.find((c) => c.id === who.id);
  const w = who.toLowerCase().trim();
  const hits = ctx.data.inbox.filter((c) => c.name.toLowerCase().includes(w));
  const exact = hits.filter((c) => c.name.toLowerCase() === w);
  const pool = exact.length ? exact : hits;
  if (pool.length === 1) return pool[0];
  return pool.length ? { ambiguous: pool } : undefined;
}

const noMatch = (who: Who) => ({ ok: false as const, reason: typeof who === "string" ? `No conversation matches "${who}".` : "That conversation has gone." });

const digits = (s: string) => s.replace(/\D/g, "");

// "0413 ••• 818", "ev•••@harbourcollective.com.au": enough for the owner to tell two conversations apart.
export function maskContact(contact: string) {
  if (contact.includes("@")) {
    const [user, domain] = contact.split("@");
    return `${user.slice(0, 2)}•••@${domain}`;
  }
  const n = digits(contact);
  return n.length < 7 ? `••• ${n.slice(-3)}` : `${n.slice(0, 4)} ••• ${n.slice(-3)}`;
}

// Lists the matches and stages the tool call; the owner's next text picks one by number or contact (resolvePick).
function askWhich(ctx: OwnerCtx, tool: string, args: Record<string, unknown>, matches: OwnerInboxItem[]) {
  const lines = matches.map((c, i) => `${i + 1}. ${c.name}, ${maskContact(c.contact)}`);
  const reason = `That matches ${matches.length} conversations:\n${lines.join("\n")}\nReply with the number or the end of the contact.`;
  ctx.staged = { tool: "pick_conversation", args: { tool, ids: matches.map((c) => c.id), args }, summary: reason };
  return { ok: false as const, ambiguous: true, reason };
}

export function replyToCustomer(ctx: OwnerCtx, who: Who, text: string) {
  ctx.used.push("inbox");
  const c = findConversation(ctx, who);
  if (!c) return noMatch(who);
  if ("ambiguous" in c) return askWhich(ctx, "reply_to_customer", { text }, c.ambiguous);
  ctx.actions.push({ type: "owner_reply", convId: c.id, body: text.trim() });
  return { ok: true as const, to: c.name, ...route(c), body: text.trim() };
}

export const sentText = (r: { to: string; via: string; contact: string }) =>
  `Sent to ${r.to} by ${r.via} to ${r.contact}. You have that chat now; text "hand back ${r.to.split(" ")[0]}" when you're done.`;

// "by SMS to 0433 210 877": how a reply to this conversation really goes out.
function route(c: OwnerInboxItem) {
  const r = replyRoute(c);
  return { via: r.via === "sms" ? "SMS" : "email", contact: r.to };
}

export function handBack(ctx: OwnerCtx, who: Who, force = false) {
  ctx.used.push("inbox");
  const c = findConversation(ctx, who);
  if (!c) return noMatch(who);
  if ("ambiguous" in c) return askWhich(ctx, "hand_back", { force }, c.ambiguous);
  if (c.agentActive && !c.escalated) return { ok: false as const, reason: `The agent already has ${c.name}.` };
  // Dry run of the shared op, so the SMS refusal is the same guard the admin button and applyOwnerAction use.
  const dry = { owners: ctx.data.owners, conversations: [{ ...c, messages: [] }] } as unknown as Data;
  const r = opsHandBack(dry, c.id, ctx.owner.id, force);
  if (!r.ok) {
    return { ok: false as const, owesReply: true, reason: `${r.reason} Reply first${c.draft ? ", send the agent's draft" : ""}, or text "hand back ${c.name.split(" ")[0]} anyway".` };
  }
  ctx.actions.push({ type: "hand_back", convId: c.id, force: force || undefined });
  // A flag-only hand-over never took the agent off, so this clears the flag rather than handing anything back.
  // The customer can still have been told an owner will reply ("They'll reply today"), so the warning stands.
  return { ok: true as const, to: c.name, flagOnly: c.agentActive, withoutReply: owesReply(c) };
}

export const handBackText = (r: { to: string; flagOnly: boolean; withoutReply: boolean }) =>
  `${r.flagOnly ? `Cleared the flag on ${r.to}; the agent still has it.` : `Handed ${r.to} back to the agent.`}${r.withoutReply ? " Heads up: they were told an owner would reply, and nobody has." : ""}`;

// ---------- staged: run only after YES ----------

export const EXPENSE_ACCOUNTS: Account[] = ["fuel", "co2", "cleaning", "maintenance", "breakage", "insurance", "rego", "software", "accounting", "marketing"];

export function addExpense(ctx: OwnerCtx, q: { account: Account; amount: number; memo: string; date?: string }, commit = false) {
  ctx.used.push("add_expense");
  if (!EXPENSE_ACCOUNTS.includes(q.account)) return { ok: false as const, reason: `Expenses go to one of: ${EXPENSE_ACCOUNTS.join(", ")}.` };
  if (!(q.amount > 0)) return { ok: false as const, reason: "The amount needs to be more than $0." };
  const amount = Math.round(q.amount * 100) / 100;
  // Fails closed: a snapshot without a cap allows nothing.
  const cap = ctx.data.settings.smsExpenseCap ?? 0;
  if (amount > cap) return { ok: false as const, reason: `${money(amount, amount % 1 !== 0)} is over the ${money(cap)} SMS limit for expenses. Add it in the admin, under Money.` };
  const date = isISODate(q.date) && q.date <= today(ctx) ? q.date : today(ctx);
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
  const total = payoutTotal(dist);
  const cash = (n: number) => money(n, n % 1 !== 0);
  if (!ctx.owner.isDirector) return { ok: false as const, reason: `Only directors ${q.action} payouts.` };
  if (q.action === "approve") {
    const have = directorApprovals(ctx.data, dist).length;
    if (dist.approvals.includes(ctx.owner.id)) return { ok: false as const, reason: `You've already approved ${label} (${have} of ${need}).` };
    const after = have + 1;
    const summary = `approve the ${label} payout of ${cash(total)} (${money(dist.distributable)} dividends plus ${cash(total - dist.distributable)} runner fees). That makes ${after} of ${need} approvals`;
    if (!commit) return stage(ctx, "payout", q, summary);
    ctx.actions.push({ type: "approve_payout", distId: dist.id });
    return { ok: true as const, done: true, summary, ready: after >= need };
  }
  // The same check payDistribution makes as it pays, on the snapshot's free cash, so a refusal is said, not hidden.
  const why = payoutRefusal(dist, ctx.data, ctx.data.money.free);
  if (why) return { ok: false as const, reason: why };
  if (total <= 0) return { ok: false as const, reason: `${label} has nothing to pay.` };
  const summary = `pay the ${label} payout: ${cash(total)} by bank transfer to ${dist.lines.filter((l) => l.amount + l.runnerFees > 0).length} owners (simulated)`;
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
  const canSms = `By SMS I can change: ${SMS_SETTINGS.map((x) => x.label.toLowerCase()).join("; ")}.`;
  if (ADMIN_ONLY_SETTINGS.includes(q.key as keyof Settings)) return { ok: false as const, reason: `That one can only be changed in the admin, under Settings. ${canSms}` };
  const f = SMS_SETTINGS.find((x) => x.k === q.key);
  if (!f) return { ok: false as const, reason: canSms };
  const bad = settingProblem(f.k, q.value);
  if (bad) return { ok: false as const, reason: `${f.label}: ${bad[0].toLowerCase()}${bad.slice(1)}` };
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

const MIN_DRAFT = 40;

// Sends a text the owner may not have read, so it is staged: the summary quotes the draft in full.
export function sendDraft(ctx: OwnerCtx, who: Who, commit = false) {
  ctx.used.push("send_draft");
  const c = findConversation(ctx, who);
  if (!c) return noMatch(who);
  if ("ambiguous" in c) return askWhich(ctx, "send_draft", {}, c.ambiguous);
  if (!c.draft) return { ok: false as const, reason: `There's no draft reply for ${c.name}. Text "tell ${c.name.split(" ")[0]}: ..." to write one.` };
  // A greeting on its own ("Hi, one of the owners here.") would reach the customer as the whole reply.
  if (c.draft.trim().length < MIN_DRAFT) return { ok: false as const, reason: `The agent only drafted a greeting. Text "tell ${c.name.split(" ")[0]}: ..." instead.` };
  const r = route(c);
  const summary = `send ${c.name} the agent's draft by ${r.via} to ${r.contact}: "${c.draft}"`;
  // Staged by id: the YES must send to this conversation, not whichever one the name finds next time.
  if (!commit) return stage(ctx, "send_draft", { id: c.id }, summary);
  ctx.actions.push({ type: "send_draft", convId: c.id });
  return { ok: true as const, done: true, summary };
}

// ---------- confirmation ----------

// Runs a staged change on YES. The tool runs again against the fresh snapshot, so a change that stopped being
// valid since it was staged (someone else approved, the date got booked) is refused rather than forced through.
export function resolvePending(ctx: OwnerCtx, state: AgentState, text: string): string | undefined {
  const p = state.pending;
  if (!p) return undefined;
  state.pending = undefined;
  if (p.tool === "pick_conversation") return resolvePick(ctx, p, text);
  // Any text but a clear yes drops the change; only a refusal gets its own reply.
  const c = parseConfirm(text);
  if (c === "no") return "No worries, I've left it.";
  if (c === "other") return undefined;
  const a = p.args as never;
  const r =
    p.tool === "add_expense" ? addExpense(ctx, a, true)
    : p.tool === "payout" ? payout(ctx, a, true)
    : p.tool === "cancel_booking" ? cancelForCustomer(ctx, (p.args as { ref: string }).ref, true)
    : p.tool === "change_setting" ? changeSetting(ctx, a, true)
    : p.tool === "add_knowledge" ? addKnowledge(ctx, a, true)
    : p.tool === "send_draft" ? sendDraft(ctx, { id: String(p.args.id) }, true)
    : { ok: false as const, reason: "I've lost track of that one. Send it again?" };
  if (!r.ok) return `I didn't do it: ${r.reason}`;
  const extra = "ready" in r && r.ready ? " It has enough approvals now. Text PAY THE PAYOUT to send it." : "";
  return `Done. I ${pastTense(p.summary)}.${extra}`;
}

export const confirmText = (summary: string) => `To confirm: ${summary}. Reply YES to go ahead.`;

// The owner's answer to an ambiguity list: "2", "#2", "818", "the email one", or the contact as listed.
// Anything else is not a pick, so the list is dropped and the text is handled as a new message.
function resolvePick(ctx: OwnerCtx, p: PendingOwnerAction, text: string): string | undefined {
  const { tool, ids, args } = p.args as { tool: string; ids: string[]; args: { text?: string; force?: boolean } };
  const matches = ids.map((id) => ctx.data.inbox.find((c) => c.id === id)).filter((c): c is OwnerInboxItem => !!c);
  const i = pickIndex(text, matches);
  if (i === undefined) return undefined;
  const who = { id: matches[i].id };
  if (tool === "reply_to_customer") {
    const r = replyToCustomer(ctx, who, args.text ?? "");
    return r.ok ? sentText(r) : r.reason;
  }
  if (tool === "hand_back") {
    const r = handBack(ctx, who, args.force === true);
    return r.ok ? handBackText(r) : r.reason;
  }
  if (tool === "send_draft") {
    const r = sendDraft(ctx, who);
    return r.ok ? confirmText(r.summary) : r.reason;
  }
  return undefined;
}

function pickIndex(text: string, matches: OwnerInboxItem[]): number | undefined {
  const t = text.toLowerCase().replace(/[.!?]+\s*$/, "").replace(/^\s*(?:number|no\.?|option|#)\s*/, "").trim();
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= matches.length ? n - 1 : undefined;
  }
  if (t.length < 3) return undefined;
  const via = t.match(/^(?:the\s+)?(email|sms|text|phone|mobile)(?:\s+one)?$/)?.[1];
  const tail = /^[\d\s]+$/.test(t) ? digits(t) : undefined;
  const hits = matches.flatMap((c, i) => {
    const ok = via ? replyRoute(c).via === (via === "email" ? "email" : "sms")
      : tail ? digits(c.contact).endsWith(tail)
      : maskContact(c.contact).toLowerCase() === t || c.contact.toLowerCase().endsWith(t);
    return ok ? [i] : [];
  });
  // A tail both contacts share ("8") picks nothing.
  return hits.length === 1 ? hits[0] : undefined;
}

// "add a $42 expense" -> "added a $42 expense"; the summaries all start with one of these verbs.
function pastTense(summary: string) {
  return summary.replace(/^(add|approve|pay|cancel|change|send)\b/, (v) => ({ add: "added", approve: "approved", pay: "paid", cancel: "cancelled", change: "changed", send: "sent" })[v as "add"]);
}
