import { NextResponse } from "next/server";
import { LINK_MINUTES, endedSessionCookie, linkToken, refusedWrite, requestSession, sameOrigin, sessionOwner } from "@/lib/server/auth";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";
import { WEB_LIMITS, clientIp, linkLimited } from "@/lib/server/limits";
import { publicBaseUrl } from "@/lib/server/signature";
import { sameContact } from "@/lib/util";

export const runtime = "nodejs";

// Owner sign-in by simulated magic link (KTD7).
// POST { email }: puts a sign-in link for that owner in the outbox, in place of any older one. The answer is the same
// for any address, so the form never says who is an owner, and so is the limit on asking (A6, lib/server/limits.ts).
// The link points at PUBLIC_BASE_URL, never at the request's own headers (A4). It opens /login/confirm with the token
// in its fragment, which a browser never sends: a mail scanner or a log that fetches or records the link gets no
// token, and only the page's button spends it, through /api/session/confirm (A5).
export async function POST(req: Request) {
  const refused = refusedWrite(req);
  if (refused) return refused;
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().slice(0, 120) : "";
  const repo = await getRepo();
  if (await linkLimited(repo, DEMO_TENANT, clientIp(req), email)) {
    return NextResponse.json({ error: `Too many sign-in links asked for. Try again in ${WEB_LIMITS.linkPerEmail.minutes} minutes.` }, { status: 429 });
  }
  const owner = (await repo.load(DEMO_TENANT))?.data.owners.find((o) => sameContact(o.email, email));
  if (owner) {
    const link = `${publicBaseUrl()}/login/confirm#token=${linkToken({ tenant: DEMO_TENANT, ownerId: owner.id })}`;
    await repo.replaceOutbox(DEMO_TENANT, {
      channel: "email",
      to: owner.email,
      subject: "Your Sunrise Sunset sign-in link",
      body: `G'day ${owner.name}. Open this link to sign in to the owners' admin. It works once, within ${LINK_MINUTES} minutes: ${link}`,
    });
  }
  return NextResponse.json({ ok: true });
}

// DELETE: signs out everywhere (A7). It bumps the owner's session version, which ends every cookie of theirs on every
// device, then drops this browser's cookie.
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const repo = await getRepo();
  const { tenant, session } = await requestSession(req, repo);
  if (session) {
    await repo.mutate(tenant, (d) => {
      const owner = sessionOwner(d, session.ownerId, session.sv);
      if (owner) owner.sessionVersion = session.sv + 1;
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(endedSessionCookie(new URL(req.url)));
  return res;
}
