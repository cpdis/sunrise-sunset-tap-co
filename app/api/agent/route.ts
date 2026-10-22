import { NextResponse } from "next/server";
import { runClaude } from "@/lib/agent/claude";
import { runRules } from "@/lib/agent/rules";
import type { Snapshot, ToolCtx } from "@/lib/agent/tools";
import type { AgentState, Conversation, Msg } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  snapshot: Snapshot;
  conversation: Pick<Conversation, "channel" | "contact" | "name" | "state"> & { messages: Msg[] };
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { snapshot, conversation } = body;
  const last = [...conversation.messages].reverse().find((m) => m.from === "customer");
  if (!last) return NextResponse.json({ error: "No customer message" }, { status: 400 });

  const ctx: ToolCtx = {
    data: snapshot,
    contact: conversation.contact,
    channel: conversation.channel,
    customerName: conversation.name && !/^(Caller|New contact)/.test(conversation.name) ? conversation.name : undefined,
    now: new Date(),
    actions: [],
    used: [],
    origin: new URL(req.url).origin,
  };
  const state: AgentState = conversation.state ?? {};

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return NextResponse.json(await runClaude(ctx, conversation.messages, state));
    } catch (err) {
      console.error("Claude agent failed, falling back to rules", err);
      ctx.actions = [];
      ctx.used = [];
    }
  }
  return NextResponse.json(runRules(ctx, last.body, state));
}

export async function GET() {
  return NextResponse.json({ engine: process.env.ANTHROPIC_API_KEY ? "claude" : "rules" });
}
