// The scheduled jobs, on the server (R4): expired holds, balances due, bond holds, closing finished hires and the
// quarter's payout record run for every business without a browser open. Vercel Cron calls GET /api/jobs once a
// day (vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
import * as ops from "@/lib/ops";
import type { Repo } from "./db/repo";
import { DEV_SECRETS, type Env, secret, secretEqual } from "./secrets";

// Works only outside production (lib/server/secrets.ts). Production without a real CRON_SECRET refuses every call.
export const DEV_CRON_SECRET = DEV_SECRETS.CRON_SECRET;

export const cronSecret = (env: Env = process.env) => secret("CRON_SECRET", env);

// True only for exactly `Bearer <secret>`. Constant-time compare, which hides the secret's length too.
export function authorised(req: Request, env?: Env) {
  return secretEqual(req.headers.get("authorization") ?? "", `Bearer ${cronSecret(env)}`);
}

export interface JobsRun {
  tenant: string;
  // What ran, as the activity log words it; or why the business was skipped.
  ran: string[];
  error?: "conflict" | "not_found";
}

// Runs the jobs for each business in its own repo.mutate, so they save together, once, or not at all. One
// business failing doesn't stop the others. Then the business's old outbox rows and inbound message ids go
// (repo.prune).
export async function runAllJobs(repo: Repo, now = new Date()): Promise<JobsRun[]> {
  const out: JobsRun[] = [];
  for (const tenant of await repo.tenantIds()) {
    const r = await repo.mutate(tenant, (d) => ops.runScheduled(d, now));
    out.push(r.ok ? { tenant, ran: r.value } : { tenant, ran: [], error: r.reason });
    await repo.prune(tenant, now);
  }
  return out;
}

// GET /api/jobs. 401 without the secret, and nothing runs.
export async function jobsHandler(req: Request, repo: () => Promise<Repo>, now?: Date): Promise<Response> {
  if (!authorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const runs = await runAllJobs(await repo(), now);
  return Response.json({ runs }, { status: runs.some((r) => r.error) ? 500 : 200, headers: { "cache-control": "no-store" } });
}
