# Sunrise Sunset Tap Co.

Proof of concept for a co-owned, dry-hire tap truck business in Perth: public site with live availability and booking,
an AI booking agent across SMS, email, phone and web form, simulated Stripe payments, and an owners' portal that runs
the money from deposit to quarterly dividend.

Everything external is simulated. No accounts, keys or payments are needed to run it.

## Install and run

```bash
npm ci
npm run dev             # http://localhost:3000
npm test                # domain, agent, server and tenancy tests (vitest, in-memory PGlite)
npm run typecheck && npm test && npm run build   # the full check before a push
npm run eval:injection  # review injection payloads against the live model (needs ANTHROPIC_API_KEY)
```

Data lives on the server. Locally that is PGlite (Postgres compiled to WASM) in `.data/pglite`, created and seeded
with one simulated year on first start, and shared by every browser that opens the dev server. Set `DATABASE_URL` to
use hosted Postgres instead. No env var is needed locally: each secret has a `dev-only-...` default that throws in
production.

Optional: set `ANTHROPIC_API_KEY` and the agent switches from the built-in rules engine to Claude, using the same tools.
Messages reach the agent only through signed webhooks, `/api/inbound/sms` and `/api/inbound/email` (Twilio's
HMAC scheme over `PUBLIC_BASE_URL` plus the route path). The SMS widget and the inbox simulator post to
`/api/dev/simulate`, which signs on the server and works outside production or with `DEMO_MODE` on. Limits
live in Postgres: 20 messages a minute per sender, 120 per business, and a daily model token budget, past which the
rules engine answers and the owners get one alert in the outbox (`lib/server/limits.ts`).

## Debug

- Start from a fresh seed: stop the dev server, delete `.data/pglite`, start it again. In the app, Settings has
  "Reset demo data", which does the same for the running database.
- Sign in: on `/login`, pick an owner, then open the sign-in link in `/outbox`.
- Every SMS and email the business would send is in `/admin/outbox`. Run the daily jobs with "Run daily jobs now" in
  Settings, or `curl -H "Authorization: Bearer dev-only-cron-secret" http://localhost:3000/api/jobs`.
- Send a signed inbound text by hand: sign the form fields with the dev secret `dev-only-twilio-auth-token` (see
  `inboundReq` in `tests/helpers.ts`), or use the SMS widget on `/`.
- "Data version" errors: the stored document is older than `DATA_VERSION` in `lib/seed.ts`. Locally the demo
  reseeds itself; in production it refuses, so the document needs a migration first.
- A schema change: edit `lib/server/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`.
  PGlite applies it on the next start.

## What to try

| Where | What |
| --- | --- |
| `/` | Site. "Text us" opens an SMS simulator wired to the agent. Try "Is the second Saturday in December free?", then follow it through to a deposit link. |
| `/book` | Calendar, block, suburb (travel fee over 60 min), hire terms, then the simulated Stripe checkout. `4242…` pays, `4000 0000 0000 0002` declines. |
| `/booking/[id]` | Customer view: payment timeline, self-serve cancellation with the refund rule applied. |
| `/login` | Simulated magic link. Pick any owner. |
| `/admin` | Today: cash, unclaimed delivery and collection runs, conversations that need a person, payouts awaiting approval, job log. |
| `/admin/inbox` | All channels. Simulate an inbound email, call or web form; take over from the agent; hand back. |
| `/admin/outbox` | Every simulated SMS and email: owner notices for hand-overs, owners' replies to customers, alerts. |
| `/admin/payouts` | Quarterly distribution. Approve as one owner, "Switch owner", approve as a second, then pay (mock bank transfer). |
| `/admin/money` | 12-month revenue vs costs, quarterly P&L, GST threshold watch, ledger, add expense. |
| `/admin/knowledge` | Edit what the agent knows and test it against the draft. |
| `/admin/settings` | Prices and rules. Changes flow to the site, checkout and agent immediately. "Reset demo data" regenerates the year; "Run daily jobs now" runs the scheduled jobs. "Demo scenario" switches between bear, base and bull seeds; every KPI is labelled illustrative. |

## How it works

- **Data**: one simulated year of trading is generated on the server's first start (`lib/seed.ts`, deterministic) and
  kept in Postgres as one versioned document per business, saved by compare-and-swap (`lib/server/db/repo.ts`). Every
  row carries its business id, and every read and write filters on it. Pages read `/api/state`, which sends each
  caller only its view, and change data only through named commands on `/api/commands`. Scheduled jobs (`runScheduled` in `lib/ops.ts`) run on the server
  once a day from `/api/jobs` (see "Scheduled jobs" below), never in the browser: release expired unpaid holds (an
  expired hold frees its date at once; the job only tidies it up), charge balances 14 days out (a declined card retries
  daily for 3 days, then flags an owner; still unpaid 7 days out releases the date and keeps the deposit), place bond
  holds 2 days out, close past bookings and post their costs, post monthly truck depreciation (8-year straight line),
  and keep the latest quarter's payout record. In the demo, Settings has "Run daily jobs now", which runs the same jobs.
