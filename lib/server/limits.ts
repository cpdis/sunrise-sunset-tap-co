// Rate limits and the model spend ceiling (KTD8, R17), counted in Postgres so they hold across serverless
// instances. Inbound messages key on the business and the signed sender, never on the IP: every Twilio webhook comes
// from a few shared addresses. The browser routes (A6) key on the client IP as Vercel reports it and on the contact
// they name.
import { BUSINESS } from "@/lib/config";
import { todayISO } from "@/lib/util";
import type { Repo } from "./db/repo";
import type { Env } from "./secrets";

// Messages a minute from one sender, and to one business from everyone.
export const SENDER_PER_MINUTE = 20;
export const TENANT_PER_MINUTE = 120;
// Model tokens (input and output) one business may spend in a Perth day. Past it the rules engine answers.
export const DAILY_TOKENS = 1_000_000;

interface Limit {
  max: number;
  minutes: number;
}

// The browser routes' windows (A6).
export const WEB_LIMITS = {
  // Sign-in links asked for one email, and from one IP.
  linkPerEmail: { max: 5, minutes: 15 },
  linkPerIp: { max: 20, minutes: 15 },
  // Public commands (the /book form's `book`) from one IP, and for one phone number or email.
  publicPerIp: { max: 10, minutes: 60 },
  publicPerContact: { max: 5, minutes: 60 },
  // Different numbers one IP texts as through the demo simulator, so a new number for every message can't dodge the
  // per-sender limit.
  simulateNumbersPerIp: { max: 10, minutes: 60 },
} satisfies Record<string, Limit>;

// Fixed windows: a window of `minutes` starts at each multiple of it since the epoch.
const windowOf = (now: Date, minutes: number) => {
  const ms = minutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
};

// Midnight in Perth (UTC+8, no daylight saving).
const perthDay = (now: Date) => new Date(`${todayISO(now)}T00:00:00+08:00`);

// A phone number or email as a counter key, ignoring spacing and case.
export const contactKey = (x: string) => x.replace(/\s+/g, "").toLowerCase();

// Counts one hit in the bucket's current window and says whether it went over the limit.
async function over(repo: Repo, tenant: string, bucket: string, limit: Limit, now: Date) {
  return (await repo.bump(tenant, bucket, windowOf(now, limit.minutes))) > limit.max;
}

// Counts one message and says which limit it broke, if any. The sender's limit is checked first, so one noisy
// sender doesn't use up the business's minute for everyone else.
export async function admit(repo: Repo, tenant: string, sender: string, now = new Date()): Promise<"sender" | "tenant" | undefined> {
  if (await over(repo, tenant, `sender:${contactKey(sender)}`, { max: SENDER_PER_MINUTE, minutes: 1 }, now)) return "sender";
  if (await over(repo, tenant, "tenant", { max: TENANT_PER_MINUTE, minutes: 1 }, now)) return "tenant";
}

// The caller's IP, for the browser routes' limits. Only Vercel's word counts: it sets x-real-ip and overwrites
// x-forwarded-for with the client's address, so a caller can't choose either there. Anywhere else both are the
// caller's to set, so every request shares one window instead: tighter, never looser.
export function clientIp(req: Request, env: Env = process.env) {
  if (!env.VERCEL) return "local";
  const ip = (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim().toLowerCase();
  return ip.includes(":") ? ipv6Subnet(ip) : ip || "unknown";
}

// One IPv6 subscriber usually holds a whole /64, so its first four groups are the IP that counts. An IPv4 address
// written as IPv6 (::ffff:198.51.100.1) is that IPv4 address.
function ipv6Subnet(ip: string) {
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) return v4[1];
  const [head, tail] = ip.split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// A sign-in link request: counted per IP, then per email. The same for any address, so the answer never says which
// addresses are owners'.
export async function linkLimited(repo: Repo, tenant: string, ip: string, email: string, now = new Date()) {
  return (await over(repo, tenant, `link:ip:${ip}`, WEB_LIMITS.linkPerIp, now)) || (await over(repo, tenant, `link:${contactKey(email)}`, WEB_LIMITS.linkPerEmail, now));
}

// A public command: counted per IP when the caller has one, then per phone number and email it names.
export async function publicLimited(repo: Repo, tenant: string, ip: string | undefined, contacts: (string | undefined)[], now = new Date()) {
  if (ip !== undefined && (await over(repo, tenant, `public:ip:${ip}`, WEB_LIMITS.publicPerIp, now))) return true;
  for (const c of new Set(contacts.filter((x): x is string => !!x?.trim()).map(contactKey))) {
    if (await over(repo, tenant, `public:${c}`, WEB_LIMITS.publicPerContact, now)) return true;
  }
  return false;
}

// The demo simulator lets anyone text as any number. A number this IP hasn't used yet in the window counts against
// simulateNumbersPerIp; past it, new numbers are refused and the ones already used still work.
export async function newNumberRefused(repo: Repo, tenant: string, ip: string, contact: string, now = new Date()) {
  const limit = WEB_LIMITS.simulateNumbersPerIp;
  const at = windowOf(now, limit.minutes);
  const seen = `sim:${ip}:${contactKey(contact)}`;
  if ((await repo.counted(tenant, seen, at)) > 0) return false;
  if ((await repo.bump(tenant, `sim:${ip}`, at)) > limit.max) return true;
  await repo.bump(tenant, seen, at);
  return false;
}

// Records the tokens one model call spent.
export async function spend(repo: Repo, tenant: string, tokens: number, now = new Date()) {
  if (tokens > 0) await repo.bump(tenant, "tokens", perthDay(now), Math.round(tokens));
}

// True once today's tokens reach the ceiling. The first time each day, the owners get one alert in the outbox.
export async function overBudget(repo: Repo, tenant: string, now = new Date()) {
  const day = perthDay(now);
  if ((await repo.counted(tenant, "tokens", day)) < DAILY_TOKENS) return false;
  if (await repo.claimKey(tenant, `budget-alert:${todayISO(now)}`, "budget_alert")) {
    await repo.writeOutbox(tenant, {
      channel: "email",
      to: BUSINESS.email,
      subject: "The agent hit its daily model budget",
      body: `The agent has used its ${DAILY_TOKENS.toLocaleString("en-AU")} model tokens for today. Until midnight the rules engine answers instead. Check the inbox for anything it couldn't handle.`,
    });
  }
  return true;
}
