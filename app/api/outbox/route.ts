import { NextResponse } from "next/server";
import { requestSession, sameOrigin, sessionOwner } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/db/repo";
import { outboxFor } from "@/lib/server/outbox";

export const runtime = "nodejs";

// GET: the business's simulated outbox for a signed-in owner: owner notices, replies to customers, alerts. Mail to
// another owner (their sign-in links) is left out (lib/server/outbox.ts outboxFor).
export async function GET(req: Request) {
  if (req.headers.get("origin") && !sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const repo = await getRepo();
  const { tenant, session } = await requestSession(req, repo);
  const doc = session && (await repo.load(tenant));
  const owner = doc ? sessionOwner(doc.data, session.ownerId, session.sv) : undefined;
  if (!doc || !owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const rows = outboxFor(await repo.readOutbox(tenant), doc.data.owners, owner.id);
  return NextResponse.json({ messages: rows.map(({ id, channel, to, subject, body, createdAt }) => ({ id, channel, to, subject, body, at: createdAt.toISOString() })) }, { headers: { "cache-control": "no-store" } });
}
