import { NextResponse } from "next/server";
import { CommandError, isObj } from "@/lib/server/args";
import { previewInput, previewTurn } from "@/lib/server/agent";
import { readSession, refusedWrite } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/db/repo";
import { overBudget, spend } from "@/lib/server/limits";

export const runtime = "nodejs";

// POST { kb, messages, state }: a signed-in owner tests the customer agent against draft knowledge pages. Nothing is
// stored and no action applies; the answer lists what the agent would have done.
const MAX_BYTES = 1_200_000;

export async function POST(req: Request) {
  const refused = refusedWrite(req);
  if (refused) return refused;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const session = readSession(req);
    if (!session) throw new CommandError(401, "Sign in first.");
    if (!isObj(raw)) throw new CommandError(400, "Bad request");
    const repo = await getRepo();
    // A preview spends model tokens too, so it counts against the business's daily budget (KTD8).
    const out = await previewTurn(repo, { tenant: session.tenant, ownerId: session.ownerId }, previewInput(raw), {
      origin: new URL(req.url).origin,
      rulesOnly: await overBudget(repo, session.tenant),
      onTokens: (n) => spend(repo, session.tenant, n),
    });
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof CommandError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Agent preview failed", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

// GET: which engine answers, for the settings page.
export async function GET() {
  return NextResponse.json({ engine: process.env.ANTHROPIC_API_KEY ? "claude" : "rules" });
}
