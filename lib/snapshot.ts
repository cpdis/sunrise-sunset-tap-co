// What the agents see of the demo data. Plain functions (no store), so the server-rendered explainer can use them too.
import type { OwnerSnapshot } from "./agent/owner-tools";
import type { Snapshot } from "./agent/tools";
import { balance, cashAt, freeCash, periodTotals, reserveTarget } from "./domain";
import type { Data } from "./types";
import { addDays, sameContact, todayISO } from "./util";

// What the agent endpoint sees: availability for every date, but only the sender's own contact details.
export function snapshot(d: Data, contact?: string): Snapshot {
  const customers = d.customers.filter((c) => sameContact(c.phone, contact) || sameContact(c.email, contact));
  const bookings = d.bookings.map(({ notes, condition, guests, eventType, ...b }) => b) as Data["bookings"];
  return { settings: d.settings, bookings, customers, kb: d.kb, blackouts: d.blackouts, seq: d.seq };
}

// An owner texting (or emailing) the business line from their own number gets the owner agent.
export function ownerByContact(d: Data, contact: string) {
  return d.owners.find((o) => sameContact(o.phone, contact) || sameContact(o.email, contact));
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
