// Agent tools. They run on the server against a snapshot of the client's data and
// return actions that the client store applies (hold, cancel, escalate).
import { BUSINESS, SUBURBS, defaultStart, findSuburb, startProblem } from "../config";
import { cancelNeedsOwner, cancelPolicy, dayStatus, holdExpired, isBookable, nextFreeDates, quote } from "../domain";
import type { AgentAction, AgentState, Block, Channel, Data, KbPage, Settings } from "../types";
import { addDays, daysBetween, fmtDate, fmtTime, isISODate, money, sameContact, todayISO, uid } from "../util";
import { parseConfirm } from "./confirm";

export type Snapshot = Pick<Data, "settings" | "bookings" | "customers" | "kb" | "blackouts" | "seq">;

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
  // The booking this turn may cancel: the one quoted last turn, answered with a clear yes (cancelAnswer). Both
  // engines set it, and cancel_booking with confirmed=true only quotes for any other booking.
  confirmCancel?: string;
  // The booking cancel_booking quoted this turn. The engine saves it in the state so the next message can confirm it.
  quotedCancel?: string;
}

// Extra ways to say yes to "Reply YES to cancel".
export const CANCEL_YES = ["cancel", "cancel it"];

// The booking a customer may cancel with this message: the one quoted last turn, and only on a clear yes.
// Anything else ends the pending cancel (R1, R2), whichever engine answers.
export function cancelAnswer(prev: AgentState, text: string): string | undefined {
  return prev.awaiting === "confirm_cancel" && parseConfirm(text, CANCEL_YES) === "yes" ? prev.bookingId : undefined;
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
  return ctx.data.bookings
    .filter((b) => b.customerId === c.id && b.state !== "cancelled" && b.date >= todayISO(ctx.now))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// One of the sender's upcoming bookings by its SST- reference. Someone else's reference finds nothing, exactly
// like one that doesn't exist, so a stranger can't learn which references are real (review C18).
export function myBookingByRef(ctx: ToolCtx, ref: string) {
  return customerBookings(ctx).find((x) => x.ref.toUpperCase() === ref.toUpperCase());
}

const d = (ctx: ToolCtx) => ctx.data as unknown as Data;

export function checkAvailability(ctx: ToolCtx, date: string) {
  ctx.used.push("check_availability");
  if (!isISODate(date)) return { date, label: date, free: false, status: "invalid" as const, alternatives: [] as string[], reason: "That isn't a real date. Send it as YYYY-MM-DD." };
  const status = dayStatus(d(ctx), date, ctx.now);
  const free = isBookable(d(ctx), date, ctx.now);
  const alternatives = free ? [] : nextFreeDates(d(ctx), date < todayISO(ctx.now) ? todayISO(ctx.now) : addDays(date, -1), 3, true, ctx.now);
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
  const first = held ? { id: held.id, ref: held.ref, date: held.date } : pushed?.type === "hold" ? { id: pushed.bookingId, ref: pushed.ref, date: pushed.date } : undefined;
  if (first) {
    return {
      ok: false as const,
      reason: `You already have ${first.ref} held for ${fmtDate(first.date, { dow: true })}, and I can hold one date at a time until its deposit is paid.`,
      heldRef: first.ref,
      link: `${ctx.origin}/checkout/${first.id}`,
    };
  }
  if (!isISODate(date)) return { ok: false as const, reason: "That isn't a real date." };
  if (block !== 4 && block !== 8) return { ok: false as const, reason: "The truck goes out for 4 or 8 hours." };
  if (!isBookable(d(ctx), date, ctx.now)) return { ok: false as const, reason: "That date is no longer free." };
  // A missing time gets the default; a given one must be a real HH:MM that finishes by closing.
  const start = startTime || defaultStart(block);
  const late = startProblem(block, start);
  if (late) return { ok: false as const, reason: `${late[0].toUpperCase()}${late.slice(1)}.` };
  const q = getQuote(ctx, block, suburb);
  if (!q.inArea) return { ok: false as const, reason: "That suburb is outside the service area." };
  const bookingId = uid("bk");
  const ref = `SST-${ctx.data.seq + 1 + ctx.actions.filter((a) => a.type === "hold").length}`;
  ctx.actions.push({ type: "hold", bookingId, ref, date, block, startTime: start, suburb: q.suburb, name, contact: ctx.contact, channel: ctx.channel });
  ctx.used.push("hold_and_send_deposit_link");
  return {
    ok: true as const,
    ref,
    link: `${ctx.origin}/checkout/${bookingId}`,
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

// Quotes a cancel, or makes it. It cancels only the booking quoted last turn and confirmed with a clear yes now
// (ToolCtx.confirmCancel), so neither engine can cancel on a model's say-so or on a refusal. Anything else quotes.
export function cancelBookingTool(ctx: ToolCtx, bookingId: string, confirmed: boolean) {
  if (ctx.handover) return { ok: false as const, reason: "An owner is handling this conversation." };
  const b = customerBookings(ctx).find((x) => x.id === bookingId || x.ref.toUpperCase() === bookingId.toUpperCase());
  if (!b) return { ok: false as const, reason: "No upcoming booking found for this sender." };
  const pol = cancelPolicy(ctx.data.settings, b, ctx.now);
  const needsOwner = cancelNeedsOwner(ctx.data.settings, b, ctx.now);
  const terms = { ref: b.ref, held: b.state === "held", refund: pol.refund, kept: pol.kept, daysOut: pol.days, fullRefund: pol.fullRefund, needsOwner: !!needsOwner };
  if (!confirmed || ctx.confirmCancel !== b.id) {
    ctx.used.push("cancel_quote");
    ctx.quotedCancel = b.id;
    return { ok: true as const, done: false, ...terms, ...(confirmed && { note: "Not cancelled. Tell the customer these terms and ask them to reply YES." }) };
  }
  ctx.quotedCancel = undefined;
  if (needsOwner) {
    escalate(ctx, needsOwner);
    return { ok: false as const, done: false, ...terms, reason: "Sent to the owners to approve the refund. Nothing is cancelled yet." };
  }
  ctx.used.push("cancel_booking");
  ctx.actions.push({ type: "cancel", bookingId: b.id });
  return { ok: true as const, done: true, ...terms };
}

// Flags the conversation in the owners' inbox. Nobody is texted or called, so replies promise no time or call (R4).
// draft: a reply the owner can send as-is. Written to the customer, no owner name, no prices the KB doesn't carry.
export function escalate(ctx: ToolCtx, reason: string, keepAgent = false, draft?: string) {
  ctx.used.push("escalate_to_owner");
  ctx.actions.push({ type: "escalate", reason, keepAgent, draft: draft?.trim() || undefined });
  return { ok: true };
}
