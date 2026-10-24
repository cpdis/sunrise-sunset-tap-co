import type { Metadata } from "next";
import Link from "next/link";
import { Frame } from "@/components/story/Frame";
import { Note, Term } from "@/components/story/Marks";
import { Sketch } from "@/components/story/Sketch";
import { BookingLife, OwnerTiers, PayoutCalc, QuoteCalc, Thread } from "@/components/story/Widgets";
import { GST_THRESHOLD, LATEST_FINISH } from "@/lib/config";
import { BALANCE_RETRIES, RELEASE_UNPAID_DAYS, RESERVE_BUFFER } from "@/lib/domain";
import { money } from "@/lib/util";
import { storyData } from "./data";
import { diagrams } from "./diagrams";

export const metadata: Metadata = {
  title: "How the tap truck runs itself · Sunrise Sunset Tap Co.",
  description: "How people book, how the agent works, how money moves and how the owners run one tap truck with no staff. Live demo, real numbers from the simulated year.",
};

const REPO = "https://github.com/cpdis/sunrise-sunset-tap-co";

export default function HowItWorks() {
  const D = storyData();
  const { s } = D;
  const g = diagrams(s, D.owners);
  const life = D.life.ok;
  const payDay = life.days.find((d) => d.events.some((e) => e.startsWith("Charged balance")));

  return (
    <article className="col">
      <h1>How the tap truck runs itself</h1>
      <p className="byline">For review · proof of concept · 23 October 2026</p>

      <p>We want to buy one tap truck and hire it out across Perth. We have no staff. Somebody still has to answer the texts, take the money, chase the balance, and work out what each owner gets.</p>
      <p>So software does the desk work, and owners do the driving. This page shows how. Every number and every text on it comes from running the demo&apos;s own code against its simulated year of trading.</p>
      <p>This is the booking page, live, with made-up data. Pick a date and go through to checkout. The card <code>4242 4242 4242 4242</code> pays.</p>

      <div className="wide">
        <Frame src="/book" title="The booking page, demo data" height={760} phoneHeight={660} />
      </div>

      <h2 id="wired">How it&apos;s wired</h2>
      <div className="blk out">
        <Sketch cfg={g.wired} />
      </div>
      <p>Tap a card to see what it does. Press a button under the diagram to watch a booking, a hand-over or a payday move through it. In order:</p>
      <ol className="plain">
        <li>A customer texts, emails, calls or uses the web form. One <Term sketch="wired" nodes="agent" edges="cust>agent">booking agent</Term> answers all of them.</li>
        <li>It checks the <Term sketch="wired" nodes="cal" edges="agent>cal">calendar</Term>, holds the date and sends a link. The customer pays a {money(s.deposit)} deposit.</li>
        <li><Term sketch="wired" nodes="jobs,pay" edges="jobs>pay">Scheduled jobs</Term> charge the balance {s.balanceDaysBefore} days out and hold a {money(s.bond)} bond {s.bondHoldDaysBefore} days out.</li>
        <li>Every dollar goes in the <Term sketch="wired" nodes="ledger" edges="pay>ledger">ledger</Term>. Customer money stays a liability until the hire happens.</li>
        <li>Anything odd goes to the <Term sketch="wired" nodes="inbox,owners" edges="agent>inbox,inbox>owners">owners&apos; inbox</Term>. Owners answer in the admin, or by text to the <Term sketch="wired" nodes="ownagent" edges="owners>ownagent">owner agent</Term>.</li>
        <li>Each quarter the system proposes a <Term sketch="wired" nodes="payout" edges="ledger>payout,payout>owners">payout</Term>. {s.approvalsRequired} directors approve it.</li>
      </ol>
      <p>The rest is one part at a time.</p>

      <h2 id="booking">Booking</h2>
      <div className="blk out">
        <Sketch cfg={g.booking} />
      </div>
      <p>There are two ways in: the website, and a text. Both use the same calendar and the same checkout. Both need the hire terms accepted before money moves.</p>
      <p>The rules are short. One hire a day. At least <Note note="Inside the notice period, the agent asks an owner instead of saying no." ink="gold">{s.minNoticeDays} days&apos; notice</Note> online, up to {s.bookAheadMonths} months ahead. Taps close by {LATEST_FINISH - 12} pm. Delivery is measured from the Perth CBD, and anything more than {s.travelThresholdMin} minutes away adds {money(s.travelFee)}. Try a suburb:</p>
      <div className="blk out">
        <QuoteCalc s={s} suburbs={D.suburbs} />
      </div>
      <p>This is a booking by text, run through the agent&apos;s rules engine. The handwriting in blue says what the agent did as well as reply.</p>
      <div className="blk out">
        <div className="panel"><Thread lines={D.chats.book} who="Sam" /></div>
      </div>
      <p>A hold lasts {s.holdMinutes} minutes. If nobody pays, the date is free again the minute the hold lapses. The deposit link carries a private token, so only the person who got the text can open that booking. One number holds one unpaid date at a time: ask for a second and you get the first link again. An owner&apos;s own-use day gives way only when a deposit is paid, not when someone asks. Then the booking runs itself. Drag the slider to walk Sam&apos;s {life.ref} from the day of the text to the day after the hire. Switch the card to see what happens when it declines.</p>
      <div className="blk out">
        <BookingLife life={D.life} />
      </div>
      <p>On {payDay ? new Date(payDay.date + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }) : "the balance day"}, {s.balanceDaysBefore} days out, a job charges the saved card. If the card declines, it tries once a day for {BALANCE_RETRIES} days, then flags an owner. If the balance is still unpaid {RELEASE_UNPAID_DAYS} days out, the date goes back on the calendar and the deposit is kept.</p>
      <p>Cancellations follow one rule. More than {s.cancelDays} days out, a full refund. {s.cancelDays} days or less, the deposit is kept and the rest comes back. A refund over {money(s.refundLimit)} waits for an owner, whether the customer asks by text or on their booking page. Until an owner approves, nothing is cancelled.</p>

      <h2 id="agent">The agent</h2>
      <div className="blk out">
        <Sketch cfg={g.agentFocus} />
      </div>
      <p>The agent runs on the server. A text arrives at <code>/api/inbound/sms</code> signed the way Twilio signs it, and an unsigned or forged one is refused. The server loads the business&apos;s own data, so nothing the sender claims about the calendar or the customer is trusted. The agent runs its tools and returns a reply plus a list of actions. Then a short, separate write applies the actions and checks the data again, so two texts can&apos;t take the same date. The model never runs inside that write.</p>
      <div className="blk out">
        <Sketch cfg={g.agent} />
      </div>
      <p>With an API key, the agent is Claude. Without one, a <Note note="Deterministic intent matching. The tests run against it, so it can't drift from Claude without a test failing.">rules engine</Note> runs the same tools. Its prompt is the {D.kbPages} knowledge pages that owners edit in the admin, with prices filled in from settings on every message. Customer text reaches the model marked as untrusted, and code, not the model, decides what each tool may do.</p>
      <p>It hands a conversation to an owner when it should not decide alone:</p>
      <ul className="plain">
        <li>the customer asks for a person;</li>
        <li>a discount, a multi-day hire or a sponsor;</li>
        <li>a date inside the {s.minNoticeDays}-day notice period;</li>
        <li>a refund over {money(s.refundLimit)};</li>
        <li>a suburb it doesn&apos;t know, or a date it can&apos;t pin down after two tries.</li>
      </ul>
      <p>Two of those, run through the rules engine:</p>
      <div className="blk out">
        <div className="panel"><Thread lines={[...D.chats.offPolicy, ...D.chats.short]} /></div>
      </div>
      <p>Yes has to mean yes. Before it cancels or holds, the agent quotes exactly what will happen, and only a clear yes to that quote does it. &ldquo;No&rdquo;, &ldquo;wait&rdquo; or a change of subject drops it, and the next yes needs a fresh quote. A cancel also needs the 4-digit code from the quote. It goes only to the customer&apos;s real phone, so someone faking their number can&apos;t cancel. {D.chats.cancel.who} cancelling {D.chats.cancel.ref}:</p>
      <div className="blk out">
        <div className="panel"><Thread lines={D.chats.cancel.lines} who={D.chats.cancel.who} /></div>
      </div>
      <p>It only talks about bookings on the number or email that is texting. The same reference from another phone gets one line and no details:</p>
      <div className="blk out">
        <div className="panel"><Thread lines={D.chats.cancel.stranger} /></div>
      </div>
      <p>After a hand-over it keeps answering questions, but it will not book or cancel. It never promises what it can&apos;t do: it says the owners have the message, not when or how they will reply, and a refund is &ldquo;requested&rdquo;, not on its way. An owner still has to reply, and the inbox keeps that thread at the top until one does.</p>
      <div className="blk out">
        <div className="panel"><Thread lines={D.chats.handover} /></div>
      </div>

      <h2 id="inbox">The owners&apos; inbox</h2>
      <div className="blk out">
        <Sketch cfg={g.inbox} />
      </div>
      <p>The inbox is a queue. Every conversation, on every channel, sits in one of four groups, worst first: <strong>Needs you</strong>, <strong>Owners handling</strong>, <strong>Agent handled</strong> and <strong>Owner line</strong>.</p>
      <p>A hand-over arrives with a reason and, where the agent can write one, a draft reply. An owner can send the draft as it is, edit it, or write their own. A reply goes back the way the customer came in: a text to a phone number, an email to an email address.</p>
      <p>An owner can&apos;t <Term sketch="inbox" nodes="back" edges="handling>back">hand back</Term> to the agent while the customer is still waiting on the reply they were promised. The admin button and the owner agent use the same guard.</p>
      <div className="wide">
        <Frame src="/admin/inbox" title="The owners' inbox, demo data" height={760} phoneHeight={660} />
      </div>
      <p className="small">The admin needs a sign-in. Pick an owner and the sign-in link is emailed. In the demo the email is simulated, so open the outbox, open the link and press Sign in. The link works once. Then choose Inbox.</p>

      <h2 id="owners">Owners by text</h2>
      <div className="blk out">
        <Sketch cfg={g.owners} />
      </div>
      <p>An owner who texts the business line from their own phone gets the owner agent. It can do what the admin does, sorted by what is at stake:</p>
      <div className="blk out">
        <OwnerTiers
          tiers={[
            { label: "Answers", say: "Questions run at once: what's on, who has which run, what is owed. Nothing changes.", lines: D.chats.owner.read },
            { label: "YES + code", say: "Every change is staged and quoted back with a 4-digit code: claim a run, log the truck, block a date, reply to a customer. Only YES with that code runs it. NO, or any other text, drops it.", lines: D.chats.owner.now },
            { label: "Admin code", say: "Money, settings, knowledge and sending a draft also need the 6-digit code shown in that owner's signed-in admin. A bare yes does nothing.", lines: [...D.chats.owner.yes, ...D.chats.owner.setting] },
            { label: "Guarded", say: "A hand-back is refused while a customer is owed a reply. A draft goes out only after YES and the code, quoted in full. If two conversations share a name, the agent lists both with masked contacts and asks which one. It never guesses.", lines: D.chats.owner.draft },
            { label: "Admin only", say: `Prices, the deposit, the bond, fees, tax, the reserve, the cancel window, the refund limit and approvals stay in the admin. So do refunds over ${money(s.refundLimit)}, expenses over ${money(s.smsExpenseCap)}, bond captures and share transfers.`, lines: D.chats.owner.admin },
          ]}
        />
      </div>
      <p>Why two codes? <Note note="A spoofed text arrives from the owner's number, but the reply with the code goes to the owner's real phone." ink="gold">Caller ID can be faked</Note>. The 4-digit code goes only to the real phone, and the 6-digit code is only in the owner&apos;s signed-in admin. Codes are never stored: the saved thread shows &ldquo;YES ••••&rdquo;. Three wrong codes close a change. Five in a day stop changes by text from that number until midnight, and the owners are told.</p>
      <p>The admin-only list is there for a reason. Over text, one owner could otherwise change a price, or lower the approvals a payout needs and then approve and pay it alone. In the admin, only a director changes the refund limit, the SMS expense limit or the approvals a payout needs. Lowering the approvals needs a second director too.</p>

      <h2 id="money">Money</h2>
      <div className="blk out">
        <Sketch cfg={g.money} />
      </div>
      <p>Customer money is not ours until the hire happens. A deposit or a balance goes into <strong>Payments held</strong>, a liability. On the hire day it moves to revenue. If a customer cancels inside {s.cancelDays} days, the deposit moves to revenue then.</p>
      <p>Here is Sam&apos;s {money(life.days[life.days.length - 1].earned)} hire in the ledger, from the slider above:</p>
      <div className="blk out">
        <div className="panel scrollx">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Account</th><th>Memo</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {life.days[life.days.length - 1].ledger.map((e, k) => (
                <tr key={k}><td className="nw">{new Date(e.date + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })}</td><td>{e.account}</td><td>{e.memo}</td><td className="r">{money(e.amount, e.amount % 1 !== 0)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p>Card fees come off at each charge. Fuel, CO2, line cleaning and a glass allowance are posted when the hire closes. Each delivery and each collection earns the owner who ran it {money(s.runnerFee)}. That is an expense now, and money owed to that owner until the next payout.</p>
      <p>The truck loses value too. It is <Note note="Straight line over 8 years, the ATO effective life for a light truck. A non-cash cost, so it lowers profit but not the bank balance.">depreciated every month</Note>, so profit is honest about what the truck costs.</p>

      <h3>The quarterly payout</h3>
      <p>At the end of each quarter the system proposes a payout. It runs two tests and pays the smaller. Profit: what is left after a {Math.round(s.taxRate * 100)}% tax provision. Cash: what is in the bank after customer money, runner fees owed, the reserve and the tax are kept back. Pick a quarter from the simulated year:</p>
      <div className="blk out">
        <PayoutCalc payouts={D.payouts} approvalsRequired={s.approvalsRequired} />
      </div>
      <p>The cash test runs again at the moment the payout is paid, not only when it is proposed. If customer money has come in since, the payout waits. Only current directors can approve and pay. Each runner fee is paid once, to the cent.</p>
      <p>The reserve is {s.reserveMonths} months of fixed costs, plus {Math.round(s.maintPerKm * 100)}¢ for every km driven in the last year, plus {money(RESERVE_BUFFER)}. Each owner&apos;s share rounds down to $10. Runner fees go in the same bank transfer.</p>
      <p><strong>GST.</strong> The company does not register until turnover nears {money(GST_THRESHOLD)} a year. Prices exclude GST. The Money page in the admin watches the last 12 months and the next 12, and warns at 80% of the threshold.</p>

      <h2 id="truck">The truck</h2>
      <div className="blk out">
        <Sketch cfg={g.truck} />
      </div>
      <p>The physical work is owners&apos; work, and it is paid. Any owner claims a delivery or a collection in the admin, or by text: &ldquo;I&apos;ll take the Fremantle delivery.&rdquo; Owners supply the CO2 and couplers and clean the lines after each hire.</p>
      <p>The bond hold stays on the customer&apos;s card after the hire. The owner who brings the truck home checks it and taps <strong>Returned clean</strong>. Nothing else releases a bond.</p>
      <p>The calendar has three kinds of day. A paid booking. An owner&apos;s own use, which is free but pays its own fuel and damage, and which a paid booking bumps. A blocked day, for a service or a holiday.</p>
      <p>The truck log keeps the odometer, gas and issues. A reading lower than the last one is refused, and so is a jump too big to be one trip.</p>

      <h2 id="simulated">What&apos;s real and what&apos;s simulated</h2>
      <p>The rules, the ledger, the agents and the jobs are real code with tests. Everything they talk to is simulated:</p>
      <div className="blk out">
        <div className="panel scrollx">
          <table className="tbl">
            <thead><tr><th>In the demo</th><th>In production</th></tr></thead>
            <tbody>
              <tr><td>Postgres in the server (PGlite), one document per business</td><td>Neon Postgres, same schema</td></tr>
              <tr><td>Sign-in links in the outbox</td><td>Emailed links, owners only</td></tr>
              <tr><td>Simulated checkout</td><td>Stripe Checkout, card saved for the balance and bond</td></tr>
              <tr><td>Mock bank transfer</td><td>A business account with a payments API</td></tr>
              <tr><td>SMS panel, signed on the server</td><td>A Twilio number, SMS and voice, same signature check</td></tr>
              <tr><td>Inbox email, signed on the server</td><td>Resend, inbound and outbound</td></tr>
              <tr><td>Messages wait in the outbox</td><td>Twilio and Resend send what the outbox holds</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p>The real parts already run as they would in production. The data lives on the server and the browser only reads it and sends commands. Every record carries its business&apos;s id, and every read and write filters on it, so a second business could share the system. The jobs run once a day from Vercel Cron. A deploy migrates its own database before the new code goes live, and a failed migration stops the deploy. A preview deploy never touches the live database.</p>
      <p>Next: the <Link href="/plan">business plan</Link>, with what it costs and what we expect to make.</p>

      <hr />
      <section className="credits">
        <p className="cr-h">How this was made</p>
        <ul className="cr">
          <li><b>Code:</b> Next.js 15, React 19, Drizzle on Postgres (PGlite locally), zustand, chrono-node, <a href={REPO}>cpdis/sunrise-sunset-tap-co</a></li>
          <li><b>Agents:</b> Claude through the Anthropic SDK, with a rules engine for no-key demos</li>
          <li><b>Diagrams:</b> hand-drawn SVG, written for this page (no diagram library). Labels in Shantell Sans</li>
          <li><b>Look:</b> Golden Hour inks on white</li>
          <li><b>The making of:</b> the tools, models, decisions and timeline are on <Link href="/how-it-was-made">How this was made</Link></li>
          <li><b>Numbers:</b> the demo&apos;s seeded base-case year as of 22 October 2026. Illustrative only</li>
        </ul>
      </section>
    </article>
  );
}
