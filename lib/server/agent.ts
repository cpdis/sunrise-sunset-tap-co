// The agent's turn, applied on the server by the agentReply command. Until U9 runs the agent here, the result comes
// from the browser, so it is parsed like any other input and each action is checked again against the stored data:
// a customer's conversation only holds and cancels its own sender's dates and never takes an owner action.
import { findSuburb } from "@/lib/config";
import { cancelBooking, cancelNeedsOwner, cancelPolicy, createHold, holdExpired } from "@/lib/domain";
import * as ops from "@/lib/ops";
import type { AgentAction, AgentResult, AgentState, Conversation, Data } from "@/lib/types";
import { sameContact, uid } from "@/lib/util";
import { CHANNELS, type Raw, bad, date, flag, id, isObj, match, maybeText, obj, oneOf, text } from "./args";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

function agentAction(x: unknown): AgentAction {
  if (!isObj(x)) return bad("action");
  switch (x.type) {
    case "hold":
      return {
        type: "hold",
        bookingId: id(x, "bookingId"),
        ref: match(x, "ref", /^SST-\d{1,7}$/),
        date: date(x, "date"),
        block: oneOf(x, "block", [4, 8] as const),
        startTime: maybeText(x, "startTime", 5),
        suburb: text(x, "suburb", 60),
        name: text(x, "name", 80),
        contact: text(x, "contact", 120),
        channel: oneOf(x, "channel", CHANNELS),
        token: match(x, "token", TOKEN),
      };
    case "cancel":
      return { type: "cancel", bookingId: id(x, "bookingId") };
    case "escalate":
      return { type: "escalate", reason: text(x, "reason", 300), keepAgent: flag(x, "keepAgent"), draft: maybeText(x, "draft", 2000) };
    case "claim_run": case "truck_log": case "expense": case "approve_payout": case "pay_payout": case "settings":
    case "kb_append": case "blackout": case "own_use": case "owner_reply": case "hand_back": case "send_draft":
      // Owner actions apply only on an owner's conversation, for a signed-in owner, and ops re-checks each one.
      return x as AgentAction;
    default:
      return bad("action type");
  }
}

export function agentResult(r: Raw): AgentResult {
  const tools = Array.isArray(r.tools) && r.tools.length <= 30 && r.tools.every((t) => typeof t === "string" && t.length <= 80) ? (r.tools as string[]) : bad("tools");
  const actions = Array.isArray(r.actions) && r.actions.length <= 10 ? r.actions.map(agentAction) : bad("actions");
  return { reply: text(r, "reply", 4000), tools, actions, state: obj(r, "state") as AgentState, engine: r.engine === "claude" ? "claude" : "rules" };
}

const sameAs = (d: Data, customerId: string | undefined, contact: string) =>
  d.customers.some((cu) => cu.id === customerId && (sameContact(cu.phone, contact) || sameContact(cu.email, contact)));

function hold(d: Data, c: Conversation, a: Extract<AgentAction, { type: "hold" }>, now: Date) {
  const refuse = (why: string) => {
    // The link the agent sent won't open, so the owners take it.
    c.escalated = `Hold ${a.ref} for ${a.name} refused: ${why}`;
    c.messages.push({ id: uid("m"), from: "system", body: `Hold refused: ${why}`, at: now.toISOString() });
    ops.log(d, `Agent hold ${a.ref} refused: ${why}`);
  };
  const n = Number(a.ref.slice(4));
  if (a.contact !== c.contact || a.channel !== c.channel) return refuse("it was for another contact");
  if (!findSuburb(a.suburb)) return refuse(`${a.suburb} is outside the service area`);
  if (d.bookings.some((b) => b.id === a.bookingId || b.ref === a.ref) || n > d.seq + 10) return refuse(`${a.ref} was just given to another booking`);
  // One contact holds one unpaid date at a time (R13), whichever surface asked.
  if (d.bookings.some((b) => b.state === "held" && !holdExpired(b, now) && sameAs(d, b.customerId, c.contact))) return refuse("this contact already holds an unpaid date");
  const isEmail = c.contact.includes("@");
  let b;
  try {
    b = createHold(d, { id: a.bookingId, ref: a.ref, token: a.token, date: a.date, block: a.block, startTime: a.startTime, suburb: a.suburb, name: a.name, phone: isEmail ? undefined : c.contact, email: isEmail ? c.contact : undefined, via: c.channel }, now);
  } catch (err) {
    return refuse((err as Error).message);
  }
  d.seq = Math.max(d.seq, n);
  c.customerId = b.customerId;
  if (c.name.startsWith("Caller") || c.name === "New contact") c.name = a.name;
  ops.log(d, `Agent held ${b.ref} for ${a.name} via ${c.channel}`);
}

function cancel(d: Data, c: Conversation, bookingId: string, now: Date) {
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b) return;
  // An owner by SMS cancels up to the refund limit; a customer only their own booking, and never past it (R3, R11).
  const refused = c.ownerId
    ? b.kind !== "paid" || cancelPolicy(d.settings, b, now).refund > d.settings.refundLimit
    : !sameAs(d, b.customerId, c.contact) || !!cancelNeedsOwner(d.settings, b, now);
  if (refused) return ops.log(d, `Cancel of ${b.ref} from ${c.name}'s conversation refused`);
  const pol = cancelBooking(d, b.id, now);
  if (pol) ops.log(d, `${c.ownerId ? `${c.name} cancelled ${b.ref} by SMS` : `Agent cancelled ${b.ref}`}; refunded $${pol.refund}`);
}

function escalate(d: Data, c: Conversation, a: Extract<AgentAction, { type: "escalate" }>, now: Date) {
  if (c.escalated && !c.agentActive) return;
  const repeat = c.escalated === a.reason;
  c.escalated = a.reason;
  if (!a.keepAgent) c.agentActive = false;
  if (a.draft) c.draft = a.draft;
  // The reason stays in the thread after an owner replies and the flag clears. Written once per reason.
  if (!repeat) c.messages.push({ id: uid("m"), from: "system", body: `Agent handed over: ${a.reason}`, at: now.toISOString() });
  ops.log(d, `Escalated to owners: ${a.reason}`);
}

export function applyAgentResult(d: Data, c: Conversation, r: AgentResult, now = new Date()) {
  // An owner who took the conversation answers alone: the agent books and cancels nothing.
  const ownerHolds = !c.agentActive;
  // The reply goes in first so a hand-over row reads after what the agent told the customer.
  c.messages.push({ id: uid("m"), from: "agent", body: r.reply, at: now.toISOString(), tools: r.tools });
  for (const a of r.actions) {
    if (a.type === "hold") {
      if (!c.ownerId && !ownerHolds) hold(d, c, a, now);
    } else if (a.type === "cancel") {
      if (!ownerHolds) cancel(d, c, a.bookingId, now);
    } else if (a.type === "escalate") {
      if (!c.ownerId) escalate(d, c, a, now);
    } else if (c.ownerId) {
      ops.applyOwnerAction(d, a, c.ownerId);
    }
  }
  c.state = r.state;
}
