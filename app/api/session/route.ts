import { NextResponse } from "next/server";
import { LINK_MINUTES, SESSION_COOKIE, linkToken, openLink, refusedWrite, sameOrigin, sessionCookie } from "@/lib/server/auth";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";
import { sameContact } from "@/lib/util";

export const runtime = "nodejs";

// Owner sign-in by simulated magic link (KTD7).
// POST { email }: puts a sign-in link for that owner in the outbox. The answer is the same for any address, so the
// form never says who is an owner.
export async function POST(req: Request) {
  const refused = refusedWrite(req);
  if (refused) return refused;
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.slice(0, 120) : "";
  const repo = await getRepo();
  const owner = (await repo.load(DEMO_TENANT))?.data.owners.find((o) => sameContact(o.email, email));
  if (owner) {
    const url = new URL(req.url);
    const link = `${url.origin}/api/session?token=${linkToken({ tenant: DEMO_TENANT, ownerId: owner.id })}`;
    await repo.writeOutbox(DEMO_TENANT, {
      channel: "email",
      to: owner.email,
      subject: "Your Sunrise Sunset sign-in link",
      body: `G'day ${owner.name}. Open this link to sign in to the owners' admin. It works once, within ${LINK_MINUTES} minutes: ${link}`,
    });
  }
  return NextResponse.json({ ok: true });
}

// GET ?token=: opens a sign-in link once, sets the session cookie and goes to the admin. A used, expired or forged
// link goes back to the login page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const link = openLink(url.searchParams.get("token") ?? undefined);
  const repo = await getRepo();
  const owner = link && (await repo.load(link.tenant))?.data.owners.find((o) => o.id === link.ownerId);
  if (!link || !owner || !(await repo.claimKey(link.tenant, `link:${link.nonce}`, "sign_in"))) {
    return NextResponse.redirect(new URL("/login?link=used", url), 303);
  }
  const res = NextResponse.redirect(new URL("/admin", url), 303);
  res.cookies.set(sessionCookie({ tenant: link.tenant, ownerId: owner.id }, url));
  return res;
}

// DELETE: signs out.
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  // Same name and path as the session cookie, so the browser drops that one.
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0, httpOnly: true, sameSite: "strict" });
  return res;
}
