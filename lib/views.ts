// What each caller may see of a business's data. The server builds these and sends a caller only the views its
// session or link allows (R14): anyone gets the public view, a customer link adds that one booking, and an owner's
// session adds the whole document.
import type { OwnerSnapshot } from "./agent/owner-tools";
import type { Snapshot } from "./agent/tools";
import { balance, cancelNeedsOwner, cashAt, freeCash, paidSoFar, periodTotals, reserveTarget } from "./domain";
import type { ApprovalCode, Booking, Conversation, Data, KbPage, Settings, Slot } from "./types";
import { addDays, safeEqual, sameContact, todayISO } from "./util";

// What anyone may see: prices, the knowledge base and which days are taken. No booking ids, refs or customers.
export interface PublicView {
  settings: Settings;
  kb: KbPage[];
  blackouts: string[];
  bookings: Slot[];
}

// Every booking that still takes its day, as a slot. Expired holds stay in: dayStatus drops them at its own `now`.
const slots = (d: Data): Slot[] =>
  d.bookings.filter((b) => b.state !== "cancelled").map(({ date, kind, state, heldUntil }) => ({ date, kind, state, heldUntil }));

export function publicView(d: Data, now = new Date()): PublicView {
  const today = todayISO(now);
  return { settings: d.settings, kb: d.kb, blackouts: d.blackouts, bookings: slots(d).filter((b) => b.date >= today) };
}

// What a customer's booking link shows: their own booking, without the owners' notes or who runs the truck.
export interface BookingView {
  booking: Booking;
  // Where the receipt went.
  receiptTo?: string;
  // Paid so far, less refunds.
  paid: number;
  // A cancel over the refund limit is waiting on the owners.
  ownerAsked: boolean;
}

// The booking a link opens: the id and its token must both match.
export function bookingByToken(d: Data, id: string, token: unknown): Booking | undefined {
  const b = d.bookings.find((x) => x.id === id);
  return b?.token && typeof token === "string" && safeEqual(b.token, token) ? b : undefined;
}

export function bookingView(d: Data, b: Booking, now = new Date()): BookingView {
  const reason = cancelNeedsOwner(d.settings, b, now);
  return {
    booking: { ...b, notes: undefined, condition: undefined, deliver: { done: b.deliver.done }, collect: { done: b.collect.done } },
    receiptTo: b.receiptEmail || d.customers.find((c) => c.id === b.customerId)?.email || undefined,
    paid: paidSoFar(d, b.id),
    ownerAsked: !!reason && d.conversations.some((c) => c.customerId === b.customerId && c.escalated === reason),
  };
}

// The SMS widget's conversation, as its sender sees it: no owner draft, no internal ids and no agent state (which
// holds the code a customer's cancel must echo; that goes to the sender's handset only, in the message).
export type ChatView = Pick<Conversation, "id" | "channel" | "contact" | "name" | "agentActive" | "escalated" | "handledBy" | "messages">;

export function chatView({ id, channel, contact, name, agentActive, escalated, handledBy, messages }: Conversation): ChatView {
  return { id, channel, contact, name, agentActive, escalated, handledBy, messages };
}

// An owner has the conversation: they took it over or replied, and the agent stays out of it until it is handed
// back. A hand-over the owners haven't picked up yet still gets the agent's general answers.
export const ownerHolds = (c: Pick<Conversation, "agentActive" | "escalated" | "handledBy">) => !c.agentActive && (!!c.handledBy || !c.escalated);

// An owner texting (or emailing) the business line from their own number gets the owner agent.
export function ownerByContact(d: Data, contact: string) {
  return d.owners.find((o) => sameContact(o.phone, contact) || sameContact(o.email, contact));
}

// What the customer agent sees: availability for every date, and only the sender's own customer records and
// bookings. Other customers' bookings appear only as slots.
export function snapshot(d: Data, contact?: string): Snapshot {
  const customers = d.customers.filter((c) => sameContact(c.phone, contact) || sameContact(c.email, contact));
  const ids = new Set(customers.map((c) => c.id));
  const mine = d.bookings.filter((b) => !!b.customerId && ids.has(b.customerId)).map(({ notes, condition, guests, eventType, ...b }) => b);
  return { settings: d.settings, kb: d.kb, blackouts: d.blackouts, seq: d.seq, customers, bookings: slots(d), mine };
}

// What the owner agent sees: everything an owner sees in the admin, with ledger totals in place of the ledger.
export function ownerSnapshot(d: Data, now = new Date()): OwnerSnapshot {
  const today = todayISO(now);
  const t30 = periodTotals(d, addDays(today, -30), today);
  return {
    settings: d.settings,
    owners: d.owners,
    bookings: d.bookings,
    customers: d.customers,
    distributions: d.distributions,
    truck: d.truck,
    kb: d.kb,
    blackouts: d.blackouts,
    seq: d.seq,
    inbox: d.conversations
      .filter((c) => !c.ownerId)
      .map((c) => ({ id: c.id, name: c.name, channel: c.channel, contact: c.contact, escalated: c.escalated, agentActive: c.agentActive, last: c.messages.at(-1)?.body.slice(0, 140), draft: c.draft })),
    money: {
      cash: Math.round(cashAt(d)),
      reserve: reserveTarget(d, today),
      revenue30: Math.round(t30.revenue),
      profit30: Math.round(t30.profit),
      held: Math.round(balance(d, "deposits")),
      owedRunners: Object.fromEntries(d.owners.map((o) => [o.id, Math.round(balance(d, "owed_runners", undefined, o.id))])),
      free: freeCash(d, today),
    },
  };
}

// The whole answer to a state read. Each part is present only when the caller may see it.
export interface StateView {
  pub: PublicView;
  // A signed-in owner: the whole document, and the one-time codes for the changes they texted (KTD6).
  owner?: { id: string; data: Data; codes: ApprovalCode[] };
  // A customer's booking link.
  booking?: BookingView;
  // The SMS widget's conversation with the contact it texts from.
  chat?: ChatView;
}

export interface StateQuery {
  // From a verified session cookie, never from the request body or query.
  ownerId?: string;
  booking?: string;
  token?: string;
  chat?: string;
  // demoMode() (KTD12): the widget may read a customer number's conversation without a session.
  demo?: boolean;
}

export function stateFor(d: Data, q: StateQuery, now = new Date()): StateView {
  const owner = d.owners.find((o) => o.id === q.ownerId);
  const b = q.booking ? bookingByToken(d, q.booking, q.token) : undefined;
  const c = q.chat ? d.conversations.find((x) => x.channel === "sms" && x.contact === q.chat) : undefined;
  return {
    pub: publicView(d, now),
    ...(owner && { owner: { id: owner.id, data: d, codes: [] } }),
    ...(b && { booking: bookingView(d, b, now) }),
    // A phone number is no secret, so a conversation goes only to a signed-in owner, or to the demo's widget, whose
    // simulator lets anyone text as any customer number anyway. An owner's own number reaches the owner agent, so
    // only a signed-in owner reads that conversation, even in the demo.
    ...(c && (owner || (q.demo && !c.ownerId)) && { chat: chatView(c) }),
  };
}
