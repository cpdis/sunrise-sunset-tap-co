// The scheduled jobs, on the server (R4): expired holds, balances due, bond holds, closing finished hires and the
// quarter's payout record run for every business without a browser open. Vercel Cron calls GET /api/jobs once a
// day (vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
import * as ops from "@/lib/ops";
import { safeEqual } from "@/lib/util";
import type { Repo } from "./db/repo";

type Env = Partial<Record<"NODE_ENV" | "CRON_SECRET", string>>;

// Works only outside production. Production without CRON_SECRET refuses every call.
export const DEV_CRON_SECRET = "dev-only-cron-secret";

export function cronSecret(env: Env = process.env) {
  if (env.CRON_SECRET) return env.CRON_SECRET;
  if (env.NODE_ENV === "production") throw new Error("CRON_SECRET is not set. Production checks the jobs route with it; the dev default works only outside production.");
  return DEV_CRON_SECRET;
}

// True only for exactly `Bearer <secret>`. Constant-time compare.
export function authorised(req: Request, env?: Env) {
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${cronSecret(env)}`);
}

export interface JobsRun {
  tenant: string;
  // What ran, as the activity log words it; or why the business was skipped.
  ran: string[];
  error?: "conflict" | "not_found";
}

// Runs the jobs for each business in its own repo.mutate, so they save together, once, or not at all. One
// business failing doesn't stop the others.
export async function runAllJobs(repo: Repo, now = new Date()): Promise<JobsRun[]> {
  const out: JobsRun[] = [];
  for (const tenant of await repo.tenantIds()) {
    const r = await repo.mutate(tenant, (d) => ops.runScheduled(d, now));
    out.push(r.ok ? { tenant, ran: r.value } : { tenant, ran: [], error: r.reason });
  }
  return out;
}

// GET /api/jobs. 401 without the secret, and nothing runs.
export async function jobsHandler(req: Request, repo: () => Promise<Repo>, now?: Date): Promise<Response> {
  if (!authorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const runs = await runAllJobs(await repo(), now);
  return Response.json({ runs }, { status: runs.some((r) => r.error) ? 500 : 200, headers: { "cache-control": "no-store" } });
}
