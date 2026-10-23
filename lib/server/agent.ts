// The agent's turn, on the server (R14, KTD10). The browser sends only the message and which conversation it is
// for. The server stores the message, loads the data, the knowledge base, the owners and the conversation with its
// state, and runs the agent (Claude, or the rules engine without a key) on that snapshot outside any write. Its
// reply and actions then apply in one short repo.mutate that checks them again against the stored data: an owner
// taking over, another message or turn landing, a booking that changed, or a refund that is no longer the one
// confirmed. A version conflict in that write runs the apply again, never the model.
import Anthropic from "@anthropic-ai/sdk";
import { runClaude } from "@/lib/agent/claude";
import { runOwnerClaude } from "@/lib/agent/owner-claude";
import { runOwnerRules } from "@/lib/agent/owner-rules";
import type { OwnerCtx } from "@/lib/agent/owner-tools";
import { runRules } from "@/lib/agent/rules";
import type { ToolCtx } from "@/lib/agent/tools";
import { findSuburb } from "@/lib/config";
import { cancelBooking, cancelNeedsOwner, cancelPolicy, createHold, holdExpired } from "@/lib/domain";
import * as ops from "@/lib/ops";
import type { AgentAction, AgentResult, AgentState, Conversation, Data, KbPage, Msg, PendingApproval } from "@/lib/types";
import { canon, sameContact, uid } from "@/lib/util";
import { type ChatView, chatView, ownerByContact, ownerHolds, ownerSnapshot, snapshot } from "@/lib/views";
import { pendingApproval, settleApprovals } from "./approvals";
import { CommandError, type Raw, bad, isObj, maybeText, oneOf, text } from "./args";
import type { Caller } from "./commands";
import type { ApprovalRow, ApprovalWrites, Repo } from "./db/repo";

// What the model reads, bounded by the stored data rather than by the request: the last HISTORY messages, each cut
// to MESSAGE_CHARS, and the knowledge base cut to KB_CHARS in all.
const HISTORY = 30;
const MESSAGE_CHARS = 1000;
export const KB_CHARS = 60_000;
export const BODY_CHARS = 2000;

// One inbound message: its channel, its sender and what it says. The message goes in the sender's conversation on
// that channel, made if new. The caller vouches for the sender: a signed webhook, or the demo simulator
// (lib/server/inbound.ts).
export interface TurnInput {
  channel: Conversation["channel"];
  contact: string;
  name?: string;
  body: string;
}

export interface TurnOptions {
  // This site's origin, for the checkout links the agent sends.
  origin: string;
  // The model client. Left out, it is made from the environment when ANTHROPIC_API_KEY is set; otherwise the rules
  // engine answers. Tests pass a scripted one.
  client?: Anthropic;
  // The business is over its daily model budget (lib/server/limits.ts): the rules engine answers.
  rulesOnly?: boolean;
  // Called with the tokens a turn's model calls spent.
  onTokens?: (tokens: number) => Promise<void>;
}

export interface TurnOutput {
  conversation: ChatView;
  // Which engine answered, or undefined when the agent did not answer (an owner has the conversation).
  engine?: AgentResult["engine"];
}

// ---------- 1. the message goes in ----------

function receive(d: Data, input: TurnInput, now: Date) {
  let c = d.conversations.find((x) => x.contact === input.contact && x.channel === input.channel);
  if (!c) {
    // An owner's own number gets the owner agent. Caller ID proves nothing, so its changes wait for a YES with the
    // nonce sent to that number, and the risky ones also for the code on the owner's admin page (KTD6).
    const owner = ownerByContact(d, input.contact);
    c = { id: uid("conv"), channel: input.channel, contact: input.contact, name: owner?.name ?? input.name ?? "New contact", ...(owner && { ownerId: owner.id }), agentActive: true, unread: !owner, state: {}, messages: [] };
    d.conversations.unshift(c);
  }
  c.messages.push({ id: uid("m"), from: "customer", body: input.body, at: now.toISOString() });
  c.unread = !c.ownerId;
  return c.id;
}

// ---------- 2. the turn, outside any write ----------

