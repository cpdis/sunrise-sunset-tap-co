import { LINK_MINUTES, demoFor } from "@/lib/server/auth";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";
import { LoginForm } from "./LoginForm";

// Reads the demo's owners at request time, never at build time.
export const dynamic = "force-dynamic";

// Owner sign-in by emailed link (KTD7). The demo lists its owners so a visitor can pick one, and the email lands in
// the simulated outbox (KTD12). Elsewhere, or once the business isn't the demo (A1), it is an email field only.
export default async function Login({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const repo = await getRepo();
  const demo = await demoFor(repo, DEMO_TENANT);
  const doc = demo ? await repo.load(DEMO_TENANT) : null;
  const owners = (doc?.data.owners ?? []).map(({ name, email }) => ({ name, email }));
  return <LoginForm owners={owners} demo={demo} minutes={LINK_MINUTES} expired={(await searchParams).link === "used"} />;
}
