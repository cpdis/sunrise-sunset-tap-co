// Owner sign-in and the checks every cookie-authenticated route makes (KTD7). A simulated magic link goes to the
// outbox. It opens the confirm page (/login/confirm), whose button posts the link's token to /api/session/confirm,
// which sets a signed session cookie bound to one business and one owner. Whether that owner is a director, and
// whether the cookie is still current, is read from the business's data on each request: a cookie never outlives a
// change of role, a sign-out (sessionOwner) or the end of the demo (requestSession).
import { createHmac } from "node:crypto";
import type { Data, Owner } from "@/lib/types";
import { randomToken } from "@/lib/util";
import { DEMO_TENANT, type Repo } from "./db/repo";
import { type Env, secret, secretEqual } from "./secrets";
import { publicBaseUrl } from "./signature";

export const SESSION_COOKIE = "sst_session";
export const SESSION_DAYS = 7;
export const LINK_MINUTES = 15;

// KTD12: the simulated outbox, its sign-in links and the demo reset work outside production, and in production only
// with DEMO_MODE on. This is one of two keys: see demoFor.
export function demoMode(env: Env = process.env) {
  return env.NODE_ENV !== "production" || ["1", "true", "on"].includes((env.DEMO_MODE ?? "").toLowerCase());
}

// A1: a business's demo features need both keys, demoMode() and the business's own demo flag, which only seedDemo
// sets (lib/server/db/repo.ts). DEMO_MODE left on by mistake opens nothing on a real business.
export async function demoFor(repo: Pick<Repo, "tenant">, tenant: string, env: Env = process.env) {
  return demoMode(env) && !!(await repo.tenant(tenant))?.demo;
}

export interface Session {
  tenant: string;
  ownerId: string;
  // The owner's session version when the cookie was signed (Owner.sessionVersion). Signing out bumps it, which ends
  // every cookie signed before (A7).
  sv: number;
  // Whether the business's demo features were on (demoFor). The cookie is good only while that still holds, so one
  // from the public demo dies when DEMO_MODE goes off (AUTH-01).
  demo: boolean;
}

// What a signed token says. `purpose` keeps a sign-in link from working as a session cookie, and the reverse.
type Claims =
  // Links: the nonce is spent on first use (repo.claimKey), so a link signs in once.
  | { purpose: "link"; tenant: string; ownerId: string; exp: number; nonce: string }
  | ({ purpose: "session"; exp: number } & Session);

const mac = (payload: string, env?: Env) => createHmac("sha256", secret("SESSION_SECRET", env)).update(payload).digest("base64url");

function sign(c: Claims, env?: Env) {
  const payload = Buffer.from(JSON.stringify(c)).toString("base64url");
  return `${payload}.${mac(payload, env)}`;
}

// The claims of a token we signed for `purpose`, unexpired at `now` (ms since the epoch). Expiry is `exp`, also in ms.
function verify(token: string | undefined, purpose: Claims["purpose"], now: number, env?: Env): Record<string, unknown> | undefined {
  const [payload, sig, extra] = (token ?? "").split(".");
  if (!payload || !sig || extra !== undefined || !secretEqual(sig, mac(payload, env))) return undefined;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString());
    return c?.purpose === purpose && typeof c.tenant === "string" && typeof c.ownerId === "string" && typeof c.exp === "number" && c.exp > now ? c : undefined;
  } catch {
    return undefined;
  }
}

// A sign-in link's token for one owner of one business, good for LINK_MINUTES.
export function linkToken(s: Pick<Session, "tenant" | "ownerId">, now = Date.now(), env?: Env) {
  return sign({ purpose: "link", tenant: s.tenant, ownerId: s.ownerId, exp: now + LINK_MINUTES * 60_000, nonce: randomToken() }, env);
}

// The owner a link signs in, and the nonce the caller must spend before trusting it.
export function openLink(token: string | undefined, now = Date.now(), env?: Env) {
  const c = verify(token, "link", now, env);
  return c && typeof c.nonce === "string" ? { tenant: c.tenant as string, ownerId: c.ownerId as string, nonce: c.nonce } : undefined;
}

function cookieValue(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
}

// The session on a request, if its cookie is present, signed by us and unexpired. Use requestSession in a route: it
// also checks the cookie against the business's demo state.
export function readSession(req: Request, now = Date.now(), env?: Env): Session | undefined {
  const c = verify(cookieValue(req.headers.get("cookie"), SESSION_COOKIE), "session", now, env);
  return c && typeof c.sv === "number" && typeof c.demo === "boolean" ? { tenant: c.tenant as string, ownerId: c.ownerId as string, sv: c.sv, demo: c.demo } : undefined;
}

// A request's session, and the business it acts on: the session's, or for a visitor the site's own. A cookie signed
// while the business's demo features were in another state is no session (AUTH-01). `demo` is demoFor that business.
export async function requestSession(req: Request, repo: Pick<Repo, "tenant">): Promise<{ tenant: string; demo: boolean; session?: Session }> {
  const s = readSession(req);
  if (s) {
    const demo = await demoFor(repo, s.tenant);
    if (s.demo === demo) return { tenant: s.tenant, demo, session: s };
  }
  return { tenant: DEMO_TENANT, demo: await demoFor(repo, DEMO_TENANT) };
}

// The owner a session signs in, while it is current: the owner is still on the business and their session version
// hasn't moved since the cookie was signed (A7). Callers with no session version (tests) count as version 0.
export function sessionOwner(d: Data, ownerId: string | undefined, sv = 0): Owner | undefined {
  return ownerId === undefined ? undefined : d.owners.find((o) => o.id === ownerId && (o.sessionVersion ?? 0) === sv);
}

// Secure in production, whatever host the app sees behind a proxy, and on any https request (SS-13). Only plain-http
// development goes without, since a browser drops a Secure cookie there.
const secure = (url: URL, env: Env) => env.NODE_ENV === "production" || url.protocol === "https:";

// The Set-Cookie for a new session.
export function sessionCookie(s: Session, url: URL, now = Date.now(), env: Env = process.env) {
  return {
    name: SESSION_COOKIE,
    value: sign({ purpose: "session", tenant: s.tenant, ownerId: s.ownerId, sv: s.sv, demo: s.demo, exp: now + SESSION_DAYS * 86_400_000 }, env),
    httpOnly: true,
    secure: secure(url, env),
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}

// The Set-Cookie that drops the session cookie: the same name, path and flags, empty and expired.
export function endedSessionCookie(url: URL, env: Env = process.env) {
  return { name: SESSION_COOKIE, value: "", httpOnly: true, secure: secure(url, env), sameSite: "strict" as const, path: "/", maxAge: 0 };
}

// True when the request's Origin is this site. Browsers always send it on a POST, and a page on another site cannot
// set it. The site is PUBLIC_BASE_URL wherever it is set, and production must set it (A4): Host and X-Forwarded-Host
// are the caller's to set when nothing in front of the app checks them. Only development without it compares Host.
export function sameOrigin(req: Request, env: Env = process.env) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    if (env.PUBLIC_BASE_URL || env.NODE_ENV === "production") return new URL(origin).origin === new URL(publicBaseUrl(env)).origin;
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Cookie-authenticated writes must come from this site's pages as JSON. A form on another site can post text/plain
// without a CORS check, so anything but application/json is refused along with a foreign Origin.
export function refusedWrite(req: Request): Response | undefined {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!sameOrigin(req) || type !== "application/json") return Response.json({ error: "Forbidden" }, { status: 403 });
}
