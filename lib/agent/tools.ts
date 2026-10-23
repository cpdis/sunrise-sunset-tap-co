// Agent tools. They run on the server against a snapshot (lib/views.ts) and return actions that lib/server/agent.ts
// applies after the turn: hold, cancel, escalate.
import { BUSINESS, SUBURBS, defaultStart, findSuburb, startProblem } from "../config";
import { cancelNeedsOwner, cancelPolicy, dayStatus, holdExpired, isBookable, nextFreeDates, quote } from "../domain";
import type { AgentAction, AgentState, Block, Booking, Channel, Data, KbPage, Settings, Slot } from "../types";
import { addDays, daysBetween, fmtDate, fmtTime, isISODate, money, randomToken, safeEqual, sameContact, todayISO, uid } from "../util";
import { newCode, parseCoded } from "./confirm";

// Availability for every date (slots), and only the sender's own customer records and bookings (mine).
export type Snapshot = Pick<Data, "settings" | "customers" | "kb" | "blackouts" | "seq"> & { bookings: Slot[]; mine: Booking[] };

// The customer's own checkout page. The token opens it; the id alone does not.
export const checkoutLink = (origin: string, b: { id: string; token?: string }) => `${origin}/checkout/${b.id}?t=${b.token ?? ""}`;

export interface ToolCtx {
  data: Snapshot;
  contact: string;
  channel: Exclude<Channel, "admin">;
  customerName?: string;
  now: Date;
  actions: AgentAction[];
  used: string[];
  origin: string;
  // An owner has been asked to take this conversation; don't book or cancel.
  handover?: boolean;
  // The cancel this turn may make: the booking quoted last turn and the refund quoted, answered with YES and the
  // quote's code (cancelReply). cancel_booking with confirmed=true only quotes for anything else.
  confirmCancel?: { id: string; refund: number };
  // The cancel cancel_booking quoted this turn. The engine saves it in the state so the next message can confirm it.
  quotedCancel?: { id: string; code: string; refund: number };
}

// Extra ways to say yes to "Reply YES 4821 to cancel".
export const CANCEL_YES = ["cancel", "cancel it"];

// What a reply to last turn's cancel quote does, the same in both engines (R1, R2, KTD11):
// - yes: YES with the quote's code. ctx.confirmCancel now lets cancel_booking cancel on the quoted terms.
// - no: a refusal. The quote ends.
// - ask: a fixed reply. A YES without the code, or the code alone, keeps the quote and asks for both. A YES with
//   a wrong code ends the quote, so a guess never gets a second try at the same code.
// - none: no quote is pending, or the message is about something else. The quote ends.
export type CancelReply = { kind: "yes" | "no" | "none" } | { kind: "ask"; say: string; keep: boolean };

export function cancelReply(ctx: ToolCtx, prev: AgentState, text: string): CancelReply {
  const { bookingId, code, refund } = prev;
  if (ctx.handover || prev.awaiting !== "confirm_cancel" || !bookingId || !code || refund === undefined) return { kind: "none" };
  const r = parseCoded(text, CANCEL_YES);
  if (r.answer === "no") return { kind: "no" };
  const right = r.code !== undefined && safeEqual(r.code, code);
  const ref = ctx.data.mine.find((b) => b.id === bookingId)?.ref ?? "your booking";
  if (r.answer === "yes" && right) {
    ctx.confirmCancel = { id: bookingId, refund };
    return { kind: "yes" };
  }
  if (r.answer === "yes" && r.code !== undefined) return { kind: "ask", keep: false, say: `That code doesn't match, so nothing has changed on ${ref}. Text "cancel ${ref}" to start again.` };
  if (r.answer === "yes" || (right && r.bare)) return { kind: "ask", keep: true, say: `To go ahead with ${ref}, reply YES ${code}. The code shows it's really you.` };
  return { kind: "none" };
}

export function fillKb(body: string, s: Settings): string {
  const vals: Record<string, string> = {
    price4: money(s.price4),
    price8: money(s.price8),
    deposit: money(s.deposit),
    bond: money(s.bond),
    travelFee: money(s.travelFee),
    travelThresholdMin: String(s.travelThresholdMin),
    balanceDaysBefore: String(s.balanceDaysBefore),
    bondHoldDaysBefore: String(s.bondHoldDaysBefore),
    cancelDays: String(s.cancelDays),
    holdMinutes: String(s.holdMinutes),
    bookAheadMonths: String(s.bookAheadMonths),
    sms: BUSINESS.sms,
    email: BUSINESS.email,
  };
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k] ?? `{{${k}}}`);
}

