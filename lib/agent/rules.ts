// Built-in agent used when no ANTHROPIC_API_KEY is configured. Deterministic intent
// matching over the same tools and knowledge base the Claude agent uses.
import * as chrono from "chrono-node";
import { SUBURBS, defaultStart, fitStart } from "../config";
import { nextFreeDates } from "../domain";
import type { AgentResult, AgentState, Block } from "../types";
import { fmtDate, fmtTime, money, todayISO } from "../util";
import {
  type CancelQuote,
  type ToolCtx,
  cancelBookingTool,
  cancelReply,
  checkAvailability,
  customerBookings,
  escalate,
  getQuote,
  greeting,
  holdAndLink,
  kbLines,
  lookupBooking,
  myBookingByRef,
} from "./tools";
import { isRefusal, parseConfirm } from "./confirm";

const has = (t: string, ...words: (string | RegExp)[]) =>
  words.some((w) => (typeof w === "string" ? t.includes(w) : w.test(t)));

const ORD: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "the second Saturday in December", "last Friday of March"
function nthWeekday(text: string, now: Date): string | undefined {
  const m = text.toLowerCase().match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|last)\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+(?:in|of)\s+([a-z]{3,})/);
  if (!m) return undefined;
  const mi = MONTHS.findIndex((x) => x.startsWith(m[3].slice(0, 3)));
  if (mi < 0) return undefined;
  const wd = WD.findIndex((x) => x.startsWith(m[2]));
  const today = todayISO(now);
  let y = Number(today.slice(0, 4));
  if (`${y}-${String(mi + 1).padStart(2, "0")}-31` < today) y++;
  const n = ORD[m[1]];
  const first = new Date(Date.UTC(y, mi, 1));
  const days: number[] = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(y, mi, d));
    if (dt.getUTCMonth() !== mi) break;
    if (dt.getUTCDay() === wd) days.push(d);
  }
  const day = n === -1 ? days.at(-1) : days[n - 1];
  if (!day) return undefined;
  first.setUTCDate(day);
  return first.toISOString().slice(0, 10);
}

// A message only names a date if it has a weekday, month, number or relative day in it.
// Without this, "extend by an hour on the day" reads as tomorrow.
const DATEISH = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d|\b(today|tomorrow|tonight|weekend|week|fortnight)\b/i;

export function parseDate(text: string, now: Date, refDate?: string): string | undefined {
  if (!DATEISH.test(text)) return undefined;
  const nth = nthWeekday(text, now);
  if (nth) return nth;
  const ref = new Date(todayISO(now) + "T12:00:00+08:00");
  const res = chrono.en.GB.parse(text, { instant: ref, timezone: 480 }, { forwardDate: true });
  // Skip durations like "8 hours", which chrono reads as "8 hours from now".
  const hit = res.find((r) => (r.start.isCertain("day") || r.start.isCertain("weekday")) && !/\b(hours?|hrs?|h|minutes?|mins?|now)\b/i.test(r.text));
  if (!hit) {
    // "the 20th": same month as the date being discussed, else the next one that's still ahead.
    const m = text.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i);
    if (!m) return undefined;
    const day = String(Number(m[1])).padStart(2, "0");
    const today = todayISO(now);
    let ym = (refDate ?? today).slice(0, 7);
    for (let i = 0; i < 13; i++) {
      const cand = `${ym}-${day}`;
      if (cand > today && !Number.isNaN(Date.parse(cand + "T00:00:00Z")) && new Date(cand + "T00:00:00Z").getUTCDate() === Number(day)) return cand;
      const dt = new Date(ym + "-01T00:00:00Z");
      dt.setUTCMonth(dt.getUTCMonth() + 1);
      ym = dt.toISOString().slice(0, 7);
    }
    return undefined;
  }
  const dt = hit.start.date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth" }).format(dt);
}

// "6am", "6:30 pm", "midday"
function parseTime(t: string): string | undefined {
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    const h = (Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0);
    return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
  }
  if (/\b(noon|midday)\b/.test(t)) return "12:00";
  return undefined;
}

function parseBlock(t: string): Block | undefined {
  if (/\b(4|four)\s*(h|hr|hrs|hour|hours)\b|half[\s-]?day|morning|arvo only/.test(t)) return 4;
  if (/\b(8|eight)\s*(h|hr|hrs|hour|hours)\b|full[\s-]?day|all day|wedding/.test(t)) return 8;
  return undefined;
}

