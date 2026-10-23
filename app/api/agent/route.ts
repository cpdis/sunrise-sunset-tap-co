import { NextResponse } from "next/server";
import { runClaude } from "@/lib/agent/claude";
import { runOwnerClaude } from "@/lib/agent/owner-claude";
import { runOwnerRules } from "@/lib/agent/owner-rules";
import type { OwnerCtx, OwnerSnapshot } from "@/lib/agent/owner-tools";
import { runRules } from "@/lib/agent/rules";
import type { Snapshot, ToolCtx } from "@/lib/agent/tools";
import { sameOrigin } from "@/lib/server/auth";
import type { AgentState, Conversation, Msg } from "@/lib/types";
import { sameContact } from "@/lib/util";

export const runtime = "nodejs";

interface Body {
  snapshot: Snapshot | OwnerSnapshot;
  conversation: Pick<Conversation, "channel" | "contact" | "name" | "state" | "escalated" | "agentActive"> & { messages: Msg[] };
}

// The client forwards the snapshot the customerMessage command built (including the knowledge base that becomes the
// system prompt), so the endpoint only answers this site's own pages, rate-limits each address and caps what it
// will read. Its actions change nothing until the agentReply command applies them; U9 moves the agent server side.
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

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

// The body as the agents expect it, or undefined for bad JSON or a missing or mistyped field (a 400, not a 500).
function parseBody(raw: string): Body | undefined {
  let b: unknown;
  try {
    b = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObj(b) || !isObj(b.snapshot) || !isObj(b.conversation)) return undefined;
  const { snapshot: s, conversation: c } = b;
  if (!isObj(s.settings) || !Array.isArray(s.bookings) || !Array.isArray(s.customers) || !Array.isArray(s.kb) || !Array.isArray(s.blackouts)) return undefined;
  if ("owners" in s ? !Array.isArray(s.owners) : !Array.isArray(s.mine)) return undefined;
  if (typeof c.contact !== "string" || !["web", "sms", "email", "phone"].includes(c.channel as string)) return undefined;
  if (!Array.isArray(c.messages) || !c.messages.every((m) => isObj(m) && typeof m.from === "string")) return undefined;
  if (c.state !== undefined && !isObj(c.state)) return undefined;
  return b as unknown as Body;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (limited(ip, Date.now())) return NextResponse.json({ error: "Too many messages, try again in a minute" }, { status: 429 });
  // Bytes, not characters: an emoji is one character and four bytes.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  const body = parseBody(new TextDecoder().decode(buf));
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { snapshot, conversation } = body;
  const messages = conversation.messages.slice(-30).map((m) => ({ ...m, body: String(m.body).slice(0, 1000) }));
  const last = [...messages].reverse().find((m) => m.from === "customer");
  if (!last) return NextResponse.json({ error: "No customer message" }, { status: 400 });

  const state: AgentState = conversation.state ?? {};

  // A text from an owner's own number goes to the owner agent. In production the number alone isn't enough for
  // anything that moves money (caller ID can be spoofed); here the whole demo runs in one browser.
  const owner = "owners" in snapshot ? snapshot.owners.find((o) => sameContact(o.phone, conversation.contact) || sameContact(o.email, conversation.contact)) : undefined;
  if (owner && "owners" in snapshot) {
    const octx: OwnerCtx = { data: snapshot, owner, now: new Date(), actions: [], used: [] };
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        return NextResponse.json(await runOwnerClaude(octx, messages, state));
      } catch (err) {
        console.error("Claude owner agent failed, falling back to rules", err);
        Object.assign(octx, { actions: [], used: [], staged: undefined });
      }
    }
    return NextResponse.json(runOwnerRules(octx, last.body, state));
  }
  if ("owners" in snapshot) return NextResponse.json({ error: "Not an owner number" }, { status: 400 });

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
