import { NextResponse } from "next/server";
import { runClaude } from "@/lib/agent/claude";
import { runRules } from "@/lib/agent/rules";
import type { Snapshot, ToolCtx } from "@/lib/agent/tools";
import type { AgentState, Conversation, Msg } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  snapshot: Snapshot;
  conversation: Pick<Conversation, "channel" | "contact" | "name" | "state" | "escalated" | "agentActive"> & { messages: Msg[] };
}

// The client supplies the snapshot (including the knowledge base that becomes the system prompt), so the endpoint
// only answers this site's own pages, rate-limits each address and caps what it will read.
const MAX_BYTES = 256_000;
const WINDOW_MS = 60_000;
const PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function limited(ip: string, now: number) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > PER_WINDOW;
}

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (limited(ip, Date.now())) return NextResponse.json({ error: "Too many messages, try again in a minute" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  const body = JSON.parse(raw) as Body;
  const { snapshot, conversation } = body;
  const messages = conversation.messages.slice(-30).map((m) => ({ ...m, body: String(m.body).slice(0, 1000) }));
  const last = [...messages].reverse().find((m) => m.from === "customer");
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
    handover: !!conversation.escalated && conversation.agentActive === false,
  };
  const state: AgentState = conversation.state ?? {};

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return NextResponse.json(await runClaude(ctx, messages, state));
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
