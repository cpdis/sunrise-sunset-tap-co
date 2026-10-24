// Owner operations on a mutable draft of Data. The admin buttons and the owner SMS agent both call these,
// so an action means the same thing whichever way an owner takes it.
import { ADMIN_ONLY_SETTINGS, settingProblem } from "./config";
import { ACCOUNT_LABEL, cancelBooking, cancelNeedsOwner, pay, payDistribution, post } from "./domain";
import type { Account, AgentAction, Conversation, Data, KbPage, Settings, TruckLog } from "./types";
import { money, todayISO, uid } from "./util";

export function log(d: Data, text: string) {
  d.jobs.unshift({ at: new Date().toISOString(), text });
  d.jobs = d.jobs.slice(0, 60);
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
export function payOut(d: Data, distId: string, ownerId: string) {
  const q = distId.replace("dist_", "");
  if (!d.owners.find((o) => o.id === ownerId)?.isDirector) return log(d, `Payout ${q} not paid: ${ownerName(d, ownerId)} isn't a director`);
  try {
    payDistribution(d, distId);
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
  c.messages.push({ id: uid("m"), from: "owner", body, at: new Date().toISOString(), ownerId, ...replyRoute(c) });
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
