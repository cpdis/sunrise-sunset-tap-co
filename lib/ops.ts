// Owner operations on a mutable draft of Data. The admin buttons and the owner SMS agent both call these,
// so an action means the same thing whichever way an owner takes it.
import { ADMIN_ONLY_SETTINGS, settingProblem } from "./config";
import { ACCOUNT_LABEL, cancelBooking, cancelNeedsOwner, ensureDistributions, pay, payDistribution, post, runJobs } from "./domain";
import type { Account, AgentAction, Conversation, Data, DirectorRequest, KbPage, Outgoing, Settings, TruckLog } from "./types";
import { money, todayISO, uid } from "./util";

export function log(d: Data, text: string) {
  d.jobs.unshift({ at: new Date().toISOString(), text });
  d.jobs = d.jobs.slice(0, 60);
}

// Queues a message this change sends. The repo writes it to the outbox only if the change is saved, in the same
// transaction, so a change saved once sends once and a change refused or retried sends nothing extra.
export function send(d: Data, m: Outgoing) {
  (d.outgoing ??= []).push(m);
}

// The scheduled jobs: expired holds, balances, bonds, closing finished hires, depreciation, then the latest
// quarter's payout record. The jobs route runs this for each business (app/api/jobs). Each job checks its own state
// first (a balance charges only while unpaid, a quarter's record is made once), so a second run the same day
// changes nothing.
export function runScheduled(d: Data, now = new Date()) {
  const ran = runJobs(d, now);
  ran.forEach((t) => log(d, t));
  ensureDistributions(d, now);
  return ran;
}

const ownerName = (d: Data, id: string) => d.owners.find((o) => o.id === id)?.name ?? "An owner";

export function claimRun(d: Data, bookingId: string, which: "deliver" | "collect", ownerId: string) {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b) return;
  b[which].ownerId = ownerId;
  log(d, `${ownerName(d, ownerId)} claimed the ${which} run for ${b.ref}`);
}

export function addTruckLog(d: Data, l: Omit<TruckLog, "id">) {
  d.truck.push({ ...l, id: uid("tl") });
}

export function addExpense(d: Data, date: string, account: Account, amount: number, memo: string) {
  post(d, date, account, -Math.abs(amount), memo);
}

// Only directors approve, once each.
export function approveDistribution(d: Data, distId: string, ownerId: string) {
  const dist = d.distributions.find((x) => x.id === distId);
  const director = d.owners.find((o) => o.id === ownerId)?.isDirector;
  if (dist && director && dist.status === "awaiting" && !dist.approvals.includes(ownerId)) dist.approvals.push(ownerId);
}

// Only directors pay. payDistribution refuses too few director approvals or too little free cash; the reason is logged.
export function payOut(d: Data, distId: string, ownerId: string, now = new Date()) {
  const q = distId.replace("dist_", "");
  if (!d.owners.find((o) => o.id === ownerId)?.isDirector) return log(d, `Payout ${q} not paid: ${ownerName(d, ownerId)} isn't a director`);
  try {
    payDistribution(d, distId, now);
    log(d, `Paid ${q} dividends via bank API (simulated)`);
  } catch (e) {
    log(d, `Payout ${q} not paid: ${(e as Error).message}`);
  }
}

// An owner checked the truck back after the hire and found it clean. Nothing else releases a held bond.
export function returnedClean(d: Data, bookingId: string, ownerId: string, now = new Date()) {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b || b.bondStatus !== "held" || b.date > todayISO(now)) return;
  pay(d, b, "bond_release", b.bond, now.toISOString());
  b.bondStatus = "released";
  log(d, `${ownerName(d, ownerId)} checked ${b.ref} back clean; released the ${money(b.bond)} bond`);
}

// ---------- changes that wait for a second director (B5) ----------

type Change = DirectorRequest["change"];

