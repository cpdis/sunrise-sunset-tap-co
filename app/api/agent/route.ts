import { NextResponse } from "next/server";
import { CommandError, isObj } from "@/lib/server/args";
import { agentTurn, turnInput } from "@/lib/server/agent";
import { readSession, refusedWrite } from "@/lib/server/auth";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";

export const runtime = "nodejs";

// POST { convId, body } or { channel, contact, name?, body }: one inbound message from the SMS widget or the inbox
// simulator, and the agent's answer (lib/server/agent.ts). The server loads everything the agent reads; a snapshot,
// state or anything else in the body is ignored. The business and any owner come from the session cookie. U10
// replaces this route with signed inbound webhooks.
const MAX_BYTES = 16_000;
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

export async function POST(req: Request) {
  const refused = refusedWrite(req);
  if (refused) return refused;
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (limited(ip, Date.now())) return NextResponse.json({ error: "Too many messages, try again in a minute" }, { status: 429 });
  // Bytes, not characters: an emoji is one character and four bytes.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    if (!isObj(raw)) throw new CommandError(400, "Bad request");
    const input = turnInput(raw);
    const session = readSession(req);
    const out = await agentTurn(await getRepo(), { tenant: session?.tenant ?? DEMO_TENANT, ownerId: session?.ownerId }, input, { origin: new URL(req.url).origin });
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof CommandError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Agent turn failed", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ engine: process.env.ANTHROPIC_API_KEY ? "claude" : "rules" });
}