export function renderKb(kb: KbPage[], s: Settings): string {
  return kb.map((p) => `## ${p.title} (${p.slug})\n${fillKb(p.body, s)}`).join("\n\n");
}

// The lines of one knowledge-base page that match, as the owners last wrote them, with settings filled in. The
// fallback agent answers from these, so an owner's edit to a page changes its answers too.
export function kbLines(ctx: ToolCtx, slug: string, match: RegExp, max = 3): string[] {
  const p = ctx.data.kb.find((x) => x.slug === slug);
  if (!p) return [];
  const lines = fillKb(p.body, ctx.data.settings)
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l && match.test(l))
    .slice(0, max);
  if (lines.length) ctx.used.push(`kb:${slug}`);
  return lines;
}

export function customerBookings(ctx: ToolCtx) {
  const c = ctx.data.customers.find((x) => sameContact(x.phone, ctx.contact) || sameContact(x.email, ctx.contact));
  if (!c) return [];
  return ctx.data.mine
    .filter((b) => b.customerId === c.id && b.state !== "cancelled" && b.date >= todayISO(ctx.now))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// One of the sender's upcoming bookings by its SST- reference. Someone else's reference finds nothing, exactly
// like one that doesn't exist, so a stranger can't learn which references are real (review C18).
export function myBookingByRef(ctx: ToolCtx, ref: string) {
  return customerBookings(ctx).find((x) => x.ref.toUpperCase() === ref.toUpperCase());
}

export function checkAvailability(ctx: ToolCtx, date: string) {
  ctx.used.push("check_availability");
  if (!isISODate(date)) return { date, label: date, free: false, status: "invalid" as const, alternatives: [] as string[], reason: "That isn't a real date. Send it as YYYY-MM-DD." };
  const status = dayStatus(ctx.data, date, ctx.now);
  const free = isBookable(ctx.data, date, ctx.now);
  const alternatives = free ? [] : nextFreeDates(ctx.data, date < todayISO(ctx.now) ? todayISO(ctx.now) : addDays(date, -1), 3, true, ctx.now);
  return { date, label: fmtDate(date, { dow: true, year: true }), free, status, alternatives };
}

export function getQuote(ctx: ToolCtx, block: Block, suburb: string) {
  ctx.used.push("quote");
  const sub = findSuburb(suburb) ?? SUBURBS.find((s) => suburb.toLowerCase().includes(s.name.toLowerCase()));
  if (!sub) return { inArea: false as const, suburb };
  return { ...quote(ctx.data.settings, block, sub.name), suburb: sub.name };
}

export function holdAndLink(ctx: ToolCtx, date: string, block: Block, suburb: string, name: string, startTime?: string) {
  if (ctx.handover) return { ok: false as const, reason: "an owner is handling this conversation." };
  // One contact holds one unpaid date at a time (R13). A second request gets the first hold's link back.
  const held = customerBookings(ctx).find((b) => b.state === "held" && !holdExpired(b, ctx.now));
  const pushed = ctx.actions.find((a) => a.type === "hold");
  const first = held ? { id: held.id, ref: held.ref, date: held.date, token: held.token } : pushed?.type === "hold" ? { id: pushed.bookingId, ref: pushed.ref, date: pushed.date, token: pushed.token } : undefined;
  if (first) {
    return {
      ok: false as const,
      reason: `You already have ${first.ref} held for ${fmtDate(first.date, { dow: true })}, and I can hold one date at a time until its deposit is paid.`,
      heldRef: first.ref,
      link: checkoutLink(ctx.origin, first),
    };
  }
  if (!isISODate(date)) return { ok: false as const, reason: "That isn't a real date." };
  if (block !== 4 && block !== 8) return { ok: false as const, reason: "The truck goes out for 4 or 8 hours." };
  if (!isBookable(ctx.data, date, ctx.now)) return { ok: false as const, reason: "That date is no longer free." };
  // A missing time gets the default; a given one must be a real HH:MM that finishes by closing.
  const start = startTime || defaultStart(block);
  const late = startProblem(block, start);
  if (late) return { ok: false as const, reason: `${late[0].toUpperCase()}${late.slice(1)}.` };
  const q = getQuote(ctx, block, suburb);
  if (!q.inArea) return { ok: false as const, reason: "That suburb is outside the service area." };
  const bookingId = uid("bk");
  const token = randomToken();
  const ref = `SST-${ctx.data.seq + 1 + ctx.actions.filter((a) => a.type === "hold").length}`;
  ctx.actions.push({ type: "hold", bookingId, ref, date, block, startTime: start, suburb: q.suburb, name, token });
  ctx.used.push("hold_and_send_deposit_link");
  return {
    ok: true as const,
    ref,
    link: checkoutLink(ctx.origin, { id: bookingId, token }),
    deposit: q.deposit,
    total: q.total,
    // Inside the balance window the checkout takes the full amount.
    dueNow: daysBetween(todayISO(ctx.now), date) <= ctx.data.settings.balanceDaysBefore ? q.total : q.deposit,
    holdMinutes: ctx.data.settings.holdMinutes,
  };
}

export function lookupBooking(ctx: ToolCtx) {
  ctx.used.push("lookup_booking");
  return customerBookings(ctx).map((b) => ({
    id: b.id,
    ref: b.ref,
    date: fmtDate(b.date, { dow: true, year: true }),
    block: `${b.block} hours from ${fmtTime(b.startTime)}`,
    suburb: b.suburb,
    state: b.state,
    total: b.total,
    balanceDue: b.state === "confirmed" ? b.total - b.deposit : 0,
  }));
}

// Quotes a cancel, or makes it. It cancels only the booking quoted last turn, on the terms quoted, confirmed now with
// YES and the quote's code (ToolCtx.confirmCancel), so neither engine can cancel on a model's say-so, on a refusal or
// on a blind yes from a spoofed number. Anything else quotes again with a new code.
export function cancelBookingTool(ctx: ToolCtx, bookingId: string, confirmed: boolean) {
  if (ctx.handover) return { ok: false as const, reason: "An owner is handling this conversation." };
  const b = customerBookings(ctx).find((x) => x.id === bookingId || x.ref.toUpperCase() === bookingId.toUpperCase());
  if (!b) return { ok: false as const, reason: "No upcoming booking found for this sender." };
  const pol = cancelPolicy(ctx.data.settings, b, ctx.now);
  const needsOwner = cancelNeedsOwner(ctx.data.settings, b, ctx.now);
  const terms = { ref: b.ref, date: b.date, held: b.state === "held", refund: pol.refund, kept: pol.kept, daysOut: pol.days, fullRefund: pol.fullRefund, needsOwner: !!needsOwner };
  const ok = ctx.confirmCancel;
  // A balance paid since the quote changes the refund, so the customer confirms the new terms first.
  const changed = confirmed && ok?.id === b.id && ok.refund !== pol.refund;
  if (!confirmed || ok?.id !== b.id || changed) {
    ctx.used.push("cancel_quote");
    const code = newCode();
    ctx.quotedCancel = { id: b.id, code, refund: pol.refund };
    const note = changed ? "Not cancelled: the terms changed since the last quote. Tell the customer the new terms and the new code." : confirmed ? "Not cancelled. Tell the customer these terms and ask them to reply YES and the code." : undefined;
    return { ok: true as const, done: false, ...terms, code, changed, ...(note && { note }) };
  }
  ctx.quotedCancel = undefined;
  ctx.confirmCancel = undefined;
  if (needsOwner) {
    escalate(ctx, needsOwner);
    return { ok: false as const, done: false, ...terms, reason: "Sent to the owners to approve the refund. Nothing is cancelled yet." };
  }
  ctx.used.push("cancel_booking");
  ctx.actions.push({ type: "cancel", bookingId: b.id, refund: pol.refund });
  return { ok: true as const, done: true, ...terms };
}

// A cancel_booking answer that quotes terms (and the code a YES must echo) rather than cancelling.
export type CancelQuote = Extract<ReturnType<typeof cancelBookingTool>, { code: string }>;

// Flags the conversation in the owners' inbox. Nobody is texted or called, so replies promise no time or call (R4).
// draft: a reply the owner can send as-is. Written to the customer, no owner name, no prices the KB doesn't carry.
export function escalate(ctx: ToolCtx, reason: string, keepAgent = false, draft?: string) {
  ctx.used.push("escalate_to_owner");
  ctx.actions.push({ type: "escalate", reason, keepAgent, draft: draft?.trim() || undefined });
  return { ok: true };
}
