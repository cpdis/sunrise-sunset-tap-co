// Owner sign-in and the checks every cookie-authenticated route makes (KTD7). A simulated magic link goes to the
// outbox; opening it sets a signed session cookie bound to one business and one owner. Whether that owner is a
// director is read from the business's data on each request, so the cookie never outlives a change of role.
import { createHmac } from "node:crypto";
import { randomToken, safeEqual } from "@/lib/util";

type Env = Partial<Record<"NODE_ENV" | "SESSION_SECRET" | "DEMO_MODE", string>>;

export const SESSION_COOKIE = "sst_session";
export const SESSION_DAYS = 7;
export const LINK_MINUTES = 15;

// Signs only outside production. Production without SESSION_SECRET refuses to sign or check anything.
export const DEV_SESSION_SECRET = "dev-only-session-secret";

function secret(env: Env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set. Production signs sessions with it; the dev default works only outside production.");
  return DEV_SESSION_SECRET;
}

// KTD12: the simulated outbox, its sign-in links and the demo reset work outside production, and in production
// only with DEMO_MODE on.
export function demoMode(env: Env = process.env) {
  return env.NODE_ENV !== "production" || ["1", "true", "on"].includes((env.DEMO_MODE ?? "").toLowerCase());
}

export interface Session {
  tenant: string;
  ownerId: string;
}

// What a signed token says. `purpose` keeps a sign-in link from working as a session cookie, and the reverse.
interface Claims extends Session {
  purpose: "session" | "link";
  // Expiry, in ms since the epoch.
  exp: number;
  // Links only: spent on first use (repo.claimKey), so a link signs in once.
  nonce?: string;
}

const mac = (payload: string, env: Env) => createHmac("sha256", secret(env)).update(payload).digest("base64url");

function sign(c: Claims, env: Env = process.env) {
  const payload = Buffer.from(JSON.stringify(c)).toString("base64url");
  return `${payload}.${mac(payload, env)}`;
}

function verify(token: string | undefined, purpose: Claims["purpose"], now: number, env: Env = process.env): Claims | undefined {
  const [payload, sig, extra] = (token ?? "").split(".");
  if (!payload || !sig || extra !== undefined || !safeEqual(sig, mac(payload, env))) return undefined;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
    return c.purpose === purpose && typeof c.tenant === "string" && typeof c.ownerId === "string" && c.exp > now ? c : undefined;
  } catch {
    return undefined;
  }
}

// A sign-in link's token for one owner of one business, good for LINK_MINUTES.
export function linkToken(s: Session, now = Date.now(), env?: Env) {
  return sign({ purpose: "link", ...s, exp: now + LINK_MINUTES * 60_000, nonce: randomToken() }, env);
}

// The owner a link signs in, and the nonce the caller must spend before trusting it.
export function openLink(token: string | undefined, now = Date.now(), env?: Env): (Session & { nonce: string }) | undefined {
  const c = verify(token, "link", now, env);
  return c?.nonce ? { tenant: c.tenant, ownerId: c.ownerId, nonce: c.nonce } : undefined;
}

function cookieValue(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
}

// The session on a request, if its cookie is present, signed by us and unexpired.
export function readSession(req: Request, now = Date.now(), env?: Env): Session | undefined {
  const c = verify(cookieValue(req.headers.get("cookie"), SESSION_COOKIE), "session", now, env);
  return c && { tenant: c.tenant, ownerId: c.ownerId };
}

const isLocalhost = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

// The Set-Cookie for a new session. Secure everywhere but localhost, which runs on plain http in development.
export function sessionCookie(s: Session, url: URL, now = Date.now(), env?: Env) {
  return {
    name: SESSION_COOKIE,
    value: sign({ purpose: "session", ...s, exp: now + SESSION_DAYS * 86_400_000 }, env),
    httpOnly: true,
    secure: !isLocalhost(url),
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}

// True when the request's Origin is this site. Browsers always send it on a POST, and a page on another site
// cannot set it.
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Cookie-authenticated writes must come from this site's pages as JSON. A form on another site can post
// text/plain without a CORS check, so anything but application/json is refused along with a foreign Origin.
export function refusedWrite(req: Request): Response | undefined {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!sameOrigin(req) || type !== "application/json") return Response.json({ error: "Forbidden" }, { status: 403 });
}
