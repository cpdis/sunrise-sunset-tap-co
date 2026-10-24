// Everything the explainer shows comes from running the PoC's own code at build time: the seeded year,
// the scheduled jobs, both agents' rules engines and the payout maths. Nothing here is typed in by hand,
// so a change to lib/ (a price, a rule, a reply) shows up on the page at the next deploy.
import { runOwnerRules } from "@/lib/agent/owner-rules";
import type { OwnerCtx } from "@/lib/agent/owner-tools";
import { runRules } from "@/lib/agent/rules";
import type { ToolCtx } from "@/lib/agent/tools";
import { BUSINESS, DEFAULT_SETTINGS, SUBURBS } from "@/lib/config";
import { ACCOUNT_LABEL, cancelBooking, cancelNeedsOwner, createHold, heldFor, nextFreeDates, payDeposit, runJobs } from "@/lib/domain";
import { applyOwnerAction, claimRun, returnedClean } from "@/lib/ops";
import { CAPITAL_PER_OWNER, buildSeed } from "@/lib/seed";
import { ownerSnapshot, snapshot } from "@/lib/snapshot";
import type { AgentState, Data } from "@/lib/types";
import { addDays, daysBetween, fmtDate, money, quarterLabel, todayISO } from "@/lib/util";

// The same moment the test suite uses, so the transcripts match tests/ and stay stable between deploys.
export const STORY_NOW = new Date("2026-10-22T12:00:00+08:00");

export interface Line {
  from: "them" | "agent";
  body: string;
  // What the agent did as well as reply (a hold, an escalation, a staged change).
  did?: string;
}

const DID: Record<string, string> = {
  hold: "held the date for 30 min and sent a deposit link",
  cancel: "cancelled the booking",
  escalate: "flagged the conversation for an owner",
  claim_run: "gave the run to the owner who texted",
  expense: "posted the expense to the ledger",
  approve_payout: "recorded this director's approval",
  send_draft: "sent the draft to the customer",
  owner_reply: "sent the owner's reply",
};

function customerChat(d: Data, contact: string, lines: string[], handover = false): Line[] {
  let state: AgentState = {};
  return lines.flatMap((text) => {
    const ctx: ToolCtx = { data: snapshot(d, contact), contact, channel: "sms", now: STORY_NOW, actions: [], used: [], origin: "https://sunrisesunsettapco.cpd.dev", handover };
    const r = runRules(ctx, text, state);
    state = r.state;
    return [{ from: "them" as const, body: text }, { from: "agent" as const, body: r.reply, did: r.actions.map((a) => DID[a.type]).filter(Boolean).join("; ") || undefined }];
  });
}

function ownerChat(d: Data, ownerId: string, lines: string[]): Line[] {
  let state: AgentState = {};
  const owner = d.owners.find((o) => o.id === ownerId)!;
  return lines.flatMap((text) => {
    const ctx: OwnerCtx = { data: ownerSnapshot(d, STORY_NOW), owner, now: STORY_NOW, actions: [], used: [] };
    const r = runOwnerRules(ctx, text, state);
    state = r.state;
    for (const a of r.actions) {
      if (a.type === "cancel") cancelBooking(d, a.bookingId, STORY_NOW);
      else applyOwnerAction(d, a, ownerId);
    }
    const did = r.actions.map((a) => DID[a.type]).filter(Boolean).join("; ") || (state.pending ? "staged the change and waited for YES" : undefined);
    return [{ from: "them" as const, body: text }, { from: "agent" as const, body: r.reply, did }];
  });
}

// ---------- a booking, day by day ----------

export interface Day {
  date: string;
  out: number;
  state: string;
  bond: string;
  paid: number;
  held: number;
  earned: number;
  events: string[];
  ledger: { date: string; account: string; amount: number; memo: string }[];
}

