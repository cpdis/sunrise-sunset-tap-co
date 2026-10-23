import { NextResponse } from "next/server";
import { codesFor } from "@/lib/server/approvals";
import { requestSession, sameOrigin, sessionOwner } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/db/repo";
import { stateFor } from "@/lib/views";

export const runtime = "nodejs";

// GET /api/state[?booking=<id>&t=<token>][&chat=<number>]: what this caller may see (lib/views.ts stateFor). The
// owner comes from the session cookie only, while it is current; a booking needs its link token; a conversation needs
// an owner's session outside the demo business. A signed-in owner also gets the one-time codes for the changes they
// texted (KTD6).
export async function GET(req: Request) {
  // Another site's page can't read the answer anyway (no CORS); refuse it outright.
  if (req.headers.get("origin") && !sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const repo = await getRepo();
  const { tenant, demo, session } = await requestSession(req, repo);
  const doc = await repo.load(tenant);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const now = new Date();
  const ownerId = sessionOwner(doc.data, session?.ownerId, session?.sv)?.id;
  const view = stateFor(doc.data, { ownerId, booking: q.get("booking") ?? undefined, token: q.get("t") ?? undefined, chat: q.get("chat") ?? undefined, demo }, now);
  if (view.owner) view.owner.codes = await codesFor(repo, doc.data, tenant, view.owner.id, now);
  return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
}
