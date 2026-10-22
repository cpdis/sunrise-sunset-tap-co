// Built-in agent used when no ANTHROPIC_API_KEY is configured. Deterministic intent
// matching over the same tools and knowledge base the Claude agent uses.
import * as chrono from "chrono-node";
import { SUBURBS } from "../config";
import type { AgentResult, AgentState, Block } from "../types";
import { fmtDate, money, todayISO } from "../util";
import {
  type ToolCtx,
  cancelBookingTool,
  checkAvailability,
  customerBookings,
  escalate,
  getQuote,
  holdAndLink,
  lookupBooking,
} from "./tools";

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

function parseDate(text: string, now: Date, refDate?: string): string | undefined {
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

function parseBlock(t: string): Block | undefined {
  if (/\b(4|four)\s*(h|hr|hrs|hour|hours)\b|half[\s-]?day|morning|arvo only/.test(t)) return 4;
  if (/\b(8|eight)\s*(h|hr|hrs|hour|hours)\b|full[\s-]?day|all day|wedding/.test(t)) return 8;
  return undefined;
}

function parseSuburb(t: string): string | undefined {
  const hit = [...SUBURBS].sort((a, b) => b.name.length - a.name.length).find((s) => t.includes(s.name.toLowerCase()));
  if (hit) return hit.name;
  if (t.includes("swan valley")) return "Henley Brook";
  if (t.includes("freo")) return "Fremantle";
  if (t.includes("mandurah") || t.includes("mandjoogoordap")) return "Mandurah";
  return undefined;
}

const OUT_OF_AREA = /margaret river|busselton|bunbury|dunsborough|albany|northam|york|geraldton|kalgoorlie|broome|esperance/;

export function runRules(ctx: ToolCtx, text: string, prev: AgentState): AgentResult {
  const t = text.toLowerCase().trim();
  const s = ctx.data.settings;
  const state: AgentState = { ...prev };
  const out = (reply: string): AgentResult => ({ reply, actions: ctx.actions, tools: ctx.used, state, engine: "rules" });

  // 1. A person, please.
  if (has(t, /\b(human|person|real person|someone|staff|owner|manager|call me|ring me)\b/)) {
    escalate(ctx, `Customer asked for a person: "${text.slice(0, 120)}"`);
    return out("No worries. I've passed this to one of the owners and they'll get back to you today. Anything I can sort in the meantime?");
  }

  // Discounts, multi-day and sponsorship are owner decisions.
  if (has(t, /\b(discount|cheaper|deal|mates? rates?|sponsor|sponsorship|multi[- ]day|two days|three days|3 days|2 days|weekend rate)\b/)) {
    escalate(ctx, `Wants something outside standard pricing: "${text.slice(0, 140)}"`);
    return out("That one's up to the owners, so I've passed it on with your message. Someone will get back to you today.");
  }

  // 2. Pending confirmations.
  if (state.awaiting === "confirm_cancel" && state.bookingId) {
    if (has(t, /\b(yes|yep|confirm|cancel it|do it)\b/)) {
      const r = cancelBookingTool(ctx, state.bookingId, true);
      state.awaiting = undefined;
      if (!r.ok) return out("That one needs an owner to sign off on the refund. I've flagged it and someone will confirm today.");
      return out(`Done. ${r.ref} is cancelled.${r.refund > 0 ? ` ${money(r.refund)} is on its way back to your card (3–5 business days).` : ""}`);
    }
    if (has(t, /\b(no|nah|keep|don't)\b/)) {
      state.awaiting = undefined;
      return out("All good, your booking stays as is.");
    }
  }

  // 3. Cancellation.
  if (has(t, /\bcancel/)) {
    const bs = customerBookings(ctx);
    if (!bs.length) return out("I can't find an upcoming booking for this number. What's the booking reference (starts with SST-)?");
    const b = bs[0];
    const r = cancelBookingTool(ctx, b.id, false);
    state.bookingId = b.id;
    state.awaiting = "confirm_cancel";
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
  if (has(t, /\b(my booking|our booking|booking status|balance|when do i pay|have i paid|reference|sst-\d+)/)) {
    const bs = lookupBooking(ctx);
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
  if (OUT_OF_AREA.test(t)) {
    return out(`Sorry, we only go as far as Two Rocks in the north and Mandurah in the south for now. Anywhere in Perth metro, the Hills or the Swan Valley is fine.`);
  }
  if (date) state.date = date;
  if (block) state.block = block;
  if (suburb) state.suburb = suburb;
  if (state.awaiting === "name" && !date && !suburb && t.length < 60 && !t.includes("?")) {
    state.name = text.trim().replace(/^(it's|its|i'm|im|name is|under)\s+/i, "");
    state.awaiting = undefined;
  }

  const wantsBook = has(t, /\b(book|hold|lock it in|yes|yep|yeah|go ahead|send (me )?(the )?link|deposit|let's do it|sounds good)\b/);
  const bookingContext = !!(date || block || suburb || prev.awaiting || wantsBook);
  const faq = matchFaq(t);

  if (faq && !date && !suburb && !(wantsBook && state.date)) return out(faq(ctx));

  if (bookingContext && (state.date || wantsBook || prev.awaiting || block || suburb)) {
    if (!state.date) {
      state.awaiting = "date";
      const q = state.suburb ? getQuote(ctx, state.block ?? 8, state.suburb) : null;
      if (q?.inArea && state.block) {
        return out(`${state.block} hours in ${q.suburb} is ${money(q.total)}, delivered and collected${q.travelFee ? ` (incl. ${money(q.travelFee)} travel)` : ""}. Which date are you after?`);
      }
      return out("Which date are you thinking? You can just say something like \"Sat 14 March\".");
    }
    const av = checkAvailability(ctx, state.date);
    if (!av.free) {
      const alts = av.alternatives.map((a) => fmtDate(a, { dow: true })).join(", ");
      const why = av.status === "past" ? "has already passed" : av.status === "too_far" ? `is more than ${s.bookAheadMonths} months out` : "is already booked";
      state.refDate = state.date;
      state.date = undefined;
      state.awaiting = "date";
      return out(`Sorry, ${av.label} ${why}.${alts ? ` The next free weekend days are ${alts}.` : ""}`);
    }
    if (!state.suburb) {
      state.awaiting = "suburb";
      if (prev.awaiting === "suburb") return out("Which suburb is the event in?");
      return out(`${av.label} is free! Which suburb is the event in? Half day (4h) is ${money(s.price4)}, full day (8h) is ${money(s.price8)}, delivered.`);
    }
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
    if (!state.name && !ctx.customerName) {
      state.awaiting = "name";
      return out(`Perfect: ${av.label}, ${state.block} hours in ${q.suburb}, ${money(q.total)} all in. What name should I put the booking under?`);
    }
    if (state.awaiting !== "confirm_hold" && !wantsBook) {
      state.awaiting = "confirm_hold";
      return out(`${av.label}, ${state.block} hours in ${q.suburb}: ${money(q.total)} incl. delivery and glassware. A ${money(q.deposit)} deposit holds it. Want the link?`);
    }
    const h = holdAndLink(ctx, state.date, state.block, q.suburb, state.name ?? ctx.customerName ?? "Guest");
    if (!h.ok) return out(`Ah, ${h.reason} Want me to suggest another date?`);
    const summary = `${h.ref}: ${av.label}, ${state.block}h in ${q.suburb}`;
    Object.assign(state, { awaiting: undefined, date: undefined, block: undefined, suburb: undefined });
    return out(`Done, I've held it for ${h.holdMinutes} minutes. ${summary}. ${h.dueNow < h.total ? `Pay the ${money(h.dueNow)} deposit here: ${h.link}\nThe balance comes off the same card ${s.balanceDaysBefore} days before.` : `It's close, so it's paid in full (${money(h.dueNow)}) here: ${h.link}`}`);
  }

  if (faq) return out(faq(ctx));

  if (has(t, /^(hi|hey|hello|g'day|gday|yo|morning|evening)\b/)) {
    return out("Hey! I'm the Sunrise Sunset booking agent. I can check dates, give you a price, hold a date and answer keg questions. What's the event?");
  }
  if (has(t, /\b(thanks|thank you|cheers|legend|ta)\b/)) return out("Cheers! Text any time.");

  escalate(ctx, `Agent couldn't answer: "${text.slice(0, 160)}"`);
  return out("Good question. I'm not sure, so I've asked one of the owners to reply. They usually do within a few hours.");
}

type Faq = (ctx: ToolCtx) => string;

function matchFaq(t: string): Faq | null {
  const s = (ctx: ToolCtx) => ctx.data.settings;
  if (has(t, /\b(coupler|s-type|a-type|g-type|keg|kegs|litre|liter|50l|30l|20l|how many beers|how much beer)\b/))
    return () => "We carry S-type couplers (most Aussie beers like Gage Roads, Little Creatures, Feral), plus A and G types. Kegs need to be cold before they go in, so pick them up the day before. A 50L keg pours about 100 pints. The truck takes up to 4 × 50L, 6 × 30L or 10 × 20L.";
  if (has(t, /\b(price|cost|how much|rates?|quote|pricing)\b/))
    return (c) => `Half day (4h) is ${money(s(c).price4)} and full day (8h) is ${money(s(c).price8)}. Both include delivery within an hour of North Perth, setup, glassware and pickup. A ${money(s(c).deposit)} deposit holds the date. Which date are you after?`;
  if (has(t, /\b(rsa|licen[cs]e|liquor|bartender|serve alcohol)\b/))
    return () => "We're a dry hire, so you supply the drinks and we don't sell alcohol. Private events with free drinks usually need no licence. If you're selling drinks, you may need an occasional liquor licence (apply 14+ days ahead). Lots of venues want RSA staff, so check with yours.";
  if (has(t, /\b(supply|provide|bring) (the )?(beer|drinks|alcohol)|do you (sell|supply)|byo\b/))
    return () => "You bring the drinks. Buy kegs anywhere at wholesale and we hook them up. Happy to recommend breweries or distributors.";
  if (has(t, /\b(power|generator|electricity|plug)\b/))
    return () => "No mains power needed. The fridge runs off the truck. We just need flat, firm ground to park on.";
  if (has(t, /\b(glass|glasses|cups|glassware)\b/))
    return () => "Glassware is included: 120 pint and 60 schooner glasses, plus a glass rinser on the truck.";
  if (has(t, /\b(bond|damage|deposit back)\b/))
    return (c) => `A ${money(s(c).bond)} bond is held on your card ${s(c).bondHoldDaysBefore} days before and released after the truck comes back clean and undamaged.`;
  if (has(t, /\b(how far|travel|deliver|where do you go|service area)\b/))
    return (c) => `Perth metro, the Hills and the Swan Valley, from Two Rocks down to Mandurah. Free delivery within ${s(c).travelThresholdMin} minutes of North Perth, ${money(s(c).travelFee)} beyond that.`;
  if (has(t, /\b(staff|bartend|serve|stay)\b/))
    return () => "No staff stay. We deliver, connect and test every line, show a host how to swap a keg, then come back to collect.";
  if (has(t, /\b(coffee|cold brew|nitro|filament)\b/))
    return () => "Yes! Nitro cold brew from Filament Coffee pours on its own nitro line. 19L kegs, ordered direct from Filament. It's great for morning events.";
  if (has(t, /\b(size|fit|gate|dimensions|access|how big)\b/))
    return () => "It's a tiny kei truck, about 3.4m long and 1.5m wide, so it fits most driveways and garden gates. It needs firm, flat ground.";
  return null;
}
