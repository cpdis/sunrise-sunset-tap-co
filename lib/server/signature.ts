// Provider-shaped webhook signatures (KTD3). Both inbound routes use Twilio's scheme: a base64 HMAC-SHA1 over the
// public URL the provider posted to, followed by each form field's name and value, sorted by name. Setting the real
// Twilio auth token later is all a live number needs. The email route uses the same scheme with its own secret.
import { createHmac } from "node:crypto";
import { DEV_SECRETS, type Env, secret, secretEqual } from "./secrets";

export type InboundKind = "sms" | "email";

// A provider's form fields, by name. Each name appears once (formFields).
export type Fields = Record<string, string>;

export const INBOUND_PATH: Record<InboundKind, string> = { sms: "/api/inbound/sms", email: "/api/inbound/email" };
export const SIGNATURE_HEADER: Record<InboundKind, string> = { sms: "x-twilio-signature", email: "x-email-signature" };
const SECRET_NAME = { sms: "TWILIO_AUTH_TOKEN", email: "EMAIL_WEBHOOK_SECRET" } as const;

// Sign only outside production (lib/server/secrets.ts). Production takes only a real secret.
export const DEV_WEBHOOK_SECRET: Record<InboundKind, string> = { sms: DEV_SECRETS.TWILIO_AUTH_TOKEN, email: DEV_SECRETS.EMAIL_WEBHOOK_SECRET };

export const webhookSecret = (kind: InboundKind, env: Env = process.env) => secret(SECRET_NAME[kind], env);

// The site's public origin, which the provider signs and every link the site sends points at. Never taken from
// request headers: a caller sets those.
export function publicBaseUrl(env: Env = process.env) {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  if (env.NODE_ENV === "production") throw new Error("PUBLIC_BASE_URL is not set. Production signs and checks inbound webhooks against it.");
  return "http://localhost:3000";
}

// The exact URL an inbound route's signature covers.
export const inboundUrl = (kind: InboundKind, env?: Env) => publicBaseUrl(env) + INBOUND_PATH[kind];

// A posted form, read once: the fields the signature covers are the fields the route then reads (AUTH-02).
// Undefined when a name repeats. Sorted for signing, "From=a&From=b" can give the same string as a signed body whose
// text happens to run into a From, and a reader that kept the last From would act for a sender nobody signed.
export function formFields(body: string): Fields | undefined {
  // No prototype, so a field named "__proto__" is a field like any other.
  const out: Fields = Object.create(null);
  for (const [k, v] of new URLSearchParams(body)) {
    if (Object.hasOwn(out, k)) return undefined;
    out[k] = v;
  }
  return out;
}

export function sign(key: string, url: string, fields: Fields) {
  // Sorted by name, as Twilio does.
  const names = Object.keys(fields).sort();
  return createHmac("sha1", key)
    .update(url + names.map((k) => k + fields[k]).join(""), "utf8")
    .digest("base64");
}

// True only for the signature of exactly these fields at exactly this URL. Constant-time compare.
export function verify(key: string, url: string, fields: Fields, signature: string | null | undefined) {
  return !!signature && secretEqual(signature, sign(key, url, fields));
}
