# Agent rules for this repo

Colin's general rules load from his global setup on his machines and from the project instructions in cloud threads. This file holds only what is true for this repo.

## What this is
- A proof of concept for a co-owned, dry-hire tap truck in Perth. Nothing is bought or set up yet.
- Everything external is simulated: payments, SMS, email, bank. Do not add real accounts, keys, or webhooks.
- The demo runs from one browser. Data lives in `localStorage`, seeded by `lib/seed.ts` (deterministic).
- Colin deploys Vercel himself. Do not deploy, and do not change Vercel or DNS settings.

## Commands
- Install: `npm ci`.
- Run: `npm run dev` (http://localhost:3000).
- Verify: `npm run typecheck && npm test && npm run build`. Run it before every push.

## Where things live
- Business rules and prices: `lib/config.ts` (`DEFAULT_SETTINGS`). The site, checkout, and agent read them from there. Never hard-code a price, fee, or notice period in a page or in agent copy.
- Domain logic and scheduled jobs: `lib/domain.ts` (`runJobs`, ledger `post` and `pay`).
- Agent: `app/api/agent`, tools in `lib/agent/tools.ts`, Claude path in `lib/agent/claude.ts`, no-key fallback in `lib/agent/rules.ts`. Keep both paths in step when a tool changes.
- Owner agent: a text from an owner's phone gets it. Tools in `lib/agent/owner-tools.ts`, Claude path `lib/agent/owner-claude.ts`, fallback `lib/agent/owner-rules.ts`. The changes themselves live in `lib/ops.ts`, which the admin buttons call too. Money, settings and knowledge edits are staged and need a YES.
- Design tokens: `app/globals.css`. The source design language is `/mnt/project-files/design-language/tokens.css` in the project folder (Golden Hour). Use the tokens. Do not add new colours or fonts without asking.

## Rules for changes
- A change to money logic (deposits, bonds, refunds, payouts, GST) needs proof: show the before and after numbers from the seeded data, and check them by hand or with a script.
- A change to agent behaviour needs proof: run the affected conversation in the SMS simulator 3 times and report the pass count.
- UI changes need screenshots at 375, 768, and 1440 px.
- The agent never promises a text it does not send, and never books or cancels after an owner takes over.
- Customer copy is Australian English.
