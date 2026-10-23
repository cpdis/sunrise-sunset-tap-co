// Owner agent tools. An owner texting the business line can do over SMS what they do in the admin, but caller ID
// proves nothing, so by stakes (KTD6):
// - reads run at once: what's on, finding a booking, the inbox;
// - every change is staged and runs only when the owner replies YES with the 4-digit nonce in the confirmation,
//   which goes to the owner's real handset (KTD11): claiming a run, the truck log, the calendar, replying to a
//   customer and handing back;
// - money, the settings SMS may change, knowledge lines and sending the agent's draft also need the one-time code on
//   the owner's admin page;
// - refunds over the agent limit, expenses over the SMS cap, bond captures, share transfers, and the money and
//   guardrail settings (ADMIN_ONLY_SETTINGS) stay in the admin.
// Each change is planned on the snapshot without doing it. Staging keeps the plan's exact actions and summary
// (KTD4), and YES plans it again: only the same plan runs, and a changed one asks again. The server keeps staged
// changes in the approvals table and applies a YES in the same write that consumes its approval (lib/server/agent.ts).
import { ADMIN_ONLY_SETTINGS, SETTING_GROUPS, settingProblem } from "../config";
import { ACCOUNT_LABEL, cancelPolicy, dayStatus, directorApprovals, payoutRefusal, payoutTotal } from "../domain";
import type { Account, AgentAction, ApprovalChange, ApprovalStatus, Channel, Data, Distribution, Owner, PendingApproval, Settings, StagedApproval, TruckLog } from "../types";
import { handBack as opsHandBack, owesReply, replyRoute } from "../ops";
import { canon, daysBetween, fmtDate, fmtTime, isISODate, money, quarterLabel, safeEqual, todayISO, uid } from "../util";
import { newCode, parseApproval } from "./confirm";

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

// Owners see everything in the admin, so the owner agent does too, except the ledger: the snapshot carries totals instead.
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
  // The conversation's staged approval when this message came in, from the server (lib/server/approvals.ts).
  pending?: PendingApproval;
  // What this message does to `pending` (resolvePending). Left unset, `pending` stays staged.
  settled?: ApprovalChange["settled"];
  // The change this turn staged. One per turn.
  staged?: StagedApproval;
  // A second change this turn asked for, refused until the first is answered.
  deferred?: boolean;
}

// A staged change expires after this, and a YES then does nothing (KTD4).
export const APPROVAL_MINUTES = 10;
// Bumped when what a stage binds or what it needs changes. A staged row from another version asks again.
const APPROVAL_POLICY = 1;
// An ambiguity list: the owner's answer picks a conversation for the tool that asked (askWhich).
export const PICK = "pick_conversation";

type StagedTool = "claim_run" | "log_truck" | "calendar" | "reply_to_customer" | "hand_back" | "send_draft" | "add_expense" | "payout" | "cancel_booking" | "change_setting" | "add_knowledge";

// KTD6: the changes that need the one-time code on top of YES and the nonce.
const NEEDS_CODE: Record<StagedTool, boolean> = {
  claim_run: false,
  log_truck: false,
  calendar: false,
  reply_to_customer: false,
  hand_back: false,
  send_draft: true,
  add_expense: true,
  payout: true,
  cancel_booking: true,
  change_setting: true,
  add_knowledge: true,
};

// What a change would do, worked out on the snapshot without doing it.
interface Plan {
  ok: true;
  tool: StagedTool;
  // The tool's input as YES plans it again: a conversation named by text is pinned to its id.
  args: Record<string, unknown>;
  summary: string;
  actions: AgentAction[];
  // The reply once it is done.
  said: string;
}

interface Refusal {
  ok: false;
  reason: string;
}

const today = (ctx: OwnerCtx) => todayISO(ctx.now);
const ownerName = (ctx: OwnerCtx, id?: string) => ctx.data.owners.find((o) => o.id === id)?.name;
const customerName = (ctx: OwnerCtx, id?: string) => ctx.data.customers.find((c) => c.id === id)?.name ?? "Customer";
const live = (ctx: OwnerCtx) => ctx.data.bookings.filter((b) => b.state !== "cancelled" && b.state !== "completed" && b.date >= today(ctx));
const refuse = (reason: string): Refusal => ({ ok: false, reason });

