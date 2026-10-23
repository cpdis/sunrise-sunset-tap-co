// Built-in agent used when no ANTHROPIC_API_KEY is configured. Deterministic intent
// matching over the same tools and knowledge base the Claude agent uses.
import * as chrono from "chrono-node";
import { SUBURBS, fitStart } from "../config";
import { nextFreeDates } from "../domain";
import type { AgentResult, AgentState, Block } from "../types";
import { fmtDate, fmtTime, money, todayISO } from "../util";
import {
  type ToolCtx,
  cancelBookingTool,
  checkAvailability,
  customerBookings,
  escalate,
  findByRef,
  getQuote,
  holdAndLink,
  lookupBooking,
} from "./tools";
import { isRefusal, parseConfirm } from "./confirm";

// Opening line of a drafted owner reply. The owner edits the rest before sending.
const hi = (ctx: ToolCtx) => (ctx.customerName ? `Hi ${ctx.customerName.split(" ")[0]},` : "Hi,");

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

// When an owner will see a hand-over, in Perth time.
function replyWhen(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", hour: "numeric", hourCycle: "h23" }).format(now));
  return h >= 20 ? "tomorrow morning" : h < 7 ? "this morning" : "today";
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

// Extra ways to say yes to "Reply YES to cancel" and to "Want the link?".
const CANCEL_YES = ["cancel", "cancel it"];
const HOLD_YES = ["book it", "hold it", "lock it in", "send the link", "send me the link", "send it", "go for it"];

export function runRules(ctx: ToolCtx, text: string, prev: AgentState): AgentResult {
  const t = text.toLowerCase().trim();
  const s = ctx.data.settings;
  const state: AgentState = { ...prev };
  const out = (reply: string): AgentResult => ({ reply, actions: ctx.actions, tools: ctx.used, state, engine: "rules" });
  const refM = t.match(/\bsst-?\s?(\d{3,})\b/);
  const ref = refM ? `SST-${refM[1]}` : undefined;
  const when = replyWhen(ctx.now);

  // After a hand-over the agent still answers general questions, but bookings and cancellations wait for an owner.
  if (ctx.handover) {
    const faq = matchFaq(t);
    if (faq && !/\bcancel|\b(move|change)\b/.test(t)) return out(faq(ctx));
    return out(`An owner has this conversation and will reply here ${when}. I can still answer questions about the truck, kegs or prices.`);
  }

  // 1. Pending confirmations. Anything but a clear yes ends them, so a later "yes" confirms nothing.
  if (state.awaiting === "confirm_cancel" && state.bookingId) {
    const c = parseConfirm(t, CANCEL_YES);
    state.awaiting = undefined;
    if (c === "yes") {
      const r = cancelBookingTool(ctx, state.bookingId, true);
      if (!r.ok) return out(`That one needs an owner to sign off on the refund. I've flagged it and someone will confirm ${when}.`);
      return out(`Done. ${r.ref} is cancelled.${r.refund > 0 ? ` ${money(r.refund)} is on its way back to your card (3–5 business days).` : ""}`);
    }
    if (c === "no") return out("All good, your booking stays as is.");
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
    escalate(ctx, `Customer asked for a person: "${text.slice(0, 120)}"`, false, `${hi(ctx)} one of the owners here. What can I help with?`);
    return out(`No worries. I've passed this to one of the owners and they'll get back to you ${when}. Anything I can sort in the meantime?`);
  }

  // Discounts, multi-day and sponsorship are owner decisions.
  if (OFF_POLICY.test(t)) {
    escalate(ctx, `Wants something outside standard pricing: "${text.slice(0, 140)}"`, false, `${hi(ctx)} one of the owners here. Thanks for the message. Tell me a bit more about the event and the dates and I'll let you know what we can do.`);
    return out(`That one's up to the owners, so I've passed it on with your message. Someone will get back to you ${when}.`);
  }

  // A reference only counts if it belongs to the number texting in.
  const byRef = ref ? findByRef(ctx, ref) : undefined;
  if (ref && byRef && !byRef.mine) {
    escalate(ctx, `Asked about ${ref} from a number that isn't on the booking`, true);
    return out(`${ref} is booked under a different number, so I've asked an owner to check and get back to you ${when}.`);
  }

  // 3. Cancellation.
  if (has(t, /\bcancel/)) {
    const bs = byRef ? [byRef.booking] : customerBookings(ctx);
    const policy = `Cancel more than ${s.cancelDays} days before for a full refund. Within ${s.cancelDays} days, the ${money(s.deposit)} deposit is kept and anything paid on top is refunded.`;
    if (ref && !byRef) return out(`I can't find ${ref}. Can you check the reference?`);
    if (!bs.length) return out(`${policy} If you've already booked, text from the number you booked with or send the SST- reference.`);
    if (has(t, /\b(policy|what if|what happens|how does)\b/) && !ref) return out(`${policy} Want to cancel ${bs[0].ref}? Just say so.`);
    const b = bs[0];
    state.bookingId = b.id;
    state.awaiting = "confirm_cancel";
    if (b.state === "held") return out(`${b.ref} is only held, not paid, so there's nothing to refund. Reply YES and I'll release the date.`);
    const r = cancelBookingTool(ctx, b.id, false);
    if (!r.ok && "needsOwner" in r) {
      return out(`${b.ref} on ${fmtDate(b.date, { dow: true })} is less than ${s.cancelDays} days out, so the ${money(s.deposit)} deposit is kept and ${money(r.refund ?? 0)} would be refunded. That refund needs an owner's OK. Reply YES and I'll send it to them now.`);
    }
    if (r.ok) {
      return out(
        r.kept > 0
          ? `${r.ref} is ${r.daysOut} days away, inside the ${s.cancelDays}-day window, so the ${money(r.kept)} deposit is kept${r.refund > 0 ? ` and ${money(r.refund)} is refunded` : ""}. Reply YES to cancel.`
          : `${r.ref} is ${r.daysOut} days away, so you'd get a full refund of ${money(r.refund)}. Reply YES to cancel.`,
      );
    }
  }

  // 4. Existing booking status / balance.
  if (ref || has(t, /\b(my booking|our booking|booking status|balance|when do i pay|have i paid|reference)/)) {
    if (ref && !byRef) return out(`I can't find ${ref}. Can you check the reference?`);
    const bs = lookupBooking(ctx).filter((x) => !byRef || x.id === byRef.booking.id);
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

  if (faq && !date && !suburb && !(wantsBook && state.date)) return out(faq(ctx));

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
          return out(`Sorry, I'm not getting it. I've asked an owner to text you ${when}.`);
        }
        const free = nextFreeDates(ctx.data as never, todayISO(ctx.now), 3, true, ctx.now).map((x) => fmtDate(x, { dow: true }));
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
      return out(`${av.label} is less than ${s.minNoticeDays} days away, so I've asked an owner if they can make it work. They'll reply ${when}.${alts ? ` The next free weekend days are ${alts}.` : ""}`);
    }
    if (!av.free) {
      const alts = av.alternatives.map((a) => fmtDate(a, { dow: true })).join(", ");
      const why = av.status === "past" ? "has already passed" : av.status === "too_far" ? `is more than ${s.bookAheadMonths} months out` : "is already booked";
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
          return out(`I can't find that one on my list, so I've asked an owner to check the address and get back to you ${when}.`);
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
    const start = fitStart(state.block, state.startTime ?? (state.block === 4 ? "14:00" : "12:00"));
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
    if (!h.ok) return out(`Ah, ${h.reason} Want me to suggest another date?`);
    const summary = `${h.ref}: ${av.label}, ${state.block}h from ${fmtTime(start)}${startNote} in ${q.suburb}`;
    Object.assign(state, { awaiting: undefined, date: undefined, block: undefined, suburb: undefined, startTime: undefined, agreed: undefined });
    return out(`Done, I've held it for ${h.holdMinutes} minutes. ${summary}. ${h.dueNow < h.total ? `Pay the ${money(h.dueNow)} deposit here: ${h.link}\nThe balance comes off the same card ${s.balanceDaysBefore} days before.` : `It's close, so it's paid in full (${money(h.dueNow)}) here: ${h.link}`}`);
  }

  if (faq) return out(faq(ctx));

  if (has(t, /^(hi|hey|hello|g'day|gday|yo|morning|evening)\b/)) {
    return out("Hey! I'm the Sunrise Sunset booking agent. I can check dates, give you a price, hold a date and answer keg questions. What's the event?");
  }
  if (has(t, /\b(thanks|thank you|cheers|legend|ta)\b/)) return out("Cheers! Text any time.");

  // No draft here: the agent has nothing to say, and a bare greeting would get sent as the whole reply.
  escalate(ctx, `Agent couldn't answer: "${text.slice(0, 160)}"`);
  return out(`Good question. I'm not sure, so I've asked one of the owners to reply. They usually do within a few hours${when === "today" ? "" : `, so ${when}`}.`);
}

type Faq = (ctx: ToolCtx) => string;

function matchFaq(t: string): Faq | null {
  const s = (ctx: ToolCtx) => ctx.data.settings;
  // Bring-your-own before kegs, so "can I bring my own kegs?" gets a yes.
  if (has(t, /\b(bring|use) (my|our) own\b|\bbyo\b/))
    return () => "Yes. You bring the drinks. Buy kegs anywhere at wholesale and we hook them up. Happy to recommend breweries or distributors.";
  if (has(t, /\b(rsa|licen[cs]e|liquor|serve alcohol)\b/))
    return () => "We're a dry hire, so you supply the drinks and we don't sell alcohol. Private events with free drinks usually need no licence. If you're selling drinks, you may need an occasional liquor licence (apply 14+ days ahead). Lots of venues want RSA staff, so check with yours.";
  // Staffing before anything that would read "someone" or "staff" as a request for a person.
  if (has(t, /\b(staff(ed)?|bar ?staff|bartenders?|barman|barmaid|servers?|serve (the )?(drinks|beer)|pour (for|drinks)|stay (and|to) pour|stay on|help (us )?(to )?set ?up|set (it )?up for us)\b/))
    return () => "No staff stay. We deliver, connect and test every line, show a host how to swap a keg, then come back to collect.";
  if (has(t, /\b(coupler|s-type|a-type|g-type|keg|kegs|litre|liter|50l|30l|20l|how many beers|how much beer)\b/))
    return () => "We carry S-type couplers (most Aussie beers like Gage Roads, Little Creatures, Feral), plus A and G types. Kegs need to be cold before they go in, so pick them up the day before. A 50L keg pours about 100 pints. The truck takes up to 4 × 50L, 6 × 30L or 10 × 20L.";
  if (has(t, /\b(extend|extension|extra hour|another hour|overtime)\b/))
    return () => "No hourly extensions on the day. If you need longer than 4 hours, book the 8-hour block.";
  if (has(t, /\b(move|change|swap|shift)\b.{0,24}\b(date|day|booking)\b|\breschedul/))
    return (c) => {
      escalate(c, "Wants to move a booking to another date", true);
      return `Date changes are free more than ${s(c).cancelDays} days out if the new date is free. I've asked an owner to move it for you.`;
    };
  if (has(t, /\b(refund|cancellation) polic(y|ies)\b/))
    return (c) => `Cancel more than ${s(c).cancelDays} days before for a full refund. Within ${s(c).cancelDays} days, the ${money(s(c).deposit)} deposit is kept and anything paid on top is refunded.`;
  if (has(t, /\b(price|cost|how much|rates?|quote|pricing)\b/))
    return (c) => `Half day (4h) is ${money(s(c).price4)} and full day (8h) is ${money(s(c).price8)}. Both include delivery within an hour of the Perth CBD, setup, glassware and pickup. A ${money(s(c).deposit)} deposit holds the date. Which date are you after?`;
  if (has(t, /\b(supply|provide|bring) (the )?(beer|drinks|alcohol)|do you (sell|supply)/))
    return () => "You bring the drinks. Buy kegs anywhere at wholesale and we hook them up. Happy to recommend breweries or distributors.";
  if (has(t, /\b(power|generator|electricity|plug)\b/))
    return () => "No mains power needed. The fridge runs off the truck. We just need flat, firm ground to park on.";
  if (has(t, /\b(grass|lawn|sand|beach|gravel|slope|ground|surface)\b/))
    return () => "It needs flat, firm ground it can drive onto. Dry grass is fine, but not sand or soft lawn after rain.";
  if (has(t, /\b(glass|glasses|cups|glassware)\b/))
    return () => "Glassware is included: 120 pint and 60 schooner glasses, plus a glass rinser on the truck.";
  if (has(t, /\b(bond|damage|deposit back)\b/))
    return (c) => `A ${money(s(c).bond)} bond is held on your card ${s(c).bondHoldDaysBefore} days before and released after the truck comes back clean and undamaged.`;
  if (has(t, /\b(how far|travel|deliver|where do you go|service area)\b/))
    return (c) => `Perth metro, the Hills and the Swan Valley, from Two Rocks down to Mandurah. Free delivery within ${s(c).travelThresholdMin} minutes of the Perth CBD, ${money(s(c).travelFee)} beyond that.`;
  if (has(t, /\b(serve|stay)\b/))
    return () => "No staff stay. We deliver, connect and test every line, show a host how to swap a keg, then come back to collect.";
  if (has(t, /\b(coffee|cold brew|nitro|filament)\b/))
    return () => "Yes! Nitro cold brew from Filament Coffee pours on its own nitro line. 19L kegs, ordered direct from Filament. It's great for morning events.";
  if (has(t, /\b(size|fit|gate|dimensions|access|how big)\b/))
    return () => "It's a tiny kei truck, about 3.4m long and 1.5m wide, so it fits most driveways and garden gates. It needs firm, flat ground.";
  return null;
}
