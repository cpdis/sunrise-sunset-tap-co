# Sunrise Sunset Tap Co.

Proof of concept for a co-owned, dry-hire tap truck business in Perth: public site with live availability and booking,
an AI booking agent across SMS, email, phone and web form, simulated Stripe payments, and an owners' portal that runs
the money from deposit to quarterly dividend.

Everything external is simulated. No accounts, keys or payments are needed to run it.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # domain rules and agent routing (vitest)
```

Optional: set `ANTHROPIC_API_KEY` and the agent switches from the built-in rules engine to Claude, using the same tools.
`/api/agent` only accepts same-origin requests and is rate limited per IP (20/min), so a public deploy can't be used
as a free Claude proxy.

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
| `/admin/settings` | Prices and rules. Changes flow to the site, checkout and agent immediately. "Reset demo data" regenerates the year. "Demo scenario" switches between bear, base and bull seeds; every KPI is labelled illustrative. |

## How it works

- **Data**: one simulated year of trading is generated on first load (`lib/seed.ts`, deterministic) and kept in
  `localStorage`. Every browser has its own copy. Scheduled jobs (`runJobs` in `lib/domain.ts`) run on load and every
  minute: expire unpaid holds after 30 minutes, charge balances 14 days out (a declined card retries daily for 3 days,
  then flags an owner; still unpaid 7 days out releases the date and keeps the deposit), place bond holds 2 days out,
  close past bookings and post their costs, post monthly truck depreciation (8-year straight line). Open the demo in
  one tab at a time; other tabs reload from storage when it changes.
- **Money**: every payment posts to a simple ledger (`post`, `pay`). Customer payments sit in a deposits liability and
  become revenue when the hire happens or the deposit is forfeited. Runner fees are an expense owed to the owner who
  ran it and go out with the quarterly payout. Distributions take quarterly profit, set aside a tax
  provision and a reserve (3 months fixed costs + $/km driven + $500 buffer), keep back customer money and runner fees owed,
  split by shareholding rounded down to $10, and need 2 director approvals before paying out.
- **Agent**: `/api/agent` receives a snapshot of availability plus the conversation, runs tools
  (`check_availability`, `get_quote`, `hold_and_send_deposit_link`, `lookup_booking`, `cancel_booking`,
  `escalate_to_owner`) and returns a reply plus actions the client applies. With an API key it's Claude
  (`lib/agent/claude.ts`); without, a deterministic intent matcher (`lib/agent/rules.ts`) that answers FAQs from the
  knowledge base pages, so an owner's edit changes both engines. Refunds above the configured limit, discounts,
  multi-day and sponsor requests, date changes, dates inside 7 days' notice and anything it can't pin down after two
  re-asks go to an owner. A hand-over only flags the conversation in the inbox (nobody is notified yet), so replies
  promise no time or call. Both engines cancel only after a quote and a clear YES to it, hold one unpaid date per
  contact, and treat someone else's SST- reference like an unknown one. After a hand-over it keeps answering FAQs but
  won't hold or cancel until handed back.

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