// Pages in order until KB_CHARS, the last one cut to fit.
export function boundKb(kb: KbPage[]): KbPage[] {
  let room = KB_CHARS;
  const out: KbPage[] = [];
  for (const p of kb) {
    if (room <= 0) break;
    out.push({ ...p, body: p.body.slice(0, room) });
    room -= p.body.length;
  }
  return out;
}

// What the turn read of its conversation. The result applies only if this is unchanged: no newer message, no owner
// taking over or handing back, no other turn's state (such as a customer's cancel quote a concurrent YES already used).
const mark = (c: Conversation) => canon([c.messages.at(-1)?.id, c.agentActive, c.escalated ?? null, c.handledBy ?? null, c.state]);

interface Turn {
  convId: string;
  mark: string;
  run(client?: Anthropic, rulesOnly?: boolean): Promise<AgentResult>;
}

// The agent for this conversation, on what the server stored. Undefined when the agent doesn't answer.
// pending: an owner conversation's staged approval (lib/server/approvals.ts).
function prepare(d: Data, c: Conversation, now: Date, origin: string, pending?: PendingApproval): Turn | undefined {
  if (ownerHolds(c)) return undefined;
  const history = c.messages.slice(-HISTORY).map((m) => ({ ...m, body: m.body.slice(0, MESSAGE_CHARS) }));
  const last = history.at(-1)?.body ?? "";
  // Each engine gets a fresh state and context, so a Claude failure leaves nothing behind for the fallback.
  const state = () => structuredClone(c.state ?? {});
  const kb = boundKb(d.kb);
  const base = { convId: c.id, mark: mark(c) };
  if (c.ownerId) {
    const owner = d.owners.find((o) => o.id === c.ownerId);
    if (!owner) return undefined;
    const data = { ...ownerSnapshot(d, now), kb };
    const ctx = (): OwnerCtx => ({ data, owner, now, actions: [], used: [], pending });
    return { ...base, run: (client, rulesOnly) => engine(client, rulesOnly, (cl) => runOwnerClaude(ctx(), history, cl), () => runOwnerRules(ctx(), last)) };
  }
  const data = { ...snapshot(d, c.contact), kb };
  const ctx = (): ToolCtx => ({
    data,
    contact: c.contact,
    channel: c.channel,
    customerName: c.name && !/^(Caller|New contact)/.test(c.name) ? c.name : undefined,
    now,
    actions: [],
    used: [],
    origin,
    handover: !!c.escalated && !c.agentActive,
  });
  return { ...base, run: (client, rulesOnly) => engine(client, rulesOnly, (cl) => runClaude(ctx(), history, state(), cl), () => runRules(ctx(), last, state())) };
}

async function engine(client: Anthropic | undefined, rulesOnly: boolean | undefined, claude: (c: Anthropic) => Promise<AgentResult>, rules: () => AgentResult) {
  const cl = rulesOnly ? undefined : (client ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined));
  if (cl) {
    try {
      return await claude(cl);
    } catch (err) {
      console.error("Claude agent failed, falling back to rules", err);
    }
  }
  return rules();
}

// ---------- 3. the result applies, checked again ----------

const sameAs = (d: Data, customerId: string | undefined, contact: string) =>
  d.customers.some((cu) => cu.id === customerId && (sameContact(cu.phone, contact) || sameContact(cu.email, contact)));

