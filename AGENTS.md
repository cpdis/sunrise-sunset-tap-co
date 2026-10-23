# Agent rules for this repo

Colin's general rules load from his global setup on his machines and from the project instructions in cloud threads. This file holds only what is true for this repo.

## What this is
- A proof of concept for a co-owned, dry-hire tap truck in Perth. Nothing is bought or set up yet.
- Everything external is simulated: payments, SMS, email, bank. Do not add real accounts, keys, or webhooks.
- Data lives on the server, in Postgres. Locally and in tests it is PGlite (Postgres in WASM): `.data/pglite` for `npm run dev` (gitignored; delete it to reseed), in memory for tests. `DATABASE_URL` switches to hosted Postgres. The demo business is seeded once from `lib/seed.ts` (deterministic).
- Every record carries a business id (`tenant_id`), and every repo read and write filters on it (R16). Only the demo business (`DEMO_TENANT`) is seeded. Do not seed a second one.
- The browser holds no source of truth. Pages read `/api/state` and change data only through named commands on `/api/commands`.
- Colin deploys Vercel himself. Do not deploy, and do not change Vercel or DNS settings.

## Commands
- Install: `npm ci`.
- Run: `npm run dev` (http://localhost:3000). No env vars needed. On another port, set `PUBLIC_BASE_URL` to that origin, for example `PUBLIC_BASE_URL=http://localhost:3100 npx next dev -p 3100`: sign-in links and the Origin check use it.
- Verify: `npm run typecheck && npm test && npm run build`. Run it before every push.
- Injection eval: `npm run eval:injection` runs the review payloads on the live model. It needs `ANTHROPIC_API_KEY` and skips without one.
- Schema change: edit `lib/server/db/schema.ts`, then `npm run db:generate` writes the migration to `drizzle/`. Commit both. PGlite applies migrations on open; hosted Postgres needs `npm run db:migrate` with `DATABASE_URL` (Colin runs it at deploy).

## Env vars
- Outside production every one is optional: each secret has a dev default named `dev-only-...`. Production, and any run with `DATABASE_URL` set, refuses a secret that is missing, equal to a dev default, or shorter than 32 characters (`lib/server/secrets.ts`).
- Production requires `DATABASE_URL`, `SESSION_SECRET`, `APPROVAL_SECRET` (the owners' one-time codes), `PUBLIC_BASE_URL`, `TWILIO_AUTH_TOKEN`, `EMAIL_WEBHOOK_SECRET` and `CRON_SECRET`.
- `PUBLIC_BASE_URL`: the site's origin. Webhook signatures, sign-in links and checkout links use it, never request headers. With it set, a cookie-authenticated write must have it as its Origin, so each Vercel environment needs its own value.
- `DEMO_MODE` (`1`, `true` or `on`): in production, turns on the public `/outbox` with its simulated sign-in links, `/api/dev/simulate`, the widget's read of its own chat, the login owner picker and the demo-only commands (`reset`, `runJobs`) (KTD12). Outside production it is always on. These work only for a business whose tenant row has `demo` set, which only `seedDemo` sets; anywhere else they return 404 whatever `DEMO_MODE` says. A session cookie signed while the demo was on stops working when it goes off. Sign-in emails are simulated, so with it off nobody can sign in.
- `ANTHROPIC_API_KEY`: optional anywhere. Without it the rules engine answers.
- Never set or commit a real value for any of these.

## Where things live
- Business rules and prices: `lib/config.ts` (`DEFAULT_SETTINGS`). The site, checkout, and agent read them from there. Never hard-code a price, fee, or notice period in a page or in agent copy.
- Domain logic and scheduled jobs: `lib/domain.ts` (`runJobs`, ledger `post` and `pay`) and `lib/ops.ts` (`runScheduled`, owner changes). Both are pure functions on the data.
- Storage: `lib/server/db/` (`schema.ts`, `client.ts`, `repo.ts`). `repo.mutate` loads the business's document, runs a synchronous domain function, and saves by compare-and-swap. Never call the model or the network inside it.
- Commands and roles: `lib/server/commands.ts` (public, customer link token, owner, director). Every command takes an idempotency key, stored as `cmd:<key>` and bound to the command, its arguments and its caller: a replay that differs gets 422. The guardrail settings (`GUARDRAIL_SETTINGS` in `lib/config.ts`) are a director's to change. Lowering the payout approvals and moving shares wait on the document (`requests`) until a second, different director approves them in the admin (`lib/ops.ts` `requestChange`).
- Contacts: every route stores a phone or email through `normalContact` (`lib/util.ts`) and compares with `sameContact`. One phone or email holds at most one unpaid date (`createHold`).
- Sessions: `lib/server/auth.ts`. `POST /api/session` puts a simulated magic link in the outbox. The link opens `/login/confirm` with its token in the fragment, and the page's button posts it to `/api/session/confirm`, which sets a signed, tenant-bound, httpOnly cookie. A GET of the link changes nothing. The cookie carries the owner's session version: signing out (`DELETE /api/session`) bumps it and ends that owner's sessions on every device. The business and owner come from the session, never from a request body.
- Secrets: `lib/server/secrets.ts` reads each one, applies the production rules above, and compares secrets in constant time.
- What each caller sees: `lib/views.ts` (`stateFor`), served by `/api/state`.
- Inbound messages: `/api/inbound/sms` and `/api/inbound/email`, signed with Twilio's HMAC scheme (`lib/server/signature.ts`, `lib/server/inbound.ts`). The business comes from the signed `To`. The SMS widget and inbox simulator post to `/api/dev/simulate`, which signs on the server. A signed-in owner may text there only as their own number.
- Limits: `lib/server/limits.ts`. Inbound: per sender, per business, daily model token budget. Browser routes: sign-in links, the public `book` command and the simulator, per client IP and per contact. The IP is Vercel's `x-real-ip`; off Vercel every request shares one window.
- Agent: the turn runs on the server (`lib/server/agent.ts`). Tools in `lib/agent/tools.ts`, Claude path in `lib/agent/claude.ts`, no-key fallback in `lib/agent/rules.ts`. Keep both paths in step when a tool changes. Customer text reaches a model only inside the untrusted marker (`lib/agent/untrusted.ts`). Owners test draft knowledge at `/api/agent/preview`.
- Owner agent: a text from an owner's phone gets it. Tools in `lib/agent/owner-tools.ts`, Claude path `lib/agent/owner-claude.ts`, fallback `lib/agent/owner-rules.ts`. The changes themselves live in `lib/ops.ts`, which the admin buttons call too. Every change is staged in the approvals table (`lib/server/approvals.ts`) and runs only on YES with its nonce; money, settings, knowledge and drafts also need the 6-digit code from that owner's admin. Three wrong codes close an approval; five wrong codes from one number in a Perth day pause its changes by text until midnight and alert the owners once (`lib/server/limits.ts`).
- Codes are never stored: a message that answers with a code, and the agent's reply that quotes one, are stored masked ("YES ••••", `lib/agent/confirm.ts`). Only the handset gets them: the TwiML reply, and in the demo the simulator's `handset` field, which the widget shows. Tests read the reply from `agentTurn(...).reply`, not from the stored conversation.
- Scheduled jobs: `GET /api/jobs` (`lib/server/jobs.ts`), bearer `CRON_SECRET`, daily cron in `vercel.json`. The browser runs no jobs.
- Outbox: `lib/server/outbox.ts`. Everything the business would send is a row in the `outbox` table, written in the same transaction as its change. Owners read it at `/admin/outbox`. It keeps only each owner's newest sign-in link, and the daily job drops rows older than 7 days.
- Design tokens: `app/globals.css`. The source design language is `/mnt/project-files/design-language/tokens.css` in the project folder (Golden Hour). Use the tokens. Do not add new colours or fonts without asking.

## Rules for changes
- A change to money logic (deposits, bonds, refunds, payouts, GST) needs proof: show the before and after numbers from the seeded data, and check them by hand or with a script.
- A change to agent behaviour needs proof: run the affected conversation in the SMS simulator 3 times and report the pass count.
- A new query or route takes the business id and filters on it. Add a case to `tests/server/tenancy.test.ts`.
- UI changes need screenshots at 375, 768, and 1440 px.
- The agent never promises a text it does not send, and never books or cancels after an owner takes over.
- Customer copy is Australian English.
