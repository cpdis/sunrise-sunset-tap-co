// The explainer's diagrams. Prices and rules come in from settings, so a card never states an old number.
import type { SketchConfig } from "@/components/story/Sketch";
import type { Settings } from "@/lib/types";
import { money } from "@/lib/util";

// The same diagram, zoomed on one part: those cards and lines lit, the rest dimmed.
function focus(base: SketchConfig, id: string, nodes: string[], edges: string[]): SketchConfig {
  return { ...base, id, flows: undefined, focus: { nodes, edges } };
}

export function diagrams(s: Settings, owners: number) {
  const wired: SketchConfig = {
    id: "wired",
    h: 560,
    mh: 660,
    mw: 100,
    nodes: [
      { id: "cust", t: "Customer", s: "text, email, call, web", at: [0.14, 60], note: "Anyone planning a party. They reach one number and one email. There is no web chat." },
      { id: "agent", t: "Booking agent", s: "answers every channel", hub: true, at: [0.5, 60], note: "Quotes, checks the calendar, holds a date and sends the deposit link. Hands anything odd to an owner." },
      { id: "inbox", t: "Owners' inbox", s: "what needs a person", at: [0.86, 60], note: "Every conversation on every channel, sorted by who owes the next move." },
      { id: "site", t: "Website", s: "calendar and Book", at: [0.14, 200], note: "The same calendar the agent sees. A web booking takes the same deposit." },
      { id: "cal", t: "Calendar", s: "one hire a day", at: [0.5, 200], note: `${s.minNoticeDays} days notice, up to ${s.bookAheadMonths} months ahead. A paid booking bumps an owner's own use.` },
      { id: "owners", t: `${owners} owners`, s: "runs and approvals", at: [0.86, 200], note: "Nobody is staff. Owners claim runs, clean lines and approve payouts." },
      { id: "pay", t: "Checkout", s: "deposit, balance, bond", at: [0.14, 340], note: `${money(s.deposit)} now, the rest ${s.balanceDaysBefore} days out, a ${money(s.bond)} bond hold ${s.bondHoldDaysBefore} days out. Stripe in production, simulated here.` },
      { id: "jobs", t: "Scheduled jobs", s: "every minute", at: [0.5, 340], note: "Expire unpaid holds, charge balances, retry declines, place bonds, close hires, post depreciation." },
      { id: "ownagent", t: "Owner agent", s: "texts from owners", at: [0.86, 340], note: "An owner texts the business line and gets the admin by SMS. Money moves wait for YES." },
      { id: "ledger", t: "Ledger", s: "every dollar posted", at: [0.14, 480], note: "Customer money is held as a liability until the hire happens. Then it is revenue." },
      { id: "payout", t: "Quarterly payout", s: `${s.approvalsRequired} directors approve`, at: [0.5, 480], note: "Profit after tax and a reserve, split equally, plus each owner's runner fees." },
    ],
    edges: [
      { f: "cust", t: "agent", l: "a text" },
      { f: "cust", t: "site", l: "web" },
      { f: "agent", t: "cal", l: "check, hold" },
      { f: "site", t: "cal" },
      { f: "agent", t: "inbox", l: "hand-over", dash: true },
      { f: "inbox", t: "owners" },
      { f: "cal", t: "pay", l: "pay link" },
      { f: "jobs", t: "pay", l: "balance, bond" },
      { f: "pay", t: "ledger" },
      { f: "owners", t: "ownagent", l: "a text" },
      { f: "ownagent", t: "payout", l: "YES" },
      { f: "ledger", t: "payout", l: "quarterly" },
    ],
    flows: [
      {
        label: "A booking",
        steps: [
          { say: "Sam texts: is the second Saturday in December free?", go: ["cust", "agent"], tag: "Sat 12 Dec?" },
          { say: `The agent checks the calendar and holds the date for ${s.holdMinutes} minutes.`, go: ["agent", "cal"], tag: "free" },
          { say: `It texts a link. Sam pays the ${money(s.deposit)} deposit.`, go: ["cal", "pay"], tag: money(s.deposit) },
          { say: "The deposit goes in the ledger as money held for Sam, not as revenue.", go: ["pay", "ledger"], tag: "held" },
        ],
      },
      {
        label: "A hand-over",
        steps: [
          { say: "Harbour Collective asks for a three-day festival rate.", go: ["cust", "agent"], tag: "3 days?" },
          { say: "Not a standard price, so the agent hands it to the owners with a draft reply.", go: ["agent", "inbox"], tag: "needs you" },
          { say: "Every owner sees it at the top of the inbox.", go: ["inbox", "owners"] },
          { say: "Colin texts: send the draft to Harbour. The agent quotes the draft and asks for YES.", go: ["owners", "ownagent"], tag: "send the draft" },
          { say: "Colin replies YES. The email goes out, and the agent stays off this thread until someone hands it back.", wait: 1400, at: "ownagent", tag: "YES" },
        ],
      },
      {
        label: "Payday",
        steps: [
          { say: "A quarter closes. The system proposes a payout from the ledger.", go: ["ledger", "payout"], tag: "proposal" },
          { say: `Directors approve by text or in the admin. It needs ${s.approvalsRequired}.`, go: ["owners", "ownagent", "payout"], tag: "approve" },
          { say: "Then one owner pays it. Dividends and runner fees go out in one bank transfer each.", go: ["payout", "owners"], tag: "paid" },
        ],
      },
    ],
  };

  const agent: SketchConfig = {
    id: "agent",
    h: 470,
    mh: 554,
    mw: 100,
    nodes: [
      { id: "msg", t: "A message", s: "SMS, email, call, form", at: [0.14, 60], note: "Phone calls arrive as transcripts. Every channel goes through the same agent." },
      { id: "kb", t: "Knowledge", s: "pages owners edit", at: [0.86, 60], note: "Prices, keg guide, licensing, the truck, policies. Prices are filled in from settings on every message." },
      { id: "agent", t: "Agent", s: "Claude, or the rules engine", hub: true, at: [0.5, 60], note: "With an API key it is Claude. Without one, a rules engine runs the same tools. Both must change together." },
      { id: "avail", t: "Check the date", at: [0.14, 220], w: 150, note: "Is the date free? If not, the next three free weekend days." },
      { id: "quote", t: "Quote", at: [0.5, 220], note: `Hire price, plus ${money(s.travelFee)} if the suburb is more than ${s.travelThresholdMin} minutes from the CBD.` },
      { id: "lookup", t: "Look up a booking", at: [0.86, 220], note: "Only bookings on the number or email that sent the message." },
      { id: "hold", t: "Hold + deposit link", at: [0.14, 370], w: 150, off: [1], note: `Holds the date for ${s.holdMinutes} minutes and texts the checkout link.` },
      { id: "cancel", t: "Cancel", at: [0.5, 370], off: [1], note: `Applies the refund rule. A refund over ${money(s.refundLimit)} goes to an owner instead.` },
      { id: "esc", t: "Hand to an owner", at: [0.86, 370], w: 150, note: "Flags the conversation with a reason and a draft reply the owner can send as it is." },
    ],
    edges: [
      { f: "msg", t: "agent" },
      { f: "kb", t: "agent" },
      { f: "agent", t: "avail" },
      { f: "agent", t: "quote" },
      { f: "agent", t: "lookup" },
      { f: "agent", t: "hold", off: [1] },
      { f: "agent", t: "cancel", off: [1] },
      { f: "agent", t: "esc" },
    ],
    steps: [
      { label: "Agent has it", say: "The agent can quote, hold, take a deposit and cancel within the refund limit." },
      { label: "Owner took over", say: "After a hand-over the agent still answers questions, but it will not hold or cancel until an owner hands back." },
    ],
  };

  const inbox: SketchConfig = {
    id: "inbox",
    h: 300,
    mh: 354,
    mw: 100,
    nodes: [
      { id: "agent", t: "Agent", s: "flags it", hub: true, at: [0.14, 60], note: "A hand-over carries a reason and, where it can, a draft reply." },
      { id: "needs", t: "Needs you", s: "reason and a draft", at: [0.5, 60], note: "Top of the inbox. The customer was told an owner will reply, so somebody must." },
      { id: "owner", t: "Any owner", s: "admin or a text", at: [0.86, 60], note: "Reply in the admin, edit the draft, or text the business line: send the draft to Harbour." },
      { id: "handling", t: "Owners handling", s: "agent answers FAQs only", at: [0.86, 220], note: "The agent stays on for questions about kegs, prices and the truck. It will not book or cancel." },
      { id: "back", t: "Hand back", s: "only after a reply", at: [0.5, 220], note: "Refused while the customer is owed a reply, unless the owner says anyway." },
      { id: "done", t: "Agent handled", s: "most threads", at: [0.14, 220], note: "Answered and booked with no owner involved." },
    ],
    edges: [
      { f: "agent", t: "needs", l: "hand-over" },
      { f: "needs", t: "owner" },
      { f: "owner", t: "handling", l: "reply" },
      { f: "handling", t: "back" },
      { f: "back", t: "done", l: "agent again" },
    ],
  };

  const money_: SketchConfig = {
    id: "money",
    h: 450,
    mh: 531,
    mw: 100,
    nodes: [
      { id: "card", t: "Customer's card", at: [0.14, 60], note: "Saved at checkout so the balance can be charged later without the customer." },
      { id: "held", t: "Payments held", s: "a liability", hub: true, at: [0.5, 60], note: "Deposits and balances for hires that haven't happened. Not ours to spend or pay out." },
      { id: "rev", t: "Revenue", s: "hire done or forfeited", at: [0.86, 60], note: `Recognised on the hire day, or when a deposit is kept after a cancellation inside ${s.cancelDays} days.` },
      { id: "costs", t: "Per-hire costs", s: "fuel, CO2, lines, glass", at: [0.14, 220], note: "Posted when the hire closes, along with the card fees taken at each charge." },
      { id: "runner", t: "Runner fees owed", s: `${money(s.runnerFee)} a leg`, at: [0.86, 220], note: "An expense now, a debt to the owner who drove, paid with the next quarterly payout." },
      { id: "profit", t: "Quarterly profit", at: [0.5, 220], note: "Revenue less costs, depreciation included. Capital and the truck purchase don't count." },
      { id: "keep", t: "Kept back", s: "tax, reserve, customer money", at: [0.5, 380], note: `A ${Math.round(s.taxRate * 100)}% tax provision, ${s.reserveMonths} months of fixed costs plus ${Math.round(s.maintPerKm * 100)}¢ a km, and all money held for future hires.` },
      { id: "owners", t: `${owners} owners`, s: "equal shares", at: [0.86, 380], note: "Each owner's share is rounded down to $10. Runner fees go in the same transfer." },
    ],
    edges: [
      { f: "card", t: "held", l: "deposit, balance" },
      { f: "held", t: "rev", l: "hire day" },
      { f: "rev", t: "profit" },
      { f: "costs", t: "profit", l: "less" },
      { f: "runner", t: "profit", l: "less" },
      { f: "profit", t: "keep" },
      { f: "keep", t: "owners", l: "the rest" },
      { f: "runner", t: "owners", l: "same transfer", dash: true },
    ],
  };

  const truck: SketchConfig = {
    id: "truck",
    h: 330,
    mh: 389,
    mw: 100,
    nodes: [
      { id: "cal", t: "Calendar", s: "paid beats own use", at: [0.14, 60], note: "One hire a day. Owners book their own use free when nobody has paid for the date, and pay their own fuel and damage." },
      { id: "base", t: "The truck", s: "Osborne Park or North Perth", hub: true, at: [0.5, 60], w: 150, note: "Kept at Filament Coffee in Osborne Park or at Rhys's place in North Perth." },
      { id: "out", t: "Delivery run", s: `claimed, ${money(s.runnerFee)}`, at: [0.86, 60], note: "Any owner claims it in the admin or by text. Drive, park, connect the kegs, chill and test the taps." },
      { id: "event", t: "The event", s: "the client pours", at: [0.86, 230], note: "Dry hire: the client buys the drinks and keeps the RSA duty. Taps close by 11 pm." },
      { id: "back", t: "Collection run", s: `claimed, ${money(s.runnerFee)}`, at: [0.5, 230], note: "Inspect the truck, clean the lines, bring it home. A clean return releases the bond." },
      { id: "log", t: "Truck log", s: "odometer, CO2, issues", at: [0.14, 230], note: "Logged in the admin or by text. A reading lower than the last one is refused." },
    ],
    edges: [
      { f: "cal", t: "base", l: "one a day" },
      { f: "base", t: "out" },
      { f: "out", t: "event", l: "set up" },
      { f: "event", t: "back" },
      { f: "back", t: "log" },
    ],
  };

  return {
    wired,
    booking: focus(wired, "w-booking", ["cust", "site", "cal", "pay", "jobs"], ["cust>site", "site>cal", "cal>pay", "jobs>pay"]),
    agentFocus: focus(wired, "w-agent", ["cust", "agent", "cal", "inbox"], ["cust>agent", "agent>cal", "agent>inbox"]),
    agent,
    inbox,
    owners: focus(wired, "w-owners", ["owners", "ownagent", "payout", "inbox"], ["inbox>owners", "owners>ownagent", "ownagent>payout"]),
    money: money_,
    truck,
  };
}