export function parseSuburb(t: string): string | undefined {
  const hit = [...SUBURBS].sort((a, b) => b.name.length - a.name.length).find((s) => t.includes(s.name.toLowerCase()));
  if (hit) return hit.name;
  if (t.includes("swan valley")) return "Henley Brook";
  if (t.includes("freo")) return "Fremantle";
  if (t.includes("mandurah") || t.includes("mandjoogoordap")) return "Mandurah";
  return undefined;
}

const OUT_OF_AREA = /margaret river|busselton|bunbury|dunsborough|albany|northam|york|geraldton|kalgoorlie|broome|esperance/;

const PERSON = /\b(speak|talk|chat)\s+(to|with)\s+(a |an |the |one of the )?(human|person|real person|someone|owners?|manager)\b|\b(real person|a human)\b|\b(call|ring|phone)\s+me\b|\bcan (someone|somebody|an owner|one of you) (call|ring|phone)\b/;
const OFF_POLICY = /\b(discount|cheaper|mates? rates?|sponsor|sponsorship|multi[- ]day|two days|three days|3 days|2 days|weekend rate|(better|good|any|special) deals?|do (us )?a deal)\b/;
const PRICE_Q = /\b(how much|price|cost|quote)\b/;
const RESCHEDULE = /\b(move|change|swap|shift)\b.{0,24}\b(date|day|booking)\b|\breschedul|\bpostpone/;

// Extra ways to say yes to "Want the link?".
const HOLD_YES = ["book it", "hold it", "lock it in", "send the link", "send me the link", "send it", "go for it"];