export const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export const runWord = (w: string) => (w === "deliver" ? "delivery" : "collection");

// What YES must apply for a plan to count as the one confirmed: its actions and the words the owner read.
const binding = (p: Pick<Plan, "actions" | "summary">) => canon({ actions: p.actions, summary: p.summary });

function newApproval(ctx: OwnerCtx, s: Pick<StagedApproval, "tool" | "args" | "summary" | "binding" | "nonce" | "needsCode">): StagedApproval {
  return { id: uid("apr"), ...s, policyVersion: APPROVAL_POLICY, expiresAt: new Date(ctx.now.getTime() + APPROVAL_MINUTES * 60_000).toISOString() };
}

// Stages a plan for YES with a fresh nonce. One per turn, so the owner confirms one thing at a time.
function stage(ctx: OwnerCtx, p: Plan | Refusal) {
  if (!p.ok) return p;
  if (ctx.staged) {
    ctx.deferred = true;
    return refuse(`One change at a time: "${ctx.staged.summary}" is waiting for the owner's YES first.`);
  }
  ctx.staged = newApproval(ctx, { tool: p.tool, args: p.args, summary: p.summary, binding: binding(p), nonce: newCode(), needsCode: NEEDS_CODE[p.tool] });
  return { ok: true as const, staged: true as const, summary: p.summary };
}

// The confirmation the owner gets, rendered from the staged row by code and never by the model (KTD5).
function stagedText(s: StagedApproval) {
  if (s.tool === PICK) return s.summary;
  return `To confirm: ${s.summary}. Reply YES ${s.nonce}${s.needsCode ? " and the 6-digit code from your admin page" : ""} to go ahead.`;
}

// A turn's reply: when it staged a change, the confirmation, whatever else the engine wrote.
export function finish(ctx: OwnerCtx, reply: string) {
  if (!ctx.staged) return reply;
  return `${stagedText(ctx.staged)}${ctx.deferred ? " One change at a time, so send the other one after this." : ""}`;
}

export const approvalOf = (ctx: OwnerCtx): ApprovalChange | undefined => (ctx.settled || ctx.staged ? { settled: ctx.settled, staged: ctx.staged } : undefined);

// ---------- read: run at once ----------

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
  return { bookings: hits, day: q.date ? dayStatus(ctx.data, q.date, ctx.now) : undefined };
}

export function inboxList(ctx: OwnerCtx) {
  ctx.used.push("inbox");
  return ctx.data.inbox.filter((c) => c.escalated || !c.agentActive).map((c) => ({ name: c.name, why: c.escalated ?? "An owner is handling it", last: c.last, draft: c.draft }));
}

// ---------- changes that need YES and the nonce ----------

type Which = "deliver" | "collect" | "both";