// What a requested change would do, in the words the admin and the activity log use.
export function describeChange(d: Pick<Data, "owners" | "settings">, c: Change) {
  const name = (id: string) => d.owners.find((o) => o.id === id)?.name ?? "an owner";
  return c.type === "approvals"
    ? `lower the director approvals a payout needs from ${d.settings.approvalsRequired} to ${c.to}`
    : `move ${c.shares} share${c.shares === 1 ? "" : "s"} from ${name(c.fromId)} to ${name(c.toId)}`;
}

// Why a change can't happen on the data as it is, or undefined when it can.
function changeProblem(d: Data, c: Change): string | undefined {
  if (c.type === "approvals") return settingProblem("approvalsRequired", c.to) && "That isn't a number of approvals the business can use.";
  const from = d.owners.find((o) => o.id === c.fromId);
  const to = d.owners.find((o) => o.id === c.toId);
  if (!from || !to || from === to) return "A transfer needs two different owners.";
  if (!Number.isInteger(c.shares) || from.shares < c.shares) return `${from.name} holds ${from.shares} share${from.shares === 1 ? "" : "s"}.`;
}

// One director asks for a change that a second, different director must approve (the payout approvals pattern): it
// waits on the document until then. Throws a refusal for a change that couldn't happen. A new request for the
// approvals replaces an older one. Returns the request's id.
export function requestChange(d: Data, c: Change, by: string, now = new Date()) {
  const why = changeProblem(d, c);
  if (why) throw new Error(why);
  const r: DirectorRequest = { id: uid("req"), change: c, by, at: now.toISOString() };
  d.requests = [...(d.requests ?? []).filter((x) => !(c.type === "approvals" && x.change.type === "approvals")), r];
  log(d, `${ownerName(d, by)} asked to ${describeChange(d, c)}; it waits for a second director`);
  return r.id;
}

// A second director approves a request, and the change happens, checked again on the data as it is now. The
// commands route makes sure the approver is a director and not the one who asked. Throws a refusal when the change
// can no longer happen (the shares moved since, or the one who asked is no longer a director); the request then
// stays for a director to decline.
export function approveRequest(d: Data, id: string, by: string) {
  const r = d.requests?.find((x) => x.id === id);
  if (!r) return;
  if (!d.owners.find((o) => o.id === r.by)?.isDirector) throw new Error(`${ownerName(d, r.by)} isn't a director now, so this needs asking again.`);
  const why = changeProblem(d, r.change);
  if (why) throw new Error(why);
  const what = describeChange(d, r.change);
  const c = r.change;
  if (c.type === "approvals") d.settings = { ...d.settings, approvalsRequired: c.to };
  else {
    d.owners.find((o) => o.id === c.fromId)!.shares -= c.shares;
    d.owners.find((o) => o.id === c.toId)!.shares += c.shares;
  }
  d.requests = d.requests!.filter((x) => x.id !== id);
  log(d, `${ownerName(d, by)} approved ${ownerName(d, r.by)}'s request to ${what}`);
}

