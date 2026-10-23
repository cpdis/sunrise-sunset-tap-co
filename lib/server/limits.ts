// Rate limits and the model spend ceiling (KTD8, R17), counted in Postgres so they hold across serverless
// instances. They key on the business and the signed sender, never on the IP: every Twilio webhook comes from a
// few shared addresses, and an attacker can rotate X-Forwarded-For at will.
import { BUSINESS } from "@/lib/config";
import { todayISO } from "@/lib/util";
import type { Repo } from "./db/repo";

// Messages a minute from one sender, and to one business from everyone.
export const SENDER_PER_MINUTE = 20;
export const TENANT_PER_MINUTE = 120;
// Model tokens (input and output) one business may spend in a Perth day. Past it the rules engine answers.
export const DAILY_TOKENS = 1_000_000;

const minute = (now: Date) => new Date(Math.floor(now.getTime() / 60_000) * 60_000);
// Midnight in Perth (UTC+8, no daylight saving).
const perthDay = (now: Date) => new Date(`${todayISO(now)}T00:00:00+08:00`);

// Counts one message and says which limit it broke, if any. The sender's limit is checked first, so one noisy
// sender doesn't use up the business's minute for everyone else.
export async function admit(repo: Repo, tenant: string, sender: string, now = new Date()): Promise<"sender" | "tenant" | undefined> {
  const at = minute(now);
  if ((await repo.bump(tenant, `sender:${sender.replace(/\s+/g, "").toLowerCase()}`, at)) > SENDER_PER_MINUTE) return "sender";
  if ((await repo.bump(tenant, "tenant", at)) > TENANT_PER_MINUTE) return "tenant";
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