// A hold for the conversation's own sender. Returns why it was refused, or undefined when it held.
function hold(d: Data, c: Conversation, a: Extract<AgentAction, { type: "hold" }>, now: Date): string | undefined {
  const refuse = (why: string) => {
    // The link the agent sent won't open, so the owners take it.
    c.escalated = `Hold ${a.ref} for ${a.name} refused: ${why}`;
    ops.send(d, { kind: "escalation", convId: c.id, reason: c.escalated });
    c.messages.push({ id: uid("m"), from: "system", body: `Hold refused: ${why}`, at: now.toISOString() });
    ops.log(d, `Agent hold ${a.ref} refused: ${why}`);
    return why;
  };
  const n = Number(a.ref.slice(4));
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

// A cancel on the terms that were confirmed. Returns the booking's ref when it was refused, or undefined.
function cancel(d: Data, c: Conversation, a: Extract<AgentAction, { type: "cancel" }>, now: Date): string | undefined {
  const b = d.bookings.find((x) => x.id === a.bookingId);
  if (!b) return "that booking";
  const pol = cancelPolicy(d.settings, b, now);
  // An owner by SMS cancels up to the refund limit; a customer only their own booking, and never past it (R3, R11).
  // Either way the refund must still be the one confirmed: a balance paid since then changes it.
  const refused =
    b.state === "cancelled" || b.state === "completed" || pol.refund !== a.refund ||
    (c.ownerId ? b.kind !== "paid" || pol.refund > d.settings.refundLimit : !sameAs(d, b.customerId, c.contact) || !!cancelNeedsOwner(d.settings, b, now));
  if (refused) {
    ops.log(d, `Cancel of ${b.ref} from ${c.name}'s conversation refused`);
    return b.ref;
  }
  cancelBooking(d, b.id, now);
  ops.log(d, `${c.ownerId ? `${c.name} cancelled ${b.ref} by SMS` : `Agent cancelled ${b.ref}`}; refunded $${pol.refund}`);
}

function escalate(d: Data, c: Conversation, a: Extract<AgentAction, { type: "escalate" }>, now: Date) {
  if (c.escalated && !c.agentActive) return;
  const repeat = c.escalated === a.reason;
  c.escalated = a.reason;
  if (!a.keepAgent) c.agentActive = false;
  if (a.draft) c.draft = a.draft;
  // The reason stays in the thread after an owner replies and the flag clears, and the owners get one notice
  // (lib/server/outbox.ts). Both once per reason.
  if (!repeat) {
    c.messages.push({ id: uid("m"), from: "system", body: `Agent handed over: ${a.reason}`, at: now.toISOString() });
    ops.send(d, { kind: "escalation", convId: c.id, reason: a.reason });
  }
  ops.log(d, `Escalated to owners: ${a.reason}`);
}

// Applies a turn's result to the stored data, with the approval writes an owner's turn makes (staged: the
// conversation's staged approvals as they are now). Synchronous and repeatable, as repo.mutateApprovals needs
// (KTD10).
function applyTurn(d: Data, t: Pick<Turn, "convId" | "mark">, r: AgentResult, now: Date, staged: ApprovalRow[]): { value: boolean; writes?: ApprovalWrites } {
  const c = d.conversations.find((x) => x.id === t.convId);
  const owner = c?.ownerId ? d.owners.find((o) => o.id === c.ownerId) : undefined;
  if (!c || mark(c) !== t.mark || (c.ownerId && !owner)) {
    // An owner took over, another message came in, or another turn answered first. This answer is out of date, so
    // none of it applies; the message waits for the owners or the newer turn.
    ops.log(d, `Agent reply to ${c?.name ?? "a conversation"} dropped: the conversation changed while the agent was answering`);
    return { value: false };
  }
  // The reply goes in first so a hand-over row reads after what the agent told the customer.
  const reply: Msg = { id: uid("m"), from: "agent", body: r.reply, at: now.toISOString(), tools: r.tools };
  c.messages.push(reply);
  // An owner's YES runs only if its approval still holds as this write sees the data (KTD4). If not, nothing of
  // the turn applies and the reply says what happened instead of "Done" (R4).
  const settled = owner ? settleApprovals(d, owner, r.approval, staged, now) : undefined;
  if (settled?.refused) {
    reply.body = settled.refused;
    c.state = structuredClone(r.state);
    return { value: true, writes: settled.writes };
  }
  for (const a of r.actions) {
    // After a hand-over the agent books and cancels nothing (its tools refuse too).
    if ((a.type === "hold" || a.type === "cancel") && !c.agentActive) continue;
    // A refused hold or cancel makes the reply wrong, so it says what really happened instead (R4).
    if (a.type === "hold") {
      if (!c.ownerId && hold(d, c, a, now)) reply.body = "Sorry, something changed while I was holding that date, so nothing is held and that link won't work. I've passed it to the owners.";
    } else if (a.type === "cancel") {
      const ref = cancel(d, c, a, now);
      if (ref) reply.body = c.ownerId ? `I didn't cancel ${ref}: it changed since you confirmed. Send it again if you still want it cancelled.` : `Sorry, something changed on ${ref} while I was on it, so I haven't cancelled it. Text "cancel ${ref}" to see where it stands.`;
    } else if (a.type === "escalate") {
      if (!c.ownerId) escalate(d, c, a, now);
    } else if (c.ownerId) {
      ops.applyOwnerAction(d, a, c.ownerId);
    }
  }
  c.state = structuredClone(r.state);
  return { value: true, writes: settled?.writes };
}

// ---------- the turn ----------

function mutateFailed(r: { ok: false; reason: "conflict" | "not_found" }): never {
  throw r.reason === "not_found" ? new CommandError(404, "No such business.") : new CommandError(409, "Too many changes at once. Try again.");
}

// The conversation after a write. A demo reset in between removes it.
function find(d: Data, convId: string) {
  const c = d.conversations.find((x) => x.id === convId);
  if (!c) throw new CommandError(404, "No such conversation.");
  return c;
}

// One inbound message and the agent's answer to it. The business comes from the number or address it was sent to.
export async function agentTurn(repo: Repo, caller: Pick<Caller, "tenant" | "now">, input: TurnInput, opts: TurnOptions): Promise<TurnOutput> {
  const now = caller.now ?? new Date();
  // The message is stored first, so it stays for the owners even if the agent fails.
  const got = await repo.mutate(caller.tenant, (d) => receive(d, input, now));
  if (!got.ok) mutateFailed(got);
  const convId = got.value;
  const c = find(got.data, convId);
  const pending = c.ownerId ? await pendingApproval(repo, caller.tenant, convId, now) : undefined;
  const turn = prepare(got.data, c, now, opts.origin, pending);
  if (!turn) return { conversation: chatView(c) };
  const result = await turn.run(opts.client, opts.rulesOnly);
  if (result.tokens) await opts.onTokens?.(result.tokens);
  const put = await repo.mutateApprovals(caller.tenant, convId, (d, staged) => applyTurn(d, turn, result, now, staged));
  if (!put.ok) mutateFailed(put);
  return { conversation: chatView(find(put.data, convId)), ...(put.value && { engine: result.engine }) };
}

// The knowledge page's "test the agent against this draft": the customer agent answers a test conversation from
// the stored data with the draft pages in place of the knowledge base. Owners only, and nothing is stored or applied.
// The test conversation's state comes back to the page, since it exists nowhere else.
export interface PreviewInput {
  kb: KbPage[];
  messages: Pick<Msg, "from" | "body">[];
  state: AgentState;
}

export function previewInput(r: Raw): PreviewInput {
  const kb = Array.isArray(r.kb) && r.kb.length <= 50 ? r.kb.map((p) => (isObj(p) ? { slug: text(p, "slug", 60), title: text(p, "title", 120), body: maybeText(p, "body", 20_000) ?? "" } : bad("kb"))) : bad("kb");
  const messages = Array.isArray(r.messages) && r.messages.length <= HISTORY ? r.messages.map((m) => (isObj(m) ? { from: oneOf(m, "from", ["customer", "agent"] as const), body: text(m, "body", BODY_CHARS) } : bad("messages"))) : bad("messages");
  if (messages.at(-1)?.from !== "customer") bad("messages");
  return { kb, messages, state: isObj(r.state) ? (r.state as AgentState) : {} };
}

export async function previewTurn(repo: Repo, caller: Pick<Caller, "tenant" | "ownerId" | "now">, input: PreviewInput, opts: TurnOptions) {
  const doc = await repo.load(caller.tenant);
  if (!doc) throw new CommandError(404, "No such business.");
  if (!doc.data.owners.some((o) => o.id === caller.ownerId)) throw new CommandError(401, "Sign in first.");
  const now = caller.now ?? new Date();
  const c: Conversation = {
    id: "preview",
    channel: "sms",
    contact: "test",
    name: "Test",
    agentActive: true,
    unread: false,
    state: input.state,
    messages: input.messages.map((m, i) => ({ id: `m${i}`, ...m, at: now.toISOString() })),
  };
  const turn = prepare({ ...doc.data, kb: input.kb }, c, now, opts.origin);
  if (!turn) throw new CommandError(409, "The agent can't answer that.");
  const r = await turn.run(opts.client, opts.rulesOnly);
  if (r.tokens) await opts.onTokens?.(r.tokens);
  return { reply: r.reply, tools: r.tools, engine: r.engine, state: r.state, actions: r.actions.map((a) => a.type) };
}
