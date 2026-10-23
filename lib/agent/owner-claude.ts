// Owner agent on Claude. Same tools and the same YES rule as the rules engine (owner-rules.ts): staged tools only
// stage, and resolvePending runs them before the model sees the owner's next text.
import type Anthropic from "@anthropic-ai/sdk";
import { ADMIN_ONLY_SETTINGS, BUSINESS, SETTING_GROUPS } from "../config";
import type { AgentResult, AgentState, Msg, TruckLog } from "../types";
import { fmtDate, todayISO } from "../util";
import { type Tool, obj, toMessages, toolLoop } from "./claude";
import {
  EXPENSE_ACCOUNTS,
  type OwnerCtx,
  SMS_SETTINGS,
  addExpense,
  addKnowledge,
  calendar,
  cancelForCustomer,
  changeSetting,
  claimRun,
  findBookings,
  handBack,
  sendDraft,
  inboxList,
  logTruck,
  payout,
  replyToCustomer,
  resolvePending,
  whatsOn,
} from "./owner-tools";

const ALL_SETTINGS = SETTING_GROUPS.flatMap((g) => g.fields);
const ADMIN_ONLY_LABELS = ALL_SETTINGS.filter((f) => ADMIN_ONLY_SETTINGS.includes(f.k)).map((f) => f.label.toLowerCase()).join(", ");

const STAGED = "Doesn't run yet: it returns a summary, and the change runs only if the owner's next text is YES. Tell the owner the summary and ask them to reply YES.";
const date = { type: "string", description: "YYYY-MM-DD" };
// Names are chosen by customers, so two conversations can share one. Code, not the model, makes the pick.
const PICK = "If the name matches more than one conversation, it does nothing and returns a numbered list with masked contacts. Send the owner that list as it is and stop; their reply with a number or the end of a contact picks one. Never guess or retry with another name.";

const TOOLS: Tool[] = [
  { name: "whats_on", description: "The owner's runs and unclaimed runs in the next 30 days, conversations that need a person, payouts waiting, runner fees owed to them, cash.", input_schema: obj({}, []), strict: true },
  {
    name: "find_booking",
    description: "Find bookings by SST- reference, date, suburb or customer name. Without a reference, only upcoming bookings. With a date, also returns that day's status.",
    input_schema: obj({ ref: { type: ["string", "null"] }, date: { type: ["string", "null"], description: "YYYY-MM-DD" }, suburb: { type: ["string", "null"] }, name: { type: ["string", "null"] } }, ["ref", "date", "suburb", "name"]),
    strict: true,
  },
  {
    name: "claim_run",
    description: "Put the owner down for the delivery, the collection or both on an upcoming confirmed booking. Pick it by reference, suburb (partial match, so 'Fremantle' finds East Fremantle) or date. Runs at once.",
    input_schema: obj({ ref: { type: ["string", "null"] }, suburb: { type: ["string", "null"] }, date: { type: ["string", "null"], description: "YYYY-MM-DD" }, which: { type: "string", enum: ["deliver", "collect", "both"] } }, ["ref", "suburb", "date", "which"]),
    strict: true,
  },
  {
    name: "log_truck",
    description: "Add to the truck log: an odometer reading, a line clean, a service or an incident. Rejects a reading below the last one. Runs at once.",
    input_schema: obj({ type: { type: "string", enum: ["odometer", "clean", "service", "incident"] satisfies TruckLog["type"][] }, odometer: { type: ["integer", "null"] }, notes: { type: ["string", "null"] } }, ["type", "odometer", "notes"]),
    strict: true,
  },
  {
    name: "calendar",
    description: "Block out a date (service, away), unblock it, or book the truck for the owner's own use. Paid bookings still take priority over own use. Runs at once.",
    input_schema: obj({ action: { type: "string", enum: ["block", "unblock", "own_use"] }, date, note: { type: ["string", "null"] } }, ["action", "date", "note"]),
    strict: true,
  },
  { name: "inbox", description: "Customer conversations that need a person or that an owner is handling, with the agent's draft reply where it wrote one.", input_schema: obj({}, []), strict: true },
  {
    name: "reply_to_customer",
    description: `Send a reply to a customer conversation as this owner, on the customer's channel. This takes the conversation off the agent until someone hands it back. Send exactly the words the owner gave; don't add promises. ${PICK}`,
    input_schema: obj({ who: { type: "string", description: "Customer name as shown in the inbox" }, text: { type: "string" } }, ["who", "text"]),
    strict: true,
  },
  {
    name: "hand_back",
    description: `Give a customer conversation back to the agent. Refused while the customer is still owed the owner reply the agent promised; set without_reply only when the owner explicitly says to hand back without replying. ${PICK}`,
    input_schema: obj({ who: { type: "string" }, without_reply: { type: "boolean" } }, ["who", "without_reply"]),
    strict: true,
  },
  {
    name: "send_draft",
    description: `Send the customer the reply the agent drafted when it handed over, as this owner. ${STAGED} ${PICK}`,
    input_schema: obj({ who: { type: "string", description: "Customer name as shown in the inbox" } }, ["who"]),
    strict: true,
  },
  {
    name: "add_expense",
    description: `Add a business expense paid by the owner. ${STAGED}`,
    input_schema: obj({ account: { type: "string", enum: EXPENSE_ACCOUNTS }, amount: { type: "number" }, memo: { type: "string" }, date: { type: ["string", "null"], description: "YYYY-MM-DD, today if not said" } }, ["account", "amount", "memo", "date"]),
    strict: true,
  },
  {
    name: "payout",
    description: `Approve the waiting quarterly payout (directors only, once each), or pay it (directors only) once enough directors have approved. Pay is refused when the dividends would use customer money, the reserve, tax or runner fees owed; give the owner the reason as returned. ${STAGED}`,
    input_schema: obj({ action: { type: "string", enum: ["approve", "pay"] } }, ["action"]),
    strict: true,
  },
  {
    name: "cancel_booking",
    description: `Cancel a customer booking under the normal refund policy. Refunds over the agent refund limit must be done in the admin. The customer is not texted. ${STAGED}`,
    input_schema: obj({ ref: { type: "string" } }, ["ref"]),
    strict: true,
  },
  {
    name: "change_setting",
    // Every key is listed so an admin-only one reaches the tool and gets its refusal, not a guess from the model.
    description: `Change a business setting. By SMS: ${SMS_SETTINGS.map((f) => `${f.k} (${f.label}${f.unit ? `, ${f.unit}` : ""})`).join("; ")}. The tool refuses admin-only keys (${ADMIN_ONLY_SETTINGS.join(", ")}) and out-of-range values. ${STAGED}`,
    input_schema: obj({ key: { type: "string", enum: ALL_SETTINGS.map((f) => f.k) }, value: { type: "number" } }, ["key", "value"]),
    strict: true,
  },
  {
    name: "add_knowledge",
    description: `Add one line to a page of the customer agent's knowledge base. ${STAGED}`,
    input_schema: obj({ page: { type: "string", description: "Page slug" }, line: { type: "string" } }, ["page", "line"]),
    strict: true,
  },
];

