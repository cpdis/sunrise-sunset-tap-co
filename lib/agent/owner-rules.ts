// Owner agent without an API key: deterministic intent matching over the same owner tools the Claude path uses.
import type { Account, AgentResult, AgentState, Settings } from "../types";
import { fmtDate, fmtTime, money } from "../util";
import {
  type OwnerCtx,
  addExpense,
  addKnowledge,
  calendar,
  cancelForCustomer,
  changeSetting,
  claimRun,
  confirmText,
  findBookings,
  handBack,
  handBackText,
  sendDraft,
  inboxList,
  logTruck,
  payout,
  replyToCustomer,
  resolvePending,
  sentText,
  whatsOn,
} from "./owner-tools";
import { parseDate, parseSuburb } from "./rules";

export const OWNER_HELP =
  "I can: show what's on, claim a run (\"I'll take the Fremantle delivery\"), log the truck (\"log 115,900 km\"), add an expense (\"$42 CO2 refill\"), approve or pay the payout, reply to a customer (\"tell Sophie: yes, 6am works\"), block a date, change a booking rule (\"set notice to 10 days\") or add a line to the agent's knowledge (\"add to keg guide: ...\").";

const ACCOUNTS: [RegExp, Account][] = [
  [/\b(co2|gas bottle|gas refill)\b/, "co2"],
  [/\b(fuel|petrol|diesel|unleaded)\b/, "fuel"],
  [/\b(caustic|line clean|cleaning|cleaner)\b/, "cleaning"],
  [/\b(glass(es)?|breakage|broke)\b/, "breakage"],
  [/\b(service|repair|tyres?|brakes?|parts?|mechanic|maintenance|tap)\b/, "maintenance"],
  [/\binsurance\b/, "insurance"],
  [/\brego\b|\bregistration\b/, "rego"],
  [/\b(software|phone|twilio|vercel|domain|sms)\b/, "software"],
  [/\b(accountant|asic|bookkeep\w*|tax agent)\b/, "accounting"],
  [/\b(marketing|ads?|flyers?|stickers?|signage|instagram)\b/, "marketing"],
];

// Phrases for each setting. More specific phrases come first ("bond hold" before "bond").
const SETTING_WORDS: [RegExp, keyof Settings][] = [
  [/\b(4|four)[- ]?(h|hr|hour)s?\b|half[- ]day/, "price4"],
  [/\b(8|eight)[- ]?(h|hr|hour)s?\b|full[- ]day/, "price8"],
  [/bond hold/, "bondHoldDaysBefore"],
  [/\bbond\b/, "bond"],
  [/\bdeposit\b/, "deposit"],
  [/travel (threshold|minutes|limit)|free delivery/, "travelThresholdMin"],
  [/travel fee|surcharge/, "travelFee"],
  [/runner fee/, "runnerFee"],
  [/\bnotice\b/, "minNoticeDays"],
  [/book(ing)? ahead|months ahead/, "bookAheadMonths"],
  [/\bholds?\b/, "holdMinutes"],
  [/\bbalance\b/, "balanceDaysBefore"],
  [/cancel(lation)?|full refund/, "cancelDays"],
  [/refund limit/, "refundLimit"],
  [/expense (cap|limit)|sms limit/, "smsExpenseCap"],
  [/approvals?/, "approvalsRequired"],
  [/\btax\b/, "taxRate"],
  [/reserve/, "reserveMonths"],
  [/fixed costs?/, "fixedMonthly"],
  [/maintenance/, "maintPerKm"],
];

const REF = /\b(sst-?\s?\d{3,})\b/i;
const refOf = (t: string) => t.match(REF)?.[1].replace(/sst-?\s?/i, "SST-");

function odometer(t: string): number | undefined {
  const m = t.match(/\b(\d{1,3}(?:,\d{3})+|\d{4,7})\s*(?:km|kms|k)?\b/);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

function amount(t: string): number | undefined {
  const m = t.match(/\$\s*(\d+(?:\.\d{1,2})?)/) ?? t.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:dollars|bucks)\b/);
  return m ? Number(m[1]) : undefined;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const runWord = (w: string) => (w === "deliver" ? "delivery" : "collection");

