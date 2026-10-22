# Sunrise Sunset Tap Co.

Proof of concept for a co-owned, dry-hire tap truck business in Perth: public site with live availability and booking,
an AI booking agent across SMS, email, phone and web form, simulated Stripe payments, and an owners' portal that runs
the money from deposit to quarterly dividend.

Everything external is simulated. No accounts, keys or payments are needed to run it.

```bash
npm install
npm run dev        # http://localhost:3000
```

Optional: set `ANTHROPIC_API_KEY` and the agent switches from the built-in rules engine to Claude, using the same tools.

## What to try

| Where | What |
| --- | --- |
| `/` | Site. "Text us" opens an SMS simulator wired to the agent. Try "Is the second Saturday in December free?", then follow it through to a deposit link. |
| `/book` | Calendar, block, suburb (travel fee over 60 min), hire terms, then the simulated Stripe checkout. `4242…` pays, `4000 0000 0000 0002` declines. |
| `/booking/[id]` | Customer view: payment timeline, self-serve cancellation with the refund rule applied. |
| `/login` | Simulated magic link. Pick any owner. |
| `/admin` | Today: cash, unclaimed delivery and collection runs, conversations that need a person, payouts awaiting approval, job log. |
| `/admin/inbox` | All channels. Simulate an inbound email, call or web form; take over from the agent; hand back. |
| `/admin/payouts` | Quarterly distribution. Approve as one owner, "Switch owner", approve as a second, then pay (mock bank transfer). |
| `/admin/money` | 12-month revenue vs costs, quarterly P&L, GST threshold watch, ledger, add expense. |
| `/admin/knowledge` | Edit what the agent knows and test it against the draft. |
| `/admin/settings` | Prices and rules. Changes flow to the site, checkout and agent immediately. "Reset demo data" regenerates the year. |

## How it works

- **Data**: one simulated year of trading is generated on first load (`lib/seed.ts`, deterministic) and kept in
  `localStorage`. Every browser has its own copy. Scheduled jobs (`runJobs` in `lib/domain.ts`) run on load and every
  minute: expire unpaid holds after 30 minutes, charge balances 14 days out, place bond holds 2 days out, close past
  bookings and post their costs.
- **Money**: every payment posts to a simple ledger (`post`, `pay`). Distributions take quarterly profit, set aside a tax
  provision and a reserve (3 months fixed costs + $/km driven + $500 buffer), split by shareholding rounded down to $10,
  and need 2 owner approvals before paying out.
- **Agent**: `/api/agent` receives a snapshot of availability plus the conversation, runs tools
  (`check_availability`, `get_quote`, `hold_and_send_deposit_link`, `lookup_booking`, `cancel_booking`,
  `escalate_to_owner`) and returns a reply plus actions the client applies. With an API key it's Claude
  (`lib/agent/claude.ts`); without, a deterministic intent matcher (`lib/agent/rules.ts`). Refunds above the configured
  limit, discounts, multi-day and sponsor requests always go to an owner.

## Production path

| Demo | Production |
| --- | --- |
| localStorage | Supabase Postgres, row-level security, owners-only email sign-in |
| Simulated checkout | Stripe Checkout with `setup_future_usage: off_session`; balance and bond via off-session PaymentIntents; webhooks confirm |
| Mock bank | Business account with a payments API (e.g. Airwallex) for owner payouts |
| SMS simulator | Twilio number (SMS + voice with transcription) |
| Inbox email | Resend inbound/outbound |
| In-tab job runner | Vercel Cron |

## Stack

Next.js 15 (App Router), React 19, TypeScript, zustand, chrono-node, `@anthropic-ai/sdk`.