// Books an 8-hour Fremantle hire about 8 weeks out, then runs the scheduled jobs once a day until it is over.
// declines: the card on file fails, so the balance retries and the date is released.
function bookingLife(declines: boolean) {
  const d = buildSeed(STORY_NOW);
  const today = todayISO(STORY_NOW);
  const date = nextFreeDates(d, addDays(today, 52), 1, true, STORY_NOW)[0];
  const b = createHold(d, { date, block: 8, startTime: "14:00", suburb: "Fremantle", name: "Sam Taylor", phone: "0412 555 019", via: "sms", agreed: true }, STORY_NOW);
  payDeposit(d, b.id, "Visa •• 4242", STORY_NOW);
  claimRun(d, b.id, "deliver", "own_rhys");
  claimRun(d, b.id, "collect", "own_aaron");
  if (declines) b.cardDeclines = true;

  const snap = (day: string, events: string[]): Day => ({
    date: day,
    out: daysBetween(day, date),
    state: b.state,
    bond: b.bondStatus,
    paid: d.payments.filter((p) => p.bookingId === b.id && p.status === "succeeded").reduce((s, p) => s + (p.type === "deposit" || p.type === "balance" ? p.amount : p.type === "refund" ? -p.amount : 0), 0),
    held: Math.round(heldFor(d, b.id) * 100) / 100,
    earned: d.ledger.filter((e) => e.ref === b.id && e.account === "revenue").reduce((s, e) => s + e.amount, 0),
    events,
    ledger: d.ledger.filter((e) => e.ref === b.id || e.memo.startsWith(b.ref)).map((e) => ({ date: e.date, account: ACCOUNT_LABEL[e.account], amount: e.amount, memo: e.memo })),
  });

  const days: Day[] = [snap(today, [`Sam texts, the agent holds ${fmtDate(date, { dow: true })}, Sam pays the deposit`])];
  for (let day = addDays(today, 1); day <= addDays(date, 1); day = addDays(day, 1)) {
    const log = runJobs(d, new Date(`${day}T09:00:00+08:00`)).filter((x) => x.includes(b.ref));
    // The collection run: the owner who brings the truck home checks it, and only that releases the bond.
    if (day > date && b.bondStatus === "held") {
      const runner = d.owners.find((o) => o.id === b.collect.ownerId) ?? d.owners[0];
      returnedClean(d, b.id, runner.id, new Date(`${day}T16:00:00+08:00`));
      log.push(`${runner.name.split(" ")[0]} brings the truck home and taps Returned clean, which releases the ${money(b.bond)} bond`);
    }
    days.push(snap(day, log));
  }
  return { ref: b.ref, date, days };
}

// ---------- payouts ----------

function payouts(d: Data) {
  return d.distributions.map((x) => ({
    quarter: quarterLabel(x.quarter),
    status: x.status,
    revenue: x.revenue,
    expenses: x.expenses,
    profit: x.profit,
    tax: x.taxProvision,
    cash: x.cash,
    reserve: x.reserve,
    deposits: x.deposits,
    owedRunners: x.owedRunners,
    each: x.lines[0]?.amount ?? 0,
    owners: x.lines.length,
    distributable: x.distributable,
    runnerFees: x.lines.reduce((s, l) => s + l.runnerFees, 0),
    approvals: x.approvals.length,
  }));
}

// A seeded customer with a paid booking far enough out for a full refund, so a cancel by text is the agent's to do.
function cancelChat() {
  const d = buildSeed(STORY_NOW);
  // Not a Sam, so the page doesn't mix this customer up with Sam Taylor's booking above.
  const nameOf = (id?: string) => d.customers.find((x) => x.id === id)?.name ?? "";
  const b = d.bookings.find((x) => x.kind === "paid" && x.state === "confirmed" && !cancelNeedsOwner(d.settings, x, STORY_NOW) && !!nameOf(x.customerId) && !nameOf(x.customerId).startsWith("Sam"))!;
  const c = d.customers.find((x) => x.id === b.customerId)!;
  return {
    ref: b.ref,
    who: c.name.split(" ")[0],
    lines: customerChat(d, c.phone, [`I need to cancel ${b.ref}`, "No, don't cancel it", "Actually yes, cancel it", "yes"]),
    // The same reference asked about from a number that isn't on the booking.
    stranger: customerChat(buildSeed(STORY_NOW), "0499 000 111", [`What time is ${b.ref}?`]),
  };
}

export function storyData() {
  const s = DEFAULT_SETTINGS;
  const d = buildSeed(STORY_NOW);
  return {
    s,
    business: BUSINESS,
    suburbs: SUBURBS,
    owners: d.owners.length,
    capital: CAPITAL_PER_OWNER,
    kbPages: d.kb.length,
    life: { ok: bookingLife(false), declines: bookingLife(true) },
    payouts: payouts(d),
    chats: {
      book: customerChat(buildSeed(STORY_NOW), "0412 555 019", ["Hi, is the second Saturday in December free?", "8 hours in Fremantle, from 2pm", "Sam Taylor", "Yes please"]),
      offPolicy: customerChat(buildSeed(STORY_NOW), "0412 555 020", ["Can we get a discount for a 3 day festival?"]),
      short: customerChat(buildSeed(STORY_NOW), "0412 555 021", ["Can I book it for next Wednesday?"]),
      cancel: cancelChat(),
      handover: customerChat(buildSeed(STORY_NOW), "0412 555 022", ["Can I book the 12th of December?", "Do you supply the beer?"], true),
      owner: {
        now: ownerChat(buildSeed(STORY_NOW), "own_colin", ["I'll take the Fremantle delivery"]),
        yes: ownerChat(buildSeed(STORY_NOW), "own_colin", ["approve the payout", "yes"]),
        setting: ownerChat(buildSeed(STORY_NOW), "own_colin", ["set notice to 10 days", "no"]),
        draft: ownerChat(buildSeed(STORY_NOW), "own_colin", ["hand back Harbour", "send the draft to Harbour"]),
        admin: ownerChat(buildSeed(STORY_NOW), "own_colin", ["change the deposit to $300"]),
      },
    },
  };
}

export type StoryData = ReturnType<typeof storyData>;