// Any director declines a request, or the one who asked withdraws it. Nothing changes.
export function declineRequest(d: Data, id: string, by: string) {
  const r = d.requests?.find((x) => x.id === id);
  if (!r) return;
  d.requests = d.requests!.filter((x) => x.id !== id);
  log(d, `${ownerName(d, by)} declined ${by === r.by ? "their own" : `${ownerName(d, r.by)}'s`} request to ${describeChange(d, r.change)}`);
}

// Applies only the keys in range (SETTING_RANGES) and returns the ones it dropped, so no surface stores a bad value.
export function updateSettings(d: Data, s: Partial<Settings>): (keyof Settings)[] {
  const ok: Partial<Settings> = {};
  const dropped: (keyof Settings)[] = [];
  for (const [k, v] of Object.entries(s) as [keyof Settings, number][]) {
    if (settingProblem(k, v)) dropped.push(k);
    else ok[k] = v;
  }
  d.settings = { ...d.settings, ...ok };
  return dropped;
}

export function saveKb(d: Data, page: KbPage) {
  const i = d.kb.findIndex((p) => p.slug === page.slug);
  if (i >= 0) d.kb[i] = page;
  else d.kb.push(page);
}

export function toggleBlackout(d: Data, date: string) {
  d.blackouts = d.blackouts.includes(date) ? d.blackouts.filter((x) => x !== date) : [...d.blackouts, date];
}

export function addPersonalUse(d: Data, date: string, note: string, ownerId: string) {
  d.bookings.push({
    id: uid("bk"),
    ref: `OWN-${date.slice(5).replace("-", "")}`,
    kind: "personal",
    ownerId,
    date,
    block: 8,
    startTime: "06:00",
    suburb: "Mount Lawley",
    travelMinutes: 8,
    km: 4,
    price: 0,
    travelFee: 0,
    total: 0,
    deposit: 0,
    bond: 0,
    state: "confirmed",
    bondStatus: "none",
    createdAt: new Date().toISOString(),
    createdVia: "admin",
    eventType: "Owner use",
    notes: note,
    agreementSigned: true,
    deliver: { ownerId, done: false },
    collect: { ownerId, done: false },
  });
}

// Where an owner's reply actually goes. A caller gets an SMS to the number they rang from; a web form gets an
// email to the address on the form. There is no reply "by phone" or "by web form".
export function replyRoute(c: Pick<Conversation, "contact">): { via: "sms" | "email"; to: string } {
  return { via: c.contact.includes("@") ? "email" : "sms", to: c.contact };
}

// A hand-over tells the customer an owner will reply. Until one does (ownerReply clears it), handing the
// conversation back would leave that promise unkept.
export function owesReply(c: Pick<Conversation, "escalated">) {
  return !!c.escalated;
}

export function setAgentActive(d: Data, convId: string, active: boolean, ownerId?: string) {
  const c = d.conversations.find((x) => x.id === convId);
  if (!c) return;
  const who = ownerId ? ownerName(d, ownerId) : "An owner";
  // A flag-only hand-over (short notice, unknown suburb) never took the agent off; clearing it is not a hand-back.
  const flagOnly = active && c.agentActive;
  c.agentActive = active;
  c.handledBy = active ? undefined : ownerId;
  if (active) c.escalated = undefined;
  c.messages.push({
    id: uid("m"),
    from: "system",
    body: active ? (flagOnly ? `${who} cleared the flag` : `${who} handed back to the agent`) : `${who} took over this conversation`,
    at: new Date().toISOString(),
    ownerId,
  });
}

// An owner's edit to the agent's draft, kept on the conversation so another owner (or the SMS "send the draft") sends the edited text.
export function setDraft(d: Data, convId: string, draft: string) {
  const c = d.conversations.find((x) => x.id === convId);
  if (c) c.draft = draft.trim() || undefined;
}

// Hands a conversation back to the agent. Refused while the customer is owed an owner reply unless forced;
// the admin button and the owner SMS agent both go through here so the guard lives in one place.
export function handBack(d: Data, convId: string, ownerId?: string, force = false): { ok: true } | { ok: false; reason: string } {
  const c = d.conversations.find((x) => x.id === convId);
  if (!c) return { ok: false, reason: "No such conversation." };
  if (owesReply(c) && !force) return { ok: false, reason: `${c.name} was told an owner will reply, and nobody has.` };
  setAgentActive(d, convId, true, ownerId);
  return { ok: true };
}

// An owner reply takes the conversation off the agent until someone hands it back.
export function ownerReply(d: Data, convId: string, body: string, ownerId: string) {
  const c = d.conversations.find((x) => x.id === convId);
  if (!c) return;
  if (c.agentActive) setAgentActive(d, convId, false, ownerId);
  c.handledBy = ownerId;
  const route = replyRoute(c);
  c.messages.push({ id: uid("m"), from: "owner", body, at: new Date().toISOString(), ownerId, ...route });
  // The simulated send: the reply goes to the outbox as the SMS or email it would be.
  if (route.to) send(d, { kind: "reply", channel: route.via, to: route.to, body });
  c.unread = false;
  c.escalated = undefined;
  c.draft = undefined;
}

// A customer cancelling from their booking page, under the same refund limit as SMS. Over the limit nothing is
// cancelled: the owners get a flagged conversation for this customer, the same hand-over an SMS cancel makes.
export function customerCancel(d: Data, bookingId: string, now = new Date()): { refund: number } | { needsOwner: string } | null {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b) return null;
  const reason = cancelNeedsOwner(d.settings, b, now);
  if (!reason) {
    const pol = cancelBooking(d, bookingId, now);
    if (pol) log(d, `${b.ref} cancelled on the booking page; refunded $${pol.refund}`);
    return pol && { refund: pol.refund };
  }
  const cust = d.customers.find((x) => x.id === b.customerId);
  let c = d.conversations.find((x) => x.customerId === b.customerId && !x.ownerId);
  if (!c) {
    c = { id: uid("conv"), channel: "web", contact: cust?.phone || cust?.email || "", name: cust?.name ?? b.ref, customerId: b.customerId, agentActive: true, unread: true, state: {}, messages: [] };
    d.conversations.unshift(c);
  }
  if (c.escalated !== reason) {
    c.messages.push({ id: uid("m"), from: "system", body: `Asked to cancel on the booking page. ${reason}`, at: now.toISOString() });
    log(d, `Escalated to owners: ${reason}`);
    send(d, { kind: "escalation", convId: c.id, reason });
  }
  c.escalated = reason;
  c.agentActive = false;
  c.unread = true;
  return { needsOwner: reason };
}

