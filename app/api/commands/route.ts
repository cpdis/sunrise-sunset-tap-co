import { NextResponse } from "next/server";
import { demoMode, readSession, refusedWrite } from "@/lib/server/auth";
import { CommandError, runCommand } from "@/lib/server/commands";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";

export const runtime = "nodejs";

// A knowledge page is the largest thing a command carries.
const MAX_BYTES = 64_000;

// POST { command, args, key }: one named command (lib/server/commands.ts). The business and the owner come from the
// session cookie, never from the body (R16); a visitor without one acts on the site's own business.
export async function POST(req: Request) {
  const refused = refusedWrite(req);
  if (refused) return refused;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const session = readSession(req);
    const out = await runCommand(await getRepo(), { tenant: session?.tenant ?? DEMO_TENANT, ownerId: session?.ownerId, demo: demoMode() }, body);
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof CommandError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Command failed", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
