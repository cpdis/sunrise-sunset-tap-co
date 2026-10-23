// Provider-shaped webhook signatures (KTD3). Both inbound routes use Twilio's scheme: a base64 HMAC-SHA1 over the
// public URL the provider posted to, followed by each form field's name and value, sorted by name. Setting the real
// Twilio auth token later is all a live number needs. The email route uses the same scheme with its own secret.
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/util";

export type InboundKind = "sms" | "email";

type Env = Partial<Record<"NODE_ENV" | "PUBLIC_BASE_URL" | "TWILIO_AUTH_TOKEN" | "EMAIL_WEBHOOK_SECRET", string>>;

export const INBOUND_PATH: Record<InboundKind, string> = { sms: "/api/inbound/sms", email: "/api/inbound/email" };
export const SIGNATURE_HEADER: Record<InboundKind, string> = { sms: "x-twilio-signature", email: "x-email-signature" };
const SECRET_ENV = { sms: "TWILIO_AUTH_TOKEN", email: "EMAIL_WEBHOOK_SECRET" } as const;

// Sign only outside production. Production without the real secret refuses to sign or check anything.
export const DEV_WEBHOOK_SECRET: Record<InboundKind, string> = { sms: "dev-only-twilio-auth-token", email: "dev-only-email-webhook-secret" };

export function webhookSecret(kind: InboundKind, env: Env = process.env) {
  const name = SECRET_ENV[kind];
  if (env[name]) return env[name];
  if (env.NODE_ENV === "production") throw new Error(`${name} is not set. Production checks inbound ${kind} with it; the dev default works only outside production.`);
  return DEV_WEBHOOK_SECRET[kind];
}

// The site's public origin, which the provider signs. Never taken from request headers: a caller sets those.
export function publicBaseUrl(env: Env = process.env) {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  if (env.NODE_ENV === "production") throw new Error("PUBLIC_BASE_URL is not set. Production signs and checks inbound webhooks against it.");
  return "http://localhost:3000";
}

// The exact URL an inbound route's signature covers.
export const inboundUrl = (kind: InboundKind, env?: Env) => publicBaseUrl(env) + INBOUND_PATH[kind];

export function sign(secret: string, url: string, fields: [string, string][]) {
  // Sorted by name, then by value for a repeated name, as Twilio does.
  const sorted = [...fields].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  return createHmac("sha1", secret)
    .update(url + sorted.map(([k, v]) => k + v).join(""), "utf8")
    .digest("base64");
}

// True only for the signature of exactly these fields at exactly this URL. Constant-time compare.
export function verify(secret: string, url: string, fields: [string, string][], signature: string | null | undefined) {
  return !!signature && safeEqual(signature, sign(secret, url, fields));
}
