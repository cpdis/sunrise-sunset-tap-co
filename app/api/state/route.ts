import { NextResponse } from "next/server";
import { codesFor } from "@/lib/server/approvals";
import { demoMode, readSession, sameOrigin } from "@/lib/server/auth";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";
import { stateFor } from "@/lib/views";

export const runtime = "nodejs";

// GET /api/state[?booking=<id>&t=<token>][&chat=<number>]: what this caller may see (lib/views.ts stateFor). The
// owner comes from the session cookie only; a booking needs its link token; a conversation needs an owner's session
// outside the demo. A signed-in owner also gets the one-time codes for the changes they texted (KTD6).
export async function GET(req: Request) {
  // Another site's page can't read the answer anyway (no CORS); refuse it outright.
  if (req.headers.get("origin") && !sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = readSession(req);
  const tenant = session?.tenant ?? DEMO_TENANT;
  const repo = await getRepo();
  const doc = await repo.load(tenant);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const now = new Date();
  const view = stateFor(doc.data, { ownerId: session?.ownerId, booking: q.get("booking") ?? undefined, token: q.get("t") ?? undefined, chat: q.get("chat") ?? undefined, demo: demoMode() }, now);
  if (view.owner) view.owner.codes = await codesFor(repo, doc.data, tenant, view.owner.id, now);
  return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
}
