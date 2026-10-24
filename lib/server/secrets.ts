// The server's secrets, read from env when used (A3). Outside production a dev default stands in, so the demo and
// the tests need no setup. Production, or any run with DATABASE_URL set (a dev server pointed at real data), takes
// only a real secret: never one of the dev defaults below, and at least MIN_SECRET_CHARS long. A missing or weak one
// throws where it is used, so its route fails closed.
import { createHash, timingSafeEqual } from "node:crypto";

export type Env = Readonly<Record<string, string | undefined>>;

export const DEV_SECRETS = {
  SESSION_SECRET: "dev-only-session-secret",
  APPROVAL_SECRET: "dev-only-approval-secret",
  TWILIO_AUTH_TOKEN: "dev-only-twilio-auth-token",
  EMAIL_WEBHOOK_SECRET: "dev-only-email-webhook-secret",
  CRON_SECRET: "dev-only-cron-secret",
} as const;

export type SecretName = keyof typeof DEV_SECRETS;

// A Twilio auth token is 32 characters, the shortest real secret here.
export const MIN_SECRET_CHARS = 32;

const DEV_VALUES: readonly string[] = Object.values(DEV_SECRETS);

export function secret(name: SecretName, env: Env = process.env): string {
  const value = env[name];
  if (env.NODE_ENV !== "production" && !env.DATABASE_URL) return value || DEV_SECRETS[name];
  if (!value) throw new Error(`${name} is not set. Production, and any run with DATABASE_URL, needs it; the dev default works only outside them.`);
  if (DEV_VALUES.includes(value) || value.length < MIN_SECRET_CHARS) {
    throw new Error(`${name} is a dev default or shorter than ${MIN_SECRET_CHARS} characters. Set a long random value.`);
  }
  return value;
}

// Compares two secrets in constant time. Both sides are hashed first, so a guess of the wrong length takes the same
// path as one of the right length, and the timing says nothing about the secret's length (F13).
export function secretEqual(a: string, b: string) {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