export function runOwnerRules(ctx: OwnerCtx, text: string, prev: AgentState): AgentResult {
  const t = text.toLowerCase().trim();
  const state: AgentState = { ...prev };
  const out = (reply: string): AgentResult => {
    state.pending = ctx.staged ?? state.pending;
    return { reply, actions: ctx.actions, tools: ctx.used, state, engine: "rules" };
  };
  const yes = (r: { summary: string }) => out(confirmText(r.summary));
  const date = parseDate(text, ctx.now);
  const ref = refOf(t);

  const confirmed = resolvePending(ctx, state, text);
  if (confirmed) return out(confirmed);

  if (/^(hi|hey|hello|g'?day|help|menu|\?)\b/.test(t)) return out(`G'day ${ctx.owner.name}. ${OWNER_HELP}`);

  // Replies, hand-backs and knowledge lines carry free text, so they come before anything that reads keywords.
  const reply = text.match(/^\s*(?:reply to|tell|text|message)\s+(.+?)\s*[:\-–]\s*(.+)$/i);
  if (reply) {
    const r = replyToCustomer(ctx, reply[1], reply[2]);
    return out(r.ok ? sentText(r) : r.reason);
  }
  // "send the draft for Harbour", "send Harbour the draft".
  const draft = text.match(/^\s*send\s+(?:the\s+draft\s+(?:for|to)\s+(.+?)|(.+?)\s+the\s+draft)\s*$/i);
  if (draft) {
    const r = sendDraft(ctx, (draft[1] ?? draft[2]).trim());
    return r.ok ? yes(r) : out(r.reason);
  }
  // "anyway" or "without replying" hands back although the customer is still owed a reply. It can sit anywhere:
  // "hand back Harbour anyway", "hand Harbour back anyway", "hand Harbour back to the agent without replying".
  const FORCE = /\s*\b(anyway|without (a )?repl(y|ying))\b/i;
  const force = FORCE.test(text);
  const back = text.replace(FORCE, "").match(/^\s*hand\s+(?:back\s+(?:to\s+the\s+agent\s+)?(.+)|(.+?)\s+back(?:\s+to\s+the\s+agent)?)\s*$/i);
  if (back) {
    const raw = (back[1] ?? back[2]).trim();
    const r = handBack(ctx, raw, force);
    return out(r.ok ? handBackText(r) : r.reason);
  }

  // Knowledge: "add to keg guide: we now carry G-type couplers".
  const kb = text.match(/^\s*(?:add|note)(?:\s+this)?\s+to\s+(?:the\s+)?(.+?)(?:\s+page)?\s*:\s*(.+)$/i);
  if (kb) {
    const r = addKnowledge(ctx, { page: kb[1], line: kb[2] });
    return r.ok ? yes(r) : out(`I can't find that page. ${r.reason}`);
  }

  // Payouts: approve, then pay once enough directors have approved.
  if (/\bapprove\b/.test(t)) {
    const r = payout(ctx, { action: "approve" });
    return r.ok ? yes(r) : out(r.reason);
  }
  if (/\bpay (out )?(the )?(payout|dividends?|distribution)\b|\bpay it( out)?\b/.test(t)) {
    const r = payout(ctx, { action: "pay" });
    return r.ok ? yes(r) : out(r.reason);
  }

  if (/\bcancel\b/.test(t) && ref) {
    const r = cancelForCustomer(ctx, ref);
    return r.ok ? yes(r) : out(r.reason);
  }

  // Settings before expenses: "set the deposit to $300" has a dollar amount too (and is refused as admin only).
  const set = t.match(/\b(?:set|change|make|raise|lower|update|put)\b(.+?)\bto\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (set) {
    const key = SETTING_WORDS.find(([re]) => re.test(set[1]))?.[1];
    if (!key) return out("Which setting? For example: \"set notice to 10 days\" or \"set holds to 45 minutes\".");
    const r = changeSetting(ctx, { key, value: Number(set[2]) });
    return r.ok ? yes(r) : out(r.reason);
  }

  // Runs: "I'll take the Fremantle delivery", "put me down for both runs on SST-1049".
  const runs = t.match(/\b(deliver(y|ies)?|drop[- ]?offs?|collect(ion)?s?|pick[- ]?ups?|runs?|both)\b/);
  if (runs && /\b(i'?ll|i will|i can|happy to|put me|claim|take|grab|i'?ve got|me for|mine)\b/.test(t)) {
    const d = /\b(deliver|drop)/.test(t);
    const c = /\b(collect|pick)/.test(t);
    const which = d && !c ? "deliver" : c && !d ? "collect" : "both";
    const r = claimRun(ctx, { ref, suburb: ref ? undefined : parseSuburb(t), date: ref ? undefined : date, which });
    if (!r.ok) return out(r.reason);
    const taken = r.takenFrom.length ? ` (taken over from ${list(r.takenFrom)})` : "";
    return out(`Done, you've got the ${list(r.runs.map(runWord))} for ${r.ref}: ${r.date}, ${r.suburb}, taps open ${fmtTime(r.start)}${taken}. ${money(r.runnerFee)} in runner fees, paid with the next payout.`);
  }

  // Truck log.
  const km = odometer(t);
  const truckType = /\b(clean(ed)? (the )?lines|line clean|caustic)\b/.test(t) ? "clean" : /\bservice(d)?\b/.test(t) && !amount(t) ? "service" : /\b(incident|dent|scratch|ding)\b/.test(t) ? "incident" : undefined;
  if (truckType || (km !== undefined && /\b(odo|odometer|km|kms|kilometres|log)\b/.test(t) && !amount(t))) {
    const r = logTruck(ctx, { type: truckType ?? "odometer", odometer: km, notes: truckType ? text.trim() : undefined });
    if (!r.ok) return out(r.reason);
    return out(`Logged${r.type === "odometer" ? "" : ` a ${r.type}`}${r.odometer ? ` at ${r.odometer.toLocaleString()} km` : ""}${r.sinceLast ? ` (${r.sinceLast.toLocaleString()} km since the last reading)` : ""}.`);
  }

  // Expenses: "$42 CO2 refill", "spent 60 bucks on fuel".
  const amt = amount(t);
  if (amt !== undefined && !/\b(price|quote|how much)\b/.test(t)) {
    const account = ACCOUNTS.find(([re]) => re.test(t))?.[1];
    if (!account) return out(`What was the ${money(amt)} for? Say fuel, CO2, cleaning, maintenance, glasses, insurance, rego, software, accountant or marketing.`);
    const memo = text.replace(/\$\s*\d+(\.\d{1,2})?|\b\d+(\.\d{1,2})?\s*(dollars|bucks)\b/i, "").replace(/^\s*(spent|paid|bought|expense:?)\s*/i, "").replace(/\s+/g, " ").trim();
    const r = addExpense(ctx, { account, amount: amt, memo });
    return r.ok ? yes(r) : out(r.reason);
  }

  // Calendar.
  if (/\b(unblock|block|own use|personal use|borrow|for (me|myself|us)|i want the truck)\b/.test(t)) {
    if (!date) return out("Which date?");
    const action = /\bunblock\b/.test(t) ? "unblock" : /\bblock\b/.test(t) ? "block" : "own_use";
    const r = calendar(ctx, { action, date, note: action === "own_use" ? text.trim() : undefined });
    return out(r.ok ? `${r.label} is ${r.done}.${"note" in r ? ` ${r.note}` : ""}` : r.reason);
  }

  if (/\b(inbox|who needs|handovers?|escalat\w*|messages?)\b/.test(t)) {
    const items = inboxList(ctx);
    if (!items.length) return out("Nothing in the inbox needs a person.");
    return out(items.map((c) => `${c.name}: ${c.why}`).join("\n"));
  }

  // A booking by ref, date, suburb or customer.
  if (ref || (date && /\b(who|what|booking|booked|on)\b/.test(t)) || /\b(find|look ?up|booking for)\b/.test(t)) {
    const name = t.match(/\b(?:booking for|find|look ?up)\s+([a-z][a-z' ]+)$/)?.[1];
    const r = findBookings(ctx, { ref, date: ref ? undefined : date, suburb: ref ? undefined : parseSuburb(t), name: ref || date ? undefined : name });
    if (!r.bookings.length) return out(date ? `Nothing booked ${fmtDate(date, { dow: true })} (${r.day?.replace("_", " ")}).` : "I can't find a booking that matches.");
    return out(
      r.bookings
        .map((b) => `${b.ref}: ${b.date}, ${b.who}, ${b.block}h from ${fmtTime(b.start)} in ${b.suburb}, ${b.state.replace("_", " ")}${b.kind === "paid" ? `, ${money(b.total)}. Delivery: ${b.deliver}. Collection: ${b.collect}` : ""}.`)
        .join("\n"),
    );
  }

  if (/\b(what'?s on|my runs|runs|summary|today|this week|update|status|owed|how are we|cash|payouts?|anything)\b/.test(t)) {
    const w = whatsOn(ctx);
    const lines = [
      w.myRuns.length ? `Your runs: ${w.myRuns.map((r) => `${r.date} ${r.suburb} (${list(r.runs.map(runWord))})`).join("; ")}.` : "No runs for you in the next 30 days.",
      w.unclaimed.length ? `Unclaimed: ${w.unclaimed.map((r) => `${r.ref} ${r.date} ${r.suburb} (${list(r.runs.map(runWord))})`).join("; ")}.` : "All runs are covered.",
      ...w.needsAPerson.map((c) => `Needs a person: ${c.name}.`),
      ...w.payouts.map((p) => `${p.quarter} payout ${money(p.amount)}: ${p.approvals} of ${ctx.data.settings.approvalsRequired} approvals${p.needsMe ? ", yours is needed" : ""}.`),
      `${money(w.owedToMe)} runner fees owed to you. Cash ${money(w.cash)}.`,
    ];
    return out(lines.join("\n"));
  }

  return out(`Sorry ${ctx.owner.name}, I didn't get that. ${OWNER_HELP}`);
}