export function runRules(ctx: ToolCtx, text: string, prev: AgentState): AgentResult {
  const t = text.toLowerCase().trim();
  const s = ctx.data.settings;
  const state: AgentState = { ...prev };
  const out = (reply: string): AgentResult => ({ reply, actions: ctx.actions, tools: ctx.used, state, engine: "rules" });
  const refM = t.match(/\bsst-?\s?(\d{3,})\b/);
  const ref = refM ? `SST-${refM[1]}` : undefined;
  // Escalating only flags the conversation in the owners' inbox, so these replies promise no time, text or call (R4).
  const unsure = () => {
    // No draft here: the agent has nothing to say, and a bare greeting would get sent as the whole reply.
    escalate(ctx, `Agent couldn't answer: "${text.slice(0, 160)}"`);
    return out("Good question. I'm not sure, so I've passed it to the owners.");
  };
  // An FAQ answers from the knowledge base as the owners last wrote it, or goes to an owner when the page no longer says.
  const answer = (f: Faq) => {
    const lines = kbLines(ctx, f.page, f.lines);
    return lines.length ? out([...lines, f.then].filter(Boolean).join(" ")) : unsure();
  };
  // The terms of a cancel and the code a YES must echo (KTD11), kept in the state for the next message.
  // The terms follow the real policy for this booking: a full refund outside the window, the deposit kept inside it.
  const quoteCancel = (r: CancelQuote, lead = "") => {
    const q = ctx.quotedCancel;
    if (q) Object.assign(state, { awaiting: "confirm_cancel", bookingId: q.id, code: q.code, refund: q.refund });
    const yes = `Reply YES ${r.code}`;
    if (r.held) return out(`${lead}${r.ref} is only held, not paid, so there's nothing to refund. ${yes} and I'll release the date.`);
    const on = `${r.ref} on ${fmtDate(r.date, { dow: true })} is ${r.daysOut} days away`;
    const terms = r.fullRefund
      ? `${on}, so you'd get a full refund of ${money(r.refund)}.`
      : `${on}, inside the ${s.cancelDays}-day window, so the ${money(r.kept)} deposit is kept${r.refund > 0 ? ` and ${money(r.refund)} would be refunded` : ""}.`;
    return out(`${lead}${r.needsOwner ? `${terms} A refund that size needs an owner's OK. ${yes} and I'll send it to the owners now.` : `${terms} ${yes} to cancel.`}`);
  };

  // After a hand-over the agent still answers general questions, but bookings and cancellations wait for an owner.
  if (ctx.handover) {
    const faq = matchFaq(t);
    if (faq && !/\bcancel|\b(move|change)\b/.test(t)) return answer(faq);
    return out("An owner has this conversation now. I can still answer questions about the truck, kegs or prices.");
  }

  // 1. Pending confirmations. Anything but a clear yes ends them, so a later "yes" confirms nothing. A cancel also
  // needs the quote's code (cancelReply).
  const pending = cancelReply(ctx, prev, text);
  if (state.awaiting === "confirm_cancel") {
    Object.assign(state, { awaiting: undefined, code: undefined, refund: undefined });
    if (pending.kind === "ask") {
      if (pending.keep) Object.assign(state, { awaiting: prev.awaiting, code: prev.code, refund: prev.refund });
      return out(pending.say);
    }
    if (pending.kind === "yes" && state.bookingId) {
      const r = cancelBookingTool(ctx, state.bookingId, true);
      if (r.ok && r.done) return out(`Done, ${r.ref} is cancelled.${r.refund > 0 ? ` I've requested a ${money(r.refund)} refund to your card.` : ""}`);
      if (r.ok && "code" in r) return quoteCancel(r, "The terms have changed since my last message. ");
      if (!r.ok && "needsOwner" in r) return out("I've sent your cancellation to the owners, as a refund that size needs their OK. Nothing is cancelled until an owner approves it.");
      return out("I couldn't cancel that one. Send the SST- reference and I'll check it again.");
    }
    if (pending.kind === "no") return out("All good, your booking stays as is.");
  }

  // A no to "Want the link?" or "What name should I put the booking under?" drops the draft booking.
  // "no, make it 4 hours" carries a new detail, so it carries on with the booking instead.
  if ((state.awaiting === "confirm_hold" || state.awaiting === "name") && isRefusal(t, HOLD_YES)) {
    if (!parseBlock(t) && !parseSuburb(t) && !parseDate(text, ctx.now, prev.date ?? prev.refDate)) {
      Object.assign(state, { awaiting: undefined, date: undefined, block: undefined, suburb: undefined, startTime: undefined, agreed: undefined });
      return out("No worries, I haven't held anything. Text any time if you want to look at another date.");
    }
  }
  // Agreement only counts as a clear yes to a quoted price.
  if (state.awaiting === "confirm_hold" && parseConfirm(t, HOLD_YES) === "yes") state.agreed = true;

  // 2. A person, please. Only explicit asks: "someone", "staff" and "owner" also turn up in ordinary questions.
  if (PERSON.test(t)) {
    escalate(ctx, `Customer asked for a person: "${text.slice(0, 120)}"`, false, `${greeting(ctx)} one of the owners here. What can I help with?`);
    return out("No worries, I've passed your message to the owners. Anything I can sort in the meantime?");
  }

  // Discounts, multi-day and sponsorship are owner decisions.
  if (OFF_POLICY.test(t)) {
    escalate(ctx, `Wants something outside standard pricing: "${text.slice(0, 140)}"`, false, `${greeting(ctx)} one of the owners here. Thanks for the message. Tell me a bit more about the event and the dates and I'll let you know what we can do.`);
    return out("That one's up to the owners, so I've passed your message on to them.");
  }

  // A reference counts only if it is one of the sender's own bookings. One that doesn't exist and someone else's get
  // the same reply, so a stranger can't tell which are real (review C18). A second miss goes to the owners.
  const mine = ref ? myBookingByRef(ctx, ref) : undefined;
  if (ref && !mine) {
    state.refMisses = (prev.refMisses ?? 0) + 1;
    if (state.refMisses < 2) return out(`I can't find ${ref} for this number. Check the reference, or text from the number you booked with.`);
    state.refMisses = 0;
    escalate(ctx, `Couldn't match ${ref} to this sender, asked twice`, true);
    return out(`I still can't match ${ref} to this number, so I've passed your message to the owners.`);
  }
  state.refMisses = undefined;

  // A date change is an owner's job, with or without a new date. It goes over before the date in the message can
  // start a new booking (review A12). Mid-booking, "change the date" is about the draft, so it carries on below.
  const drafting = !!prev.awaiting && prev.awaiting !== "confirm_cancel";
  if (RESCHEDULE.test(t) && (!drafting || mine || has(t, /\b(my|our) booking\b/))) {
    escalate(ctx, `Wants to move ${mine?.ref ?? customerBookings(ctx)[0]?.ref ?? "a booking"} to another date: "${text.slice(0, 120)}"`, false, `${greeting(ctx)} one of the owners here about moving your booking.`);
    const rule = kbLines(ctx, "booking-policy", /date change/i, 1);
    return out(["An owner makes date changes, so I've passed your request on to them.", ...rule].join(" "));
  }

  // 3. Cancellation.
  if (has(t, /\bcancel/)) {
    const bs = mine ? [mine] : customerBookings(ctx);
    const policy = `Cancel more than ${s.cancelDays} days before for a full refund. Within ${s.cancelDays} days, the ${money(s.deposit)} deposit is kept and anything paid on top is refunded.`;
    if (!bs.length) return out(`${policy} If you've already booked, text from the number you booked with or send the SST- reference.`);
    if (has(t, /\b(policy|what if|what happens|how does)\b/) && !ref) return out(`${policy} Want to cancel ${bs[0].ref}? Just say so.`);
    const r = cancelBookingTool(ctx, bs[0].id, false);
    if (!r.ok || !("code" in r)) return out("I couldn't find that booking. Send the SST- reference and I'll check it again.");
    return quoteCancel(r);
  }

  // 4. Existing booking status / balance.
  if (ref || has(t, /\b(my booking|our booking|booking status|balance|when do i pay|have i paid|reference)/)) {
    const bs = lookupBooking(ctx).filter((x) => !mine || x.id === mine.id);
    if (!bs.length) return out("I can't see a booking for this number yet. Want to check a date?");
    const b = bs[0];
    return out(
      `${b.ref}: ${b.date}, ${b.block} in ${b.suburb}. ${b.state === "balance_paid" ? "Fully paid. " : b.balanceDue ? `${money(b.balanceDue)} balance is charged automatically ${s.balanceDaysBefore} days before. ` : ""}Anything else?`,
    );
  }

  // 5. Booking intent: gather date, block, suburb, name; then hold + link.
  const date = parseDate(text, ctx.now, prev.date ?? prev.refDate);
  const block = parseBlock(t);
  const suburb = parseSuburb(t);
  const time = parseTime(t);
  if (OUT_OF_AREA.test(t)) {
    return out(`Sorry, we only go as far as Two Rocks in the north and Mandurah in the south for now. Anywhere in Perth metro, the Hills or the Swan Valley is fine.`);
  }
  if (date) state.date = date;
  if (block) state.block = block;
  if (suburb) state.suburb = suburb;
  if (time) state.startTime = time;
  if (state.awaiting === "name" && !date && !suburb && !block && t.length < 60 && !t.includes("?")) {
    state.name = text.trim().replace(/^(it's|its|i'm|im|name is|under)\s+/i, "");
    state.awaiting = undefined;
  }

  const wantsBook = !isRefusal(t, HOLD_YES) && has(t, /\b(book|hold|lock it in|yes|yep|yeah|go ahead|send (me )?(the )?link|deposit|let's do it|sounds good)\b/);
  const bookingContext = !!(date || block || suburb || prev.awaiting || wantsBook);
  const faq = matchFaq(t);

  if (faq && !date && !suburb && !(wantsBook && state.date)) return answer(faq);

  if (bookingContext && (state.date || wantsBook || prev.awaiting || block || suburb)) {
    if (!state.date) {
      const asked = prev.awaiting === "date";
      state.awaiting = "date";
      const q = state.suburb ? getQuote(ctx, state.block ?? 8, state.suburb) : null;
      if (q?.inArea && state.block && (block || suburb)) {
        return out(`${state.block} hours in ${q.suburb} is ${money(q.total)}, delivered and collected${q.travelFee ? ` (incl. ${money(q.travelFee)} travel)` : ""}. Which date are you after?`);
      }
      if (q?.inArea && suburb) return out(`Got it, ${q.suburb}. Which date are you thinking?`);
      if (asked) {
        state.misses = (prev.misses ?? 0) + 1;
        // Like suburbs: after two re-asks a person takes it.
        if (state.misses >= 3) {
          escalate(ctx, `Couldn't pin down a date: "${text.slice(0, 120)}"`, true);
          Object.assign(state, { awaiting: undefined, misses: 0 });
          return out("Sorry, I'm not getting it, so I've passed this to the owners.");
        }
        const free = nextFreeDates(ctx.data, todayISO(ctx.now), 3, true, ctx.now).map((x) => fmtDate(x, { dow: true }));
        return out(`I didn't catch a date.${free.length ? ` The next free weekend days are ${free.join(", ")}.` : ""} Which suits? Something like "Sat 14 March" works.`);
      }
      return out("Which date are you thinking? You can just say something like \"Sat 14 March\".");
    }
    const av = checkAvailability(ctx, state.date);
    if (av.status === "short_notice") {
      escalate(ctx, `Short-notice request for ${av.label}: "${text.slice(0, 120)}"`, true);
      const alts = av.alternatives.map((a) => fmtDate(a, { dow: true })).join(", ");
      state.refDate = state.date;
      state.date = undefined;
      state.awaiting = undefined;
      return out(`${av.label} is less than ${s.minNoticeDays} days away, so I've asked the owners if they can make it work.${alts ? ` The next free weekend days are ${alts}.` : ""}`);
    }
    if (!av.free) {
      const alts = av.alternatives.map((a) => fmtDate(a, { dow: true })).join(", ");
      const why = av.status === "invalid" ? "isn't a date I can read" : av.status === "past" ? "has already passed" : av.status === "too_far" ? `is more than ${s.bookAheadMonths} months out` : "is already booked";
      state.refDate = state.date;
      state.date = undefined;
      state.awaiting = "date";
      return out(`Sorry, ${av.label} ${why}.${alts ? ` The next free weekend days are ${alts}.` : ""}`);
    }
    if (!state.suburb) {
      if (prev.awaiting === "suburb") {
        state.misses = (prev.misses ?? 0) + 1;
        // Somewhere not on the list: hand it to a person rather than asking forever.
        if (state.misses >= 2) {
          escalate(ctx, `Suburb not on the list for ${av.label}: "${text.slice(0, 120)}"`, true);
          Object.assign(state, { awaiting: undefined, misses: 0 });
          return out("I can't find that one on my list, so I've passed the address to the owners to check.");
        }
        state.awaiting = "suburb";
        return out("Which suburb is the event in?");
      }
      state.awaiting = "suburb";
      return out(`${av.label} is free! Which suburb is the event in? Half day (4h) is ${money(s.price4)}, full day (8h) is ${money(s.price8)}, delivered.`);
    }
    state.misses = 0;
    const q4 = getQuote(ctx, 4, state.suburb);
    if (!q4.inArea) {
      state.suburb = undefined;
      return out("Hmm, I don't know that suburb. Is it in Perth metro, the Hills, or between Two Rocks and Mandurah?");
    }
    if (!state.block) {
      state.awaiting = "confirm_hold";
      const fee = q4.travelFee ? ` (incl. ${money(q4.travelFee)} travel, as ${q4.suburb} is over an hour away)` : "";
      return out(`${av.label} in ${q4.suburb} works. Half day (4h) is ${money(q4.total)} or full day (8h) is ${money(q4.total - s.price4 + s.price8)}${fee}. Which one?`);
    }
    const q = getQuote(ctx, state.block, state.suburb);
    if (!q.inArea) return out("Which suburb is the event in?");
    const start = fitStart(state.block, state.startTime ?? defaultStart(state.block));
    const startNote = state.startTime ? (start !== state.startTime ? ` (the latest start for ${state.block} hours)` : "") : " (say if you want a different start time)";
    // A price question gets the price first, not a request for a name.
    if (PRICE_Q.test(t) && !wantsBook && !state.agreed) {
      state.awaiting = "confirm_hold";
      return out(`${av.label} is free. ${state.block} hours in ${q.suburb} is ${money(q.total)} all in, delivered and collected${q.travelFee ? ` (incl. ${money(q.travelFee)} travel)` : ""}. Want me to hold it?`);
    }
    if (!state.name && !ctx.customerName) {
      state.awaiting = "name";
      return out(`Perfect: ${av.label}, ${state.block} hours in ${q.suburb}, ${money(q.total)} all in. What name should I put the booking under?`);
    }
    if (!state.agreed) {
      state.awaiting = "confirm_hold";
      return out(`${av.label}, ${state.block} hours from ${fmtTime(start)}${startNote} in ${q.suburb}: ${money(q.total)} incl. delivery and glassware. A ${money(q.deposit)} deposit holds it. Want the link?`);
    }
    const h = holdAndLink(ctx, state.date, state.block, q.suburb, state.name ?? ctx.customerName ?? "Guest", start);
    if (!h.ok && "link" in h) {
      Object.assign(state, { awaiting: undefined, date: undefined, block: undefined, suburb: undefined, startTime: undefined, agreed: undefined });
      return out(`${h.reason} Pay the deposit here: ${h.link}`);
    }
    if (!h.ok) return out(`Ah, ${h.reason} Want me to suggest another date?`);
    const summary = `${h.ref}: ${av.label}, ${state.block}h from ${fmtTime(start)}${startNote} in ${q.suburb}`;
    Object.assign(state, { awaiting: undefined, date: undefined, block: undefined, suburb: undefined, startTime: undefined, agreed: undefined });
    return out(`Done, I've held it for ${h.holdMinutes} minutes. ${summary}. ${h.dueNow < h.total ? `Pay the ${money(h.dueNow)} deposit here: ${h.link}\nThe balance comes off the same card ${s.balanceDaysBefore} days before.` : `It's close, so it's paid in full (${money(h.dueNow)}) here: ${h.link}`}`);
  }

  if (faq) return answer(faq);

  if (has(t, /^(hi|hey|hello|g'day|gday|yo|morning|evening)\b/)) {
    return out("Hey! I'm the Sunrise Sunset booking agent. I can check dates, give you a price, hold a date and answer keg questions. What's the event?");
  }
  if (has(t, /\b(thanks|thank you|cheers|legend|ta)\b/)) return out("Cheers! Text any time.");

  return unsure();
}

// A question the knowledge base answers: which page, and which of its lines. The words come from the page as the
// owners last wrote it, never from here, so the fallback says what the Claude agent reads (review: G-type couplers).
interface Faq {
  q: RegExp;
  page: string;
  lines: RegExp;
  then?: string;
}

const HOW = "how-it-works";
const FAQS: Faq[] = [
  // Bring-your-own before kegs, so "can I bring my own kegs?" gets a yes.
  { q: /\b(bring|use) (my|our) own\b|\bbyo\b/, page: HOW, lines: /dry hire|buy kegs/i },
  { q: /\b(rsa|licen[cs]e|liquor|serve alcohol)\b/, page: "rsa-licensing", lines: /licen[cs]e|rsa/i },
  // Staffing before anything that would read "someone" or "staff" as a request for a person.
  { q: /\b(staff(ed)?|bar ?staff|bartenders?|barman|barmaid|servers?|serve (the )?(drinks|beer)|pour (for|drinks)|stay (and|to) pour|stay on|help (us )?(to )?set ?up|set (it )?up for us)\b/, page: HOW, lines: /no staff|on the day/i },
  { q: /\b(couplers?|[sag]-type|guinness)\b/, page: "keg-guide", lines: /coupler/i },
  { q: /\bhow (many|much) (beers?|pints?|drinks?)\b/, page: "keg-guide", lines: /pours about/i },
  { q: /\bhow many kegs\b|\bkegs?\b.{0,20}\bfit\b/, page: "keg-guide", lines: /weight/i },
  { q: /\b(keg|kegs|litre|liter|50l|30l|20l)\b/, page: "keg-guide", lines: /weight|coupler/i },
  { q: /\b(extend|extension|extra hour|another hour|overtime)\b/, page: "pricing", lines: /extension/i },
  { q: /\bdate changes?\b/, page: "booking-policy", lines: /date change/i },
  { q: /\b(refund|cancellation) polic(y|ies)\b/, page: "booking-policy", lines: /cancel/i },
  { q: /\b(price|cost|how much|rates?|quote|pricing)\b/, page: "pricing", lines: /half day|includes|deposit holds/i, then: "Which date are you after?" },
  { q: /\b(supply|provide|bring) (the )?(beer|drinks|alcohol)|do you (sell|supply)/, page: HOW, lines: /dry hire|buy kegs/i },
  { q: /\b(power|generator|electricity|plug)\b/, page: "truck-spec", lines: /power/i },
  { q: /\b(grass|lawn|sand|beach|gravel|slope|ground|surface)\b/, page: "truck-spec", lines: /ground/i },
  { q: /\b(glass|glasses|cups|glassware)\b/, page: "pricing", lines: /glassware/i },
  { q: /\b(bond|damage|deposit back)\b/, page: "pricing", lines: /bond/i },
  { q: /\b(how far|travel|deliver|where do you go|service area)\b/, page: "service-area", lines: /perth metro|free delivery/i },
  { q: /\b(serve|stay)\b/, page: HOW, lines: /no staff|on the day/i },
  { q: /\b(coffee|cold brew|nitro|filament)\b/, page: "keg-guide", lines: /nitro/i },
  { q: /\b(size|fit|gate|dimensions|access|how big)\b/, page: "truck-spec", lines: /\blong\b|\bwide\b/i },
];

const matchFaq = (t: string) => FAQS.find((f) => f.q.test(t));
