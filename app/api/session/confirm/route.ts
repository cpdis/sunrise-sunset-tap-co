import { NextResponse } from "next/server";
import { demoFor, openLink, refusedWrite, sessionCookie } from "@/lib/server/auth";
import { getRepo } from "@/lib/server/db/repo";

export const runtime = "nodejs";

// POST { token }: the confirm page (/login/confirm) opens a sign-in link (A5). The link's nonce is spent here, once,
// and the session cookie set with the owner's session version and the business's demo state (lib/server/auth.ts
// Session). A GET of the link reaches only the page, which changes nothing. A used, expired or forged token gets 400
// and no cookie.
export async function POST(req: Request) {
  const refused = refusedWrite(req);
  if (refused) return refused;
  const body = await req.json().catch(() => null);
  const link = openLink(typeof body?.token === "string" ? body.token : undefined);
  const repo = await getRepo();
  const owner = link && (await repo.load(link.tenant))?.data.owners.find((o) => o.id === link.ownerId);
  if (!link || !owner || !(await repo.claimKey(link.tenant, `link:${link.nonce}`, "sign_in"))) {
    return NextResponse.json({ error: "That sign-in link has expired or was used already." }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie({ tenant: link.tenant, ownerId: owner.id, sv: owner.sessionVersion ?? 0, demo: await demoFor(repo, link.tenant) }, new URL(req.url)));
  return res;
}
