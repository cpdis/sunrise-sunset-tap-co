// Claude-backed agent. Used when ANTHROPIC_API_KEY is set; otherwise the rules engine answers.
import Anthropic from "@anthropic-ai/sdk";
import { BUSINESS } from "../config";
import type { AgentResult, AgentState, Block, Msg } from "../types";
import { fmtDate, todayISO } from "../util";
import {
  type ToolCtx,
  cancelBookingTool,
  checkAvailability,
  escalate,
  getQuote,
  holdAndLink,
  lookupBooking,
  renderKb,
} from "./tools";

const MODEL = "claude-opus-5-5";

type Tool = Anthropic.Beta.Messages.BetaTool;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

const TOOLS: Tool[] = [
  {
    name: "check_availability",
    description: "Check whether the truck is free on a date. Returns alternatives when it isn't.",
    input_schema: obj({ date: { type: "string", description: "YYYY-MM-DD" } }, ["date"]),
    strict: true,
  },
  {
    name: "get_quote",
    description: "Price for a 4 or 8 hour block delivered to a suburb, including any travel surcharge. Tells you if the suburb is outside the service area.",
    input_schema: obj({ block: { type: "integer", enum: [4, 8] }, suburb: { type: "string" } }, ["block", "suburb"]),
    strict: true,
  },
  {
    name: "hold_and_send_deposit_link",
    description: "Hold a free date for the customer and get a deposit payment link to send them. Only call after the customer has agreed to book and you know date, block, suburb and their name.",
    input_schema: obj(
      { date: { type: "string" }, block: { type: "integer", enum: [4, 8] }, suburb: { type: "string" }, name: { type: "string" } },
      ["date", "block", "suburb", "name"],
    ),
    strict: true,
  },
  {
    name: "lookup_booking",
    description: "List the sender's upcoming bookings (matched on the phone number or email they're messaging from).",
    input_schema: obj({}, []),
    strict: true,
  },
  {
    name: "cancel_booking",
    description: "Check the refund for cancelling one of the sender's bookings (confirmed=false), or cancel it after they explicitly confirm (confirmed=true). Refunds over the owner limit are routed to an owner automatically.",
    input_schema: obj({ booking: { type: "string", description: "Booking id or SST- reference" }, confirmed: { type: "boolean" } }, ["booking", "confirmed"]),
    strict: true,
  },
  {
    name: "escalate_to_owner",
    description: "Hand the conversation to a human owner. Use for complaints, damage disputes, discounts, multi-day or sponsorship requests, media, legal questions beyond the FAQ, or whenever the customer asks for a person.",
    input_schema: obj({ reason: { type: "string" } }, ["reason"]),
    strict: true,
  },
];

function system(ctx: ToolCtx): Anthropic.Beta.Messages.BetaTextBlockParam[] {
  const stable = `You are the booking agent for ${BUSINESS.name}, a Perth business that dry-hires a small Japanese kei truck with 8 refrigerated beer taps. You answer customers over ${"SMS, phone, email and the web form"}.

Voice: warm, brief, Australian, like texting a mate who runs a small business. One to three short sentences. No emoji, no markdown, no lists. Prices in AUD with a $ sign.

Rules:
- Answer only from the knowledge base and tool results. If unsure, escalate rather than guess.
- Use tools for anything about dates, prices, bookings or cancellations. Never invent availability or prices.
- To book: confirm date, 4 or 8 hours, suburb and name, state the total, then call hold_and_send_deposit_link and send the link exactly as returned.
- Never ask for card numbers. Payment only happens through the link.
- Cancel only after the customer clearly confirms, and tell them the refund first.
- You can't give discounts, change policies or promise anything outside the knowledge base.

Knowledge base:
${renderKb(ctx.data.kb, ctx.data.settings)}`;
  const volatile = `Today is ${fmtDate(todayISO(ctx.now), { dow: true, year: true })} (${todayISO(ctx.now)}), Perth time. Channel: ${ctx.channel}. Sender: ${ctx.contact}${ctx.customerName ? ` (${ctx.customerName})` : ""}.`;
  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatile },
  ];
}

function toMessages(history: Msg[]): MessageParam[] {
  const out: MessageParam[] = [];
  for (const m of history) {
    if (m.from === "system") continue;
    const role = m.from === "customer" ? "user" : "assistant";
    const text = m.from === "owner" ? `[Reply from an owner] ${m.body}` : m.body;
    const last = out.at(-1);
    if (last && last.role === role && typeof last.content === "string") last.content += "\n" + text;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

function exec(ctx: ToolCtx, name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case "check_availability":
      return checkAvailability(ctx, String(input.date));
    case "get_quote":
      return getQuote(ctx, Number(input.block) as Block, String(input.suburb));
    case "hold_and_send_deposit_link":
      return holdAndLink(ctx, String(input.date), Number(input.block) as Block, String(input.suburb), String(input.name));
    case "lookup_booking":
      return lookupBooking(ctx);
    case "cancel_booking":
      return cancelBookingTool(ctx, String(input.booking), Boolean(input.confirmed));
    case "escalate_to_owner":
      return escalate(ctx, String(input.reason));
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export async function runClaude(ctx: ToolCtx, history: Msg[], state: AgentState): Promise<AgentResult> {
  const client = new Anthropic();
  const messages = toMessages(history);
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: system(ctx),
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason === "refusal") {
      escalate(ctx, "Agent declined to answer; needs a person");
      return { reply: "I'll get one of the owners to pick this up.", actions: ctx.actions, tools: ctx.used, state, engine: "claude" };
    }
    const uses = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      const reply = res.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: reply || "Sorry, could you say that again?", actions: ctx.actions, tools: ctx.used, state, engine: "claude" };
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: uses.map((u) => ({
        type: "tool_result" as const,
        tool_use_id: u.id,
        content: JSON.stringify(exec(ctx, u.name, (u.input ?? {}) as Record<string, unknown>)),
      })),
    });
  }
  escalate(ctx, "Agent loop ran too long");
  return { reply: "Let me get one of the owners to confirm that for you.", actions: ctx.actions, tools: ctx.used, state, engine: "claude" };
}