// Applies what the owner agent decided, as the owner who texted. Each op re-checks its own rules.
export function applyOwnerAction(d: Data, a: AgentAction, ownerId: string) {
  const who = ownerName(d, ownerId);
  switch (a.type) {
    case "claim_run":
      for (const w of a.which) claimRun(d, a.bookingId, w, ownerId);
      break;
    case "truck_log":
      addTruckLog(d, a.log);
      log(d, `${who} logged ${a.log.type} by SMS${a.log.odometer ? ` at ${a.log.odometer.toLocaleString()} km` : ""}`);
      break;
    case "expense":
      // The owner tool refuses these too; this keeps the cap whatever produced the action.
      if (a.amount > (d.settings.smsExpenseCap ?? 0)) break;
      addExpense(d, a.date, a.account, a.amount, a.memo);
      log(d, `${who} added a $${a.amount} ${ACCOUNT_LABEL[a.account]} expense by SMS`);
      break;
    case "approve_payout":
      approveDistribution(d, a.distId, ownerId);
      log(d, `${who} approved the ${a.distId.replace("dist_", "")} payout by SMS`);
      break;
    case "pay_payout":
      payOut(d, a.distId, ownerId);
      break;
    case "settings": {
      // Admin-only settings never change by SMS (R7), whatever produced the action.
      const patch = Object.fromEntries(Object.entries(a.patch).filter(([k]) => !ADMIN_ONLY_SETTINGS.includes(k as keyof Settings)));
      const dropped = updateSettings(d, patch);
      const changed = Object.keys(patch).filter((k) => !dropped.includes(k as keyof Settings));
      if (changed.length) log(d, `${who} changed ${changed.join(", ")} by SMS`);
      break;
    }
    case "kb_append": {
      const p = d.kb.find((x) => x.slug === a.slug);
      if (p) saveKb(d, { ...p, body: `${p.body.trimEnd()}\n- ${a.line}` });
      log(d, `${who} added a line to the "${p?.title ?? a.slug}" knowledge page by SMS`);
      break;
    }
    case "blackout":
      if (d.blackouts.includes(a.date) !== a.on) toggleBlackout(d, a.date);
      break;
    case "own_use":
      addPersonalUse(d, a.date, a.note, ownerId);
      log(d, `${who} booked ${a.date} for own use by SMS`);
      break;
    case "owner_reply":
      ownerReply(d, a.convId, a.body, ownerId);
      break;
    case "send_draft": {
      const c = d.conversations.find((x) => x.id === a.convId);
      if (c?.draft) ownerReply(d, a.convId, c.draft, ownerId);
      break;
    }
    case "hand_back":
      handBack(d, a.convId, ownerId, a.force);
      break;
  }
}
