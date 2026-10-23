import { getRepo } from "@/lib/server/db/repo";
import { jobsHandler } from "@/lib/server/jobs";

export const runtime = "nodejs";
// Runs on every call, never cached or prerendered.
export const dynamic = "force-dynamic";

// GET: the daily jobs for every business (lib/server/jobs.ts). Vercel Cron calls it with the CRON_SECRET bearer.
export function GET(req: Request) {
  return jobsHandler(req, getRepo);
}