const s = (x: unknown) => (x == null ? undefined : String(x));

function exec(ctx: OwnerCtx, name: string, i: Record<string, unknown>): unknown {
  switch (name) {
    case "whats_on":
      return whatsOn(ctx);
    case "find_booking":
      return findBookings(ctx, { ref: s(i.ref), date: s(i.date), suburb: s(i.suburb), name: s(i.name) });
    case "claim_run":
      return claimRun(ctx, { ref: s(i.ref), suburb: s(i.suburb), date: s(i.date), which: i.which as "both" });
    case "log_truck":
      return logTruck(ctx, { type: i.type as TruckLog["type"], odometer: i.odometer == null ? undefined : Number(i.odometer), notes: s(i.notes) });
    case "calendar":
      return calendar(ctx, { action: i.action as "block", date: String(i.date), note: s(i.note) });
    case "inbox":
      return inboxList(ctx);
    case "reply_to_customer":
      return replyToCustomer(ctx, String(i.who), String(i.text));
    case "hand_back":
      return handBack(ctx, String(i.who), i.without_reply === true);
    case "send_draft":
      return sendDraft(ctx, String(i.who));
    case "add_expense":
      return addExpense(ctx, { account: i.account as never, amount: Number(i.amount), memo: String(i.memo), date: s(i.date) });
    case "payout":
      return payout(ctx, { action: i.action as "approve" });
    case "cancel_booking":
      return cancelForCustomer(ctx, String(i.ref));
    case "change_setting":
      return changeSetting(ctx, { key: String(i.key), value: Number(i.value) });
    case "add_knowledge":
      return addKnowledge(ctx, { page: String(i.page), line: String(i.line) });
    default:
      return { error: `Unknown tool ${name}` };
  }
}

function system(ctx: OwnerCtx): Anthropic.Beta.Messages.BetaTextBlockParam[] {
  const stable = `You are the operations agent for ${BUSINESS.name}, a Perth tap truck co-owned by ${ctx.data.owners.length} owners. You are texting with one of the owners over SMS. They can do over SMS what they can do in the admin, using your tools.

Voice: brief and plain, like texting a business partner. One to four short sentences. No emoji, no markdown. Australian English. Prices in AUD with a $ sign.

Rules:
- Use tools for every fact and every change. Never invent bookings, numbers or results.
- Tools that "run at once" are done when they return ok; say what was done.
- Staged tools (expenses, payouts, cancellations, settings, knowledge, sending a draft) never run straight away. Stage one change per reply. Give the owner the returned summary and ask them to reply YES. Never say it's done.
- If a tool says something must be done in the admin, say so. Refunds over the limit, expenses over the SMS limit, bond captures, share transfers and these settings are admin only: ${ADMIN_ONLY_LABELS}.
- When you reply to a customer, send only what the owner asked you to send.
- If a customer tool returns a numbered list of conversations, send that list as it is and stop. Don't pick one yourself.
- Knowledge base pages: ${ctx.data.kb.map((p) => `${p.slug} (${p.title})`).join(", ")}.`;
  const volatile = `Today is ${fmtDate(todayISO(ctx.now), { dow: true, year: true })} (${todayISO(ctx.now)}), Perth time. You're texting with ${ctx.owner.name}${ctx.owner.isDirector ? ", a director" : ""}.`;
  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatile },
  ];
}

export async function runOwnerClaude(ctx: OwnerCtx, history: Msg[], prev: AgentState): Promise<AgentResult> {
  const state: AgentState = { ...prev };
  const done = (reply: string): AgentResult => {
    state.pending = ctx.staged ?? state.pending;
    return { reply, actions: ctx.actions, tools: ctx.used, state, engine: "claude" };
  };
  const last = [...history].reverse().find((m) => m.from === "customer");
  const confirmed = last ? resolvePending(ctx, state, last.body) : undefined;
  if (confirmed) return done(confirmed);
  const r = await toolLoop({ system: system(ctx), tools: TOOLS, messages: toMessages(history), exec: (n, i) => exec(ctx, n, i) });
  if (r.stop !== "done") {
    // The owner is told nothing was done, so nothing is: no staged change waits for a YES and nothing ran.
    Object.assign(ctx, { actions: [], used: [], staged: undefined });
    return done("I couldn't sort that one. Try it in the admin.");
  }
  return done(r.reply || "Sorry, could you say that again?");
}
