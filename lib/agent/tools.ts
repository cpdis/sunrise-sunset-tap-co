// Agent tools. They run on the server against a snapshot of the client's data and
// return actions that the client store applies (hold, cancel, escalate).
import { BUSINESS, SUBURBS, defaultStart, findSuburb, startProblem } from "../config";
import { cancelNeedsOwner, cancelPolicy, dayStatus, isBookable, nextFreeDates, quote } from "../domain";
import type { AgentAction, Block, Channel, Data, KbPage, Settings } from "../types";
import { addDays, daysBetween, fmtDate, fmtTime, isISODate, money, sameContact, todayISO, uid } from "../util";

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

export function kbPage(kb: KbPage[], s: Settings, slug: string): string {
  const p = kb.find((x) => x.slug === slug);
  return p ? renderKb([p], s) : "";
}

export function customerBookings(ctx: ToolCtx) {
  const c = ctx.data.customers.find((x) => sameContact(x.phone, ctx.contact) || sameContact(x.email, ctx.contact));
  if (!c) return [];
  return ctx.data.bookings
    .filter((b) => b.customerId === c.id && b.state !== "cancelled" && b.date >= todayISO(ctx.now))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// A booking by its SST- reference, and whether it belongs to the sender.
export function findByRef(ctx: ToolCtx, ref: string) {
  const b = ctx.data.bookings.find((x) => x.ref.toUpperCase() === ref.toUpperCase() && x.state !== "cancelled");
  if (!b) return undefined;
  return { booking: b, mine: customerBookings(ctx).some((x) => x.id === b.id) };
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
  ctx.used.push("hold_date", "send_deposit_link");
  if (ctx.handover) return { ok: false as const, reason: "an owner is handling this conversation." };
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

export function cancelBookingTool(ctx: ToolCtx, bookingId: string, confirmed: boolean) {
  ctx.used.push("cancel_booking");
  if (ctx.handover) return { ok: false as const, reason: "An owner is handling this conversation." };
  const b = customerBookings(ctx).find((x) => x.id === bookingId || x.ref === bookingId);
  if (!b) return { ok: false as const, reason: "No upcoming booking found for this sender." };
  const pol = cancelPolicy(ctx.data.settings, b, ctx.now);
  const needsOwner = cancelNeedsOwner(ctx.data.settings, b, ctx.now);
  if (needsOwner) {
    if (confirmed) ctx.actions.push({ type: "escalate", reason: needsOwner });
    return { ok: false as const, needsOwner: true, refund: pol.refund, ref: b.ref };
  }
  if (confirmed) ctx.actions.push({ type: "cancel", bookingId: b.id });
  return { ok: true as const, done: confirmed, ref: b.ref, refund: pol.refund, kept: pol.kept, daysOut: pol.days };
}

// draft: a reply the owner can send as-is. Written to the customer, no owner name, no prices the KB doesn't carry.
export function escalate(ctx: ToolCtx, reason: string, keepAgent = false, draft?: string) {
  ctx.used.push("escalate_to_owner");
  ctx.actions.push({ type: "escalate", reason, keepAgent, draft: draft?.trim() || undefined });
  return { ok: true };
}