function planClaimRun(ctx: OwnerCtx, q: { ref?: string; suburb?: string; date?: string; which: Which }): Plan | Refusal {
  ctx.used.push("claim_run");
  const want = q.which === "both" ? (["deliver", "collect"] as const) : ([q.which] as const);
  const open = live(ctx)
    .filter((b) => b.kind === "paid" && b.state !== "held")
    .filter((b) => !q.ref || b.ref.toUpperCase() === q.ref.toUpperCase())
    .filter((b) => !q.suburb || b.suburb.toLowerCase().includes(q.suburb.toLowerCase()))
    .filter((b) => !q.date || b.date === q.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return refuse("No upcoming confirmed booking matches that.");
  // Prefer the first booking where the run is still free; otherwise take it over from whoever has it.
  const b = open.find((x) => want.some((w) => !x[w].ownerId)) ?? open[0];
  const which = want.filter((w) => b[w].ownerId !== ctx.owner.id);
  if (!which.length) return refuse(`You already have that run for ${b.ref}.`);
  const from = which.map((w) => ownerName(ctx, b[w].ownerId)).filter((x): x is string => !!x);
  const runs = list(which.map(runWord));
  const taken = from.length ? ` (taking it over from ${list(from)})` : "";
  return {
    ok: true,
    tool: "claim_run",
    // Pinned to the booking, so YES claims the run that was confirmed.
    args: { ref: b.ref, which: q.which },
    summary: `put you down for the ${runs} on ${b.ref}: ${fmtDate(b.date, { dow: true })}, ${b.suburb}, taps open ${fmtTime(b.startTime)}${taken}. ${money(ctx.data.settings.runnerFee * which.length)} in runner fees, paid with the next payout`,
    actions: [{ type: "claim_run", bookingId: b.id, which: [...which] }],
    said: `Done, you've got the ${runs} for ${b.ref}.`,
  };
}

export const claimRun = (ctx: OwnerCtx, q: Parameters<typeof planClaimRun>[1]) => stage(ctx, planClaimRun(ctx, q));

export function lastOdometer(ctx: OwnerCtx) {
  return Math.max(0, ...ctx.data.truck.map((l) => l.odometer ?? 0));
}

function planLogTruck(ctx: OwnerCtx, q: { type: TruckLog["type"]; odometer?: number; notes?: string }): Plan | Refusal {
  ctx.used.push("log_truck");
  const last = lastOdometer(ctx);
  if (q.odometer !== undefined && q.odometer < last) return refuse(`The last reading was ${last.toLocaleString()} km, so ${q.odometer.toLocaleString()} km can't be right.`);
  if (q.odometer !== undefined && q.odometer - last > 5000) return refuse(`That's ${(q.odometer - last).toLocaleString()} km since the last reading (${last.toLocaleString()} km). Check the number and send it again.`);
  const notes = q.notes?.trim() || (q.type === "odometer" ? "Odometer reading" : q.type);
  const at = q.odometer !== undefined ? ` at ${q.odometer.toLocaleString()} km` : "";
  const since = q.odometer !== undefined && q.odometer > last ? ` (${(q.odometer - last).toLocaleString()} km since the last reading)` : "";
  const what = q.type === "odometer" ? `an odometer reading${at}${since}` : `a ${q.type}${at}`;
  const note = q.type === "odometer" ? "" : `: "${notes}"`;
  return {
    ok: true,
    tool: "log_truck",
    args: q,
    summary: `log ${what} in the truck log${note}`,
    actions: [{ type: "truck_log", log: { date: today(ctx), type: q.type, notes: `${notes} (by SMS, ${ctx.owner.name})`, odometer: q.odometer } }],
    said: `Logged ${what}${note}.`,
  };
}

export const logTruck = (ctx: OwnerCtx, q: Parameters<typeof planLogTruck>[1]) => stage(ctx, planLogTruck(ctx, q));

function planCalendar(ctx: OwnerCtx, q: { action: "block" | "unblock" | "own_use"; date: string; note?: string }): Plan | Refusal {
  ctx.used.push("calendar");
  const st = dayStatus(ctx.data, q.date, ctx.now);
  if (st === "invalid") return refuse("That isn't a real date.");
  const label = fmtDate(q.date, { dow: true, year: true });
  if (st === "past") return refuse(`${label} has passed.`);
  const plan = (summary: string, action: AgentAction, done: string): Plan => ({ ok: true, tool: "calendar", args: q, summary, actions: [action], said: `Done, ${label} is ${done}.` });
  if (q.action === "unblock") {
    if (st !== "blackout") return refuse(`${label} isn't blocked out.`);
    return plan(`unblock ${label}`, { type: "blackout", date: q.date, on: false }, "unblocked");
  }
  if (st === "booked" || st === "held") return refuse(`${label} has a customer booking.`);
  if (q.action === "block") {
    if (st === "blackout") return refuse(`${label} is already blocked out.`);
    return plan(`block out ${label}`, { type: "blackout", date: q.date, on: true }, "blocked out");
  }
  if (st === "blackout") return refuse(`${label} is blocked out.`);
  if (st === "personal") return refuse(`${label} is already booked for an owner's own use.`);
  return plan(`book ${label} for your own use. A paid booking on the same day still takes priority`, { type: "own_use", date: q.date, note: q.note?.trim() || `Own use (${ctx.owner.name})` }, "booked for your own use");
}

export const calendar = (ctx: OwnerCtx, q: Parameters<typeof planCalendar>[1]) => stage(ctx, planCalendar(ctx, q));

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

const noMatch = (who: Who) => refuse(typeof who === "string" ? `No conversation matches "${who}".` : "That conversation has gone.");

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

// Lists the matches and stages the list as a pick (no nonce: a pick changes nothing by itself). The owner's next
// text picks one by number or contact (resolvePick), which stages that tool's change for YES.
function askWhich(ctx: OwnerCtx, tool: string, args: Record<string, unknown>, matches: OwnerInboxItem[]) {
  const lines = matches.map((c, i) => `${i + 1}. ${c.name}, ${maskContact(c.contact)}`);
  const reason = `That matches ${matches.length} conversations:\n${lines.join("\n")}\nReply with the number or the end of the contact.`;
  if (ctx.staged) ctx.deferred = true;
  else ctx.staged = newApproval(ctx, { tool: PICK, args: { tool, ids: matches.map((c) => c.id), args }, summary: reason, binding: "", nonce: "", needsCode: false });
  return { ok: false as const, ambiguous: true, reason };
}

// "by SMS to 0433 210 877": how a reply to this conversation really goes out.
function route(c: OwnerInboxItem) {
  const r = replyRoute(c);
  return { via: r.via === "sms" ? "SMS" : "email", contact: r.to };
}

const sentText = (to: string, r: { via: string; contact: string }) =>
  `Sent to ${to} by ${r.via} to ${r.contact}. You have that chat now; text "hand back ${to.split(" ")[0]}" when you're done.`;

function planReply(ctx: OwnerCtx, who: Who, text: string): Plan | Refusal {
  ctx.used.push("inbox");
  const c = findConversation(ctx, who);
  if (!c) return noMatch(who);
  if ("ambiguous" in c) return askWhich(ctx, "reply_to_customer", { text }, c.ambiguous);
  const body = text.trim();
  if (!body) return refuse(`What should the reply to ${c.name} say?`);
  const r = route(c);
  return {
    ok: true,
    tool: "reply_to_customer",
    // Pinned by id: the YES sends to this conversation, not whichever one the name finds next time.
    args: { id: c.id, text: body },
    summary: `send ${c.name} this by ${r.via} to ${r.contact}: "${body}"`,
    actions: [{ type: "owner_reply", convId: c.id, body }],
    said: sentText(c.name, r),
  };
}

export const replyToCustomer = (ctx: OwnerCtx, who: Who, text: string) => stage(ctx, planReply(ctx, who, text));

const handBackText = (to: string, flagOnly: boolean, withoutReply: boolean) =>
  `${flagOnly ? `Cleared the flag on ${to}; the agent still has it.` : `Handed ${to} back to the agent.`}${withoutReply ? " Heads up: they were told an owner would reply, and nobody has." : ""}`;

function planHandBack(ctx: OwnerCtx, who: Who, force = false): Plan | Refusal {
  ctx.used.push("inbox");
  const c = findConversation(ctx, who);
  if (!c) return noMatch(who);
  if ("ambiguous" in c) return askWhich(ctx, "hand_back", { force }, c.ambiguous);
  if (c.agentActive && !c.escalated) return refuse(`The agent already has ${c.name}.`);
  // Dry run of the shared op, so the SMS refusal is the same guard the admin button and applyOwnerAction use.
  const dry = { owners: ctx.data.owners, conversations: [{ ...c, messages: [] }] } as unknown as Data;
  const r = opsHandBack(dry, c.id, ctx.owner.id, force);
  if (!r.ok) return refuse(`${r.reason} Reply first${c.draft ? ", send the agent's draft" : ""}, or text "hand back ${c.name.split(" ")[0]} anyway".`);
  // A flag-only hand-over never took the agent off, so this clears the flag rather than handing anything back.
  // The customer can still have been told an owner will reply, so the warning stands.
  const flagOnly = c.agentActive;
  const withoutReply = owesReply(c);
  return {
    ok: true,
    tool: "hand_back",
    args: { id: c.id, force },
    summary: `${flagOnly ? `clear the flag on ${c.name}, which the agent keeps` : `hand ${c.name} back to the agent`}${withoutReply ? ", although they were told an owner would reply and nobody has" : ""}`,
    actions: [{ type: "hand_back", convId: c.id, force: force || undefined }],
    said: handBackText(c.name, flagOnly, withoutReply),
  };
}

export const handBack = (ctx: OwnerCtx, who: Who, force = false) => stage(ctx, planHandBack(ctx, who, force));

// ---------- changes that also need the one-time code ----------

const MIN_DRAFT = 40;

// Sends a text the owner may not have read, so the summary quotes the draft in full.
function planSendDraft(ctx: OwnerCtx, who: Who): Plan | Refusal {
  ctx.used.push("send_draft");
  const c = findConversation(ctx, who);
  if (!c) return noMatch(who);
  if ("ambiguous" in c) return askWhich(ctx, "send_draft", {}, c.ambiguous);
  if (!c.draft) return refuse(`There's no draft reply for ${c.name}. Text "tell ${c.name.split(" ")[0]}: ..." to write one.`);
  // A greeting on its own ("Hi, one of the owners here.") would reach the customer as the whole reply.
  if (c.draft.trim().length < MIN_DRAFT) return refuse(`The agent only drafted a greeting. Text "tell ${c.name.split(" ")[0]}: ..." instead.`);
  const r = route(c);
  return {
    ok: true,
    tool: "send_draft",
    args: { id: c.id },
    summary: `send ${c.name} the agent's draft by ${r.via} to ${r.contact}: "${c.draft}"`,
    actions: [{ type: "send_draft", convId: c.id }],
    said: `Done. I sent ${c.name} the agent's draft. You have that chat now; text "hand back ${c.name.split(" ")[0]}" when you're done.`,
  };
}

export const sendDraft = (ctx: OwnerCtx, who: Who) => stage(ctx, planSendDraft(ctx, who));

// "add a $42 expense" -> "added a $42 expense"; the money, settings and knowledge summaries start with one of these.
function pastTense(summary: string) {
  return summary.replace(/^(add|approve|pay|cancel|change)\b/, (v) => ({ add: "added", approve: "approved", pay: "paid", cancel: "cancelled", change: "changed" })[v as "add"]);
}

const doneText = (summary: string) => `Done. I ${pastTense(summary)}.`;

export const EXPENSE_ACCOUNTS: Account[] = ["fuel", "co2", "cleaning", "maintenance", "breakage", "insurance", "rego", "software", "accounting", "marketing"];

function planExpense(ctx: OwnerCtx, q: { account: Account; amount: number; memo: string; date?: string }): Plan | Refusal {
  ctx.used.push("add_expense");
  if (!EXPENSE_ACCOUNTS.includes(q.account)) return refuse(`Expenses go to one of: ${EXPENSE_ACCOUNTS.join(", ")}.`);
  if (!(q.amount > 0)) return refuse("The amount needs to be more than $0.");
  const amount = Math.round(q.amount * 100) / 100;
  // Fails closed: a snapshot without a cap allows nothing.
  const cap = ctx.data.settings.smsExpenseCap ?? 0;
  if (amount > cap) return refuse(`${money(amount, amount % 1 !== 0)} is over the ${money(cap)} SMS limit for expenses. Add it in the admin, under Money.`);
  const date = isISODate(q.date) && q.date <= today(ctx) ? q.date : today(ctx);
  const summary = `add a ${money(amount, amount % 1 !== 0)} ${ACCOUNT_LABEL[q.account]} expense dated ${fmtDate(date)}: "${q.memo.trim() || q.account}"`;
  return {
    ok: true,
    tool: "add_expense",
    args: { ...q, amount, date },
    summary,
    actions: [{ type: "expense", date, account: q.account, amount, memo: `${q.memo.trim() || q.account} (${ctx.owner.name}, by SMS)` }],
    said: doneText(summary),
  };
}

export const addExpense = (ctx: OwnerCtx, q: Parameters<typeof planExpense>[1]) => stage(ctx, planExpense(ctx, q));

function openPayout(ctx: OwnerCtx): Distribution | undefined {
  return [...ctx.data.distributions].filter((x) => x.status === "awaiting").sort((a, b) => a.quarter.localeCompare(b.quarter))[0];
}

// The waiting payout is picked again on YES. If that is now another quarter (the first one got paid), its plan
// differs from the one confirmed, so YES asks again instead of paying it.
function planPayout(ctx: OwnerCtx, q: { action: "approve" | "pay" }): Plan | Refusal {
  ctx.used.push("payout");
  const dist = openPayout(ctx);
  if (!dist) return refuse("No payout is waiting.");
  const need = ctx.data.settings.approvalsRequired;
  const label = quarterLabel(dist.quarter);
  const total = payoutTotal(dist);
  const cash = (n: number) => money(n, n % 1 !== 0);
  if (!ctx.owner.isDirector) return refuse(`Only directors ${q.action} payouts.`);
  if (q.action === "approve") {
    const have = directorApprovals(ctx.data, dist).length;
    if (dist.approvals.includes(ctx.owner.id)) return refuse(`You've already approved ${label} (${have} of ${need}).`);
    const after = have + 1;
    const summary = `approve the ${label} payout of ${cash(total)} (${money(dist.distributable)} dividends plus ${cash(total - dist.distributable)} runner fees). That makes ${after} of ${need} approvals`;
    const ready = after >= need ? " It has enough approvals now. Text PAY THE PAYOUT to send it." : "";
    return { ok: true, tool: "payout", args: q, summary, actions: [{ type: "approve_payout", distId: dist.id }], said: `${doneText(summary)}${ready}` };
  }
  // The same check payDistribution makes as it pays, on the snapshot's free cash, so a refusal is said, not hidden.
  const why = payoutRefusal(dist, ctx.data, ctx.data.money.free);
  if (why) return refuse(why);
  if (total <= 0) return refuse(`${label} has nothing to pay.`);
  const summary = `pay the ${label} payout: ${cash(total)} by bank transfer to ${dist.lines.filter((l) => l.amount + l.runnerFees > 0).length} owners (simulated)`;
  return { ok: true, tool: "payout", args: q, summary, actions: [{ type: "pay_payout", distId: dist.id }], said: doneText(summary) };
}

export const payout = (ctx: OwnerCtx, q: Parameters<typeof planPayout>[1]) => stage(ctx, planPayout(ctx, q));

function planCancel(ctx: OwnerCtx, ref: string): Plan | Refusal {
  ctx.used.push("cancel_booking");
  const b = live(ctx).find((x) => x.ref.toUpperCase() === ref.toUpperCase());
  if (!b) return refuse(`No upcoming booking ${ref}.`);
  if (b.kind === "personal") return refuse(`${b.ref} is own use. Cancel it from the calendar.`);
  const pol = cancelPolicy(ctx.data.settings, b, ctx.now);
  const limit = ctx.data.settings.refundLimit;
  if (pol.refund > limit) return refuse(`That refund is ${money(pol.refund)}, over the ${money(limit)} SMS limit. Cancel ${b.ref} in the admin.`);
  const summary = `cancel ${b.ref} (${customerName(ctx, b.customerId)}, ${fmtDate(b.date, { dow: true })}, ${b.suburb}) with a ${money(pol.refund)} refund and ${money(pol.kept)} kept. The customer isn't texted, so let them know yourself`;
  return { ok: true, tool: "cancel_booking", args: { ref: b.ref }, summary, actions: [{ type: "cancel", bookingId: b.id, refund: pol.refund }], said: doneText(summary) };
}

export const cancelForCustomer = (ctx: OwnerCtx, ref: string) => stage(ctx, planCancel(ctx, ref));

export const SMS_SETTINGS = SETTING_GROUPS.flatMap((g) => g.fields).filter((f) => !ADMIN_ONLY_SETTINGS.includes(f.k));

function planSetting(ctx: OwnerCtx, q: { key: string; value: number }): Plan | Refusal {
  ctx.used.push("change_setting");
  const canSms = `By SMS I can change: ${SMS_SETTINGS.map((x) => x.label.toLowerCase()).join("; ")}.`;
  if (ADMIN_ONLY_SETTINGS.includes(q.key as keyof Settings)) return refuse(`That one can only be changed in the admin, under Settings. ${canSms}`);
  const f = SMS_SETTINGS.find((x) => x.k === q.key);
  if (!f) return refuse(canSms);
  const bad = settingProblem(f.k, q.value);
  if (bad) return refuse(`${f.label}: ${bad[0].toLowerCase()}${bad.slice(1)}`);
  const fmt = (v: number) => (f.unit === "$" ? money(v) : `${v}${f.unit ? ` ${f.unit}` : ""}`);
  const was = ctx.data.settings[f.k];
  if (was === q.value) return refuse(`${f.label} is already ${fmt(was)}.`);
  const summary = `change "${f.label}" from ${fmt(was)} to ${fmt(q.value)}. The site, checkout and agent use it from the next booking`;
  return { ok: true, tool: "change_setting", args: q, summary, actions: [{ type: "settings", patch: { [f.k]: q.value } }], said: doneText(summary) };
}

export const changeSetting = (ctx: OwnerCtx, q: Parameters<typeof planSetting>[1]) => stage(ctx, planSetting(ctx, q));

function planKnowledge(ctx: OwnerCtx, q: { page: string; line: string }): Plan | Refusal {
  ctx.used.push("add_knowledge");
  const w = q.page.toLowerCase();
  const p = ctx.data.kb.find((x) => x.slug === w) ?? ctx.data.kb.find((x) => x.title.toLowerCase().includes(w) || x.slug.includes(w));
  if (!p) return refuse(`Pages: ${ctx.data.kb.map((x) => x.slug).join(", ")}.`);
  const line = q.line.trim().replace(/^-\s*/, "");
  if (!line) return refuse("What should the line say?");
  const summary = `add to "${p.title}": "${line}". The agent tells customers this from the next message`;
  return { ok: true, tool: "add_knowledge", args: { page: p.slug, line }, summary, actions: [{ type: "kb_append", slug: p.slug, line }], said: doneText(summary) };
}

export const addKnowledge = (ctx: OwnerCtx, q: Parameters<typeof planKnowledge>[1]) => stage(ctx, planKnowledge(ctx, q));

// Each staged tool's plan, from the args it was staged with.
const PLANS: Record<StagedTool, (ctx: OwnerCtx, a: never) => Plan | Refusal> = {
  claim_run: planClaimRun,
  log_truck: planLogTruck,
  calendar: planCalendar,
  reply_to_customer: (ctx, a: { id: string; text: string }) => planReply(ctx, { id: a.id }, a.text),
  hand_back: (ctx, a: { id: string; force?: boolean }) => planHandBack(ctx, { id: a.id }, a.force === true),
  send_draft: (ctx, a: { id: string }) => planSendDraft(ctx, { id: a.id }),
  add_expense: planExpense,
  payout: planPayout,
  cancel_booking: (ctx, a: { ref: string }) => planCancel(ctx, a.ref),
  change_setting: planSetting,
  add_knowledge: planKnowledge,
};

// ---------- confirmation ----------

// A staged change planned again on this snapshot. `same` when it is still exactly the change the owner was asked to
// confirm: the same actions and summary, under this policy version. lib/server/agent.ts checks again as it applies.
export function replan(ctx: OwnerCtx, s: StagedApproval): { ok: true; same: boolean; plan: Plan } | Refusal {
  const run = Object.hasOwn(PLANS, s.tool) ? PLANS[s.tool as StagedTool] : undefined;
  if (!run) return refuse("I've lost track of that one. Send it again?");
  const plan = run(ctx, s.args as never);
  if (!plan.ok) return plan;
  return { ok: true, same: s.policyVersion === APPROVAL_POLICY && binding(plan) === s.binding, plan };
}

// The owner's answer to the staged change, before anything else reads the message. Both engines call this first,
// so they handle a YES the same way. Returns the reply, or undefined when the message is not an answer: then the
// staged change is cancelled and the message is handled as a new one.
// - A refusal cancels it. A YES quoting the wrong nonce ends it, so a spoofed caller ID gets one guess per stage.
// - A YES without the nonce, or without the one-time code a change needs, keeps it and asks for them. A wrong
//   one-time code applies nothing and keeps it too: expiry and the sender rate limit bound the guesses.
// - The right YES plans the change again. The same plan runs; a changed one asks again; a refused one says why.
export function resolvePending(ctx: OwnerCtx, text: string): string | undefined {
  const p = ctx.pending;
  if (!p) return undefined;
  const settle = (status: ApprovalStatus) => (ctx.settled = { id: p.id, status });
  const keep = (say: string) => {
    ctx.settled = undefined;
    return say;
  };
  settle("cancelled");
  if (p.tool === PICK) {
    if (p.expired) settle("expired");
    return p.expired ? undefined : resolvePick(ctx, p, text);
  }
  const a = parseApproval(text);
  const answers = a.answer === "yes" || a.bare;
  if (p.expired) {
    settle("expired");
    return answers ? `That one expired after ${APPROVAL_MINUTES} minutes, so nothing has changed. Send it again if you still want it.` : undefined;
  }
  if (a.answer === "no") return "No worries, I've left it.";
  if (!answers) return undefined;
  if (a.code !== undefined && !safeEqual(a.code, p.nonce)) return "That code doesn't match, so I've dropped it and nothing has changed. Send it again if you still want it.";
  const ask = `To go ahead, reply YES ${p.nonce}${p.needsCode ? " and the 6-digit code from your admin page." : ". The code shows it's really you."}`;
  if (a.code === undefined || a.answer !== "yes") return keep(ask);
  if (p.needsCode) {
    if (!a.oneTime) return keep(ask);
    if (!p.code || !safeEqual(a.oneTime, p.code)) return keep(`That isn't the code on your admin page, so nothing has changed. Reply YES ${p.nonce} and the code to try again.`);
  }
  const r = replan(ctx, p);
  if (!r.ok) {
    settle("invalidated");
    return `I didn't do it: ${r.reason}`;
  }
  if (!r.same) {
    settle("invalidated");
    stage(ctx, r.plan);
    return `That has changed since you asked, so nothing has happened yet. ${stagedText(ctx.staged!)}`;
  }
  settle("consumed");
  ctx.actions.push(...r.plan.actions);
  return r.plan.said;
}

// The owner's answer to an ambiguity list: "2", "#2", "818", "the email one", or the contact as listed. A pick
// stages that conversation's change for YES. Anything else is not a pick, so the list is dropped and the text is
// handled as a new message.
function resolvePick(ctx: OwnerCtx, p: StagedApproval, text: string): string | undefined {
  const { tool, ids, args } = p.args as { tool: string; ids: string[]; args: { text?: string; force?: boolean } };
  const matches = ids.map((id) => ctx.data.inbox.find((c) => c.id === id)).filter((c): c is OwnerInboxItem => !!c);
  const i = pickIndex(text, matches);
  if (i === undefined) return undefined;
  ctx.settled = { id: p.id, status: "consumed" };
  const who = { id: matches[i].id };
  const r =
    tool === "reply_to_customer" ? replyToCustomer(ctx, who, args.text ?? "")
    : tool === "hand_back" ? handBack(ctx, who, args.force === true)
    : tool === "send_draft" ? sendDraft(ctx, who)
    : refuse("I've lost track of that one. Send it again?");
  return r.ok ? stagedText(ctx.staged!) : r.reason;
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
