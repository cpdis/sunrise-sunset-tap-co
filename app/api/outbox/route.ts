import { NextResponse } from "next/server";
import { readSession, sameOrigin } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/db/repo";
import { outboxFor } from "@/lib/server/outbox";

export const runtime = "nodejs";

// GET: the business's simulated outbox for a signed-in owner: owner notices, replies to customers, alerts. Mail to
// another owner (their sign-in links) is left out (lib/server/outbox.ts outboxFor).
export async function GET(req: Request) {
  if (req.headers.get("origin") && !sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = readSession(req);
  const repo = await getRepo();
  const doc = session && (await repo.load(session.tenant));
  if (!session || !doc?.data.owners.some((o) => o.id === session.ownerId)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const rows = outboxFor(await repo.readOutbox(session.tenant), doc.data.owners, session.ownerId);
  return NextResponse.json({ messages: rows.map(({ id, channel, to, subject, body, createdAt }) => ({ id, channel, to, subject, body, at: createdAt.toISOString() })) }, { headers: { "cache-control": "no-store" } });
}