- **Money**: every payment posts to a simple ledger (`post`, `pay`). Customer payments sit in a deposits liability and
  become revenue when the hire happens or the deposit is forfeited. Runner fees are an expense owed to the owner who
  ran it and go out with the quarterly payout. Distributions take quarterly profit, set aside a tax
  provision and a reserve (3 months fixed costs + $/km driven + $500 buffer), keep back customer money and runner fees owed,
  split by shareholding rounded down to $10, and need 2 director approvals before paying out.
- **Agent**: a signed inbound message runs the agent on the server (`lib/server/inbound.ts`, `lib/server/agent.ts`). It runs tools
  (`check_availability`, `get_quote`, `hold_and_send_deposit_link`, `lookup_booking`, `cancel_booking`,
  `escalate_to_owner`) and applies its actions on the server after checking them again. With an API key it's Claude
  (`lib/agent/claude.ts`); without, a deterministic intent matcher (`lib/agent/rules.ts`) that answers FAQs from the
  knowledge base pages, so an owner's edit changes both engines. Refunds above the configured limit, discounts,
  multi-day and sponsor requests, date changes, dates inside 7 days' notice and anything it can't pin down after two
  re-asks go to an owner. A hand-over flags the conversation in the inbox and puts one notice for the owners in the
  outbox (who, why and a link to the conversation), so replies say an owner has been notified but promise no time or
  call. Both engines cancel only after a quote and a clear YES to it, hold one unpaid date per
  contact, and treat someone else's SST- reference like an unknown one. After a hand-over it keeps answering FAQs but
  won't hold or cancel until handed back.
- **Owner agent**: a text from an owner's own number gets the owner agent (`lib/agent/owner-*.ts`). Caller ID can be
  spoofed, so only reads run at once. Every change is staged in the approvals table and runs only on a reply of YES
  with the 4-digit code in the confirmation text. Money, settings, knowledge lines and draft sends also need the
  6-digit code at the top of that owner's admin pages (`lib/server/approvals.ts`). A YES runs the exact change it
  confirmed, once, within 10 minutes; if the change has moved on, the agent asks again.

## Scheduled jobs and the outbox

- `GET /api/jobs` runs the daily jobs for every business, each in one compare-and-swap write. It needs
  `Authorization: Bearer <CRON_SECRET>`; without it the answer is 401 and nothing runs. Outside production the dev
  default `dev-only-cron-secret` works, for example
  `curl -H "Authorization: Bearer dev-only-cron-secret" http://localhost:3000/api/jobs`. Production without
  `CRON_SECRET` refuses every call. Running it twice in a day charges nothing twice.
- `vercel.json` holds the cron entry: `/api/jobs` at 22:00 UTC (06:00 Perth) every day, the most a Hobby plan allows.
  To enable it at deploy: set `CRON_SECRET` in the Vercel project's environment (Vercel Cron sends it as the bearer
  token), then deploy. Vercel registers the cron from `vercel.json` on the production deployment.
- Everything the business would send goes to the `outbox` table, written in the same transaction as the change that
  sent it: sign-in links, owner notices when a conversation needs an owner, owners' replies to customers (as the SMS or
  email they would be) and the model budget alert. Owners read it at `/admin/outbox` (mail to another owner, such as
  their sign-in link, is left out). The public `/outbox` page exists only in demo mode, for sign-in links.

## Deploy checklist (Colin)

1. Database: add Neon Postgres from the Vercel Marketplace to the project. It sets `DATABASE_URL`.
2. Migrations: `DATABASE_URL=<from vercel env pull> npm run db:migrate` (`drizzle-kit migrate`). Run it again before
   each deploy that adds a file to `drizzle/`. The app never migrates hosted Postgres itself. The demo business seeds
   itself on the first request.
3. Env vars (Production): `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_BASE_URL` (the site's https origin, no trailing
   slash), `TWILIO_AUTH_TOKEN`, `EMAIL_WEBHOOK_SECRET`, `CRON_SECRET`. Use long random values for the secrets. Each one
   missing makes its route fail closed. `ANTHROPIC_API_KEY` is optional.
4. Public demo: set `DEMO_MODE=on`. It turns on `/outbox` (sign-in links), `/api/dev/simulate` (the SMS widget and
   inbox simulator) and the demo reset. Sign-in emails are simulated, so without it nobody can sign in.
5. Cron: `vercel.json` runs `/api/jobs` daily at 22:00 UTC. It works once `CRON_SECRET` is set (step 3).

## Production path

| Demo | Production |
| --- | --- |
| PGlite, simulated sign-in links in `/outbox` | Hosted Postgres (`DATABASE_URL`), owners-only emailed sign-in links |
| Simulated checkout | Stripe Checkout with `setup_future_usage: off_session`; balance and bond via off-session PaymentIntents; webhooks confirm |
| Mock bank | Business account with a payments API (e.g. Airwallex) for owner payouts |
| SMS simulator | Twilio number (SMS + voice with transcription) |
| Inbox email | Resend inbound/outbound |
| Simulated outbox (`/admin/outbox`) | Twilio and Resend send what the outbox holds |

## Stack

Next.js 15 (App Router), React 19, TypeScript, Drizzle ORM on Postgres (PGlite locally, node-postgres in production),
zustand, chrono-node, `@anthropic-ai/sdk`.
