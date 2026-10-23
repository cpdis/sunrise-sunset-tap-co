import type { Metadata } from "next";
import Link from "next/link";
import { Note } from "@/components/story/Marks";
import { Sketch, type SketchConfig } from "@/components/story/Sketch";
import { BUSINESS, LATEST_FINISH } from "@/lib/config";
import { BALANCE_RETRIES, RELEASE_UNPAID_DAYS } from "@/lib/domain";
import { money } from "@/lib/util";
import { planData } from "./data";

export const metadata: Metadata = {
  title: "Business plan · Sunrise Sunset Tap Co.",
  description: "Nine friends, one eight-tap kei truck, dry hire across Perth. What it costs, what it earns, and what we check before we buy.",
};

// Signed amounts for the tables: a loss shows as −$594.
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));

export default function Plan() {
  const P = planData();
  const { s, sc } = P;
  const b = sc.base;

  const ownership: SketchConfig = {
    id: "own",
    h: 300,
    mh: 354,
    mw: 100,
    nodes: [
      { id: "owners", t: `${P.owners} owners`, s: `${money(P.perOwner)} each`, at: [0.14, 60], note: `${P.names.join(", ")}. Equal shares, all directors.` },
      { id: "co", t: "Pty Ltd", s: `${money(P.capital)} capital`, hub: true, at: [0.5, 60], note: "Owns the truck, takes the bookings, keeps the ledger. Every owner sees everything in the admin." },
      { id: "truck", t: "Truck and kit", s: money(P.spent), at: [0.86, 60], note: `${money(P.left)} is left as opening cash.` },
      { id: "hires", t: `${b.hires} hires`, s: "the base year", at: [0.86, 220], note: `${b.h4} of 4 hours and ${b.h8} of 8 hours, mostly weekends, peaking October to March.` },
      { id: "pay", t: "Quarterly payout", s: "profit share + runs", at: [0.5, 220], note: `Base year: ${money(b.payoutEach)} each in profit share, plus about ${money(P.runnerEach)} each in runner fees.` },
      { id: "runs", t: "Runs", s: `${money(s.runnerFee)} a leg`, at: [0.14, 220], note: "Owners drive, set up and clean the lines. Each delivery and collection is paid." },
    ],
    edges: [
      { f: "owners", t: "co", l: "capital" },
      { f: "co", t: "truck", l: "buys" },
      { f: "truck", t: "hires" },
      { f: "hires", t: "pay", l: "profit" },
      { f: "pay", t: "owners", l: "each quarter" },
      { f: "owners", t: "runs", dash: true },
    ],
    flows: [
      {
        label: "Year one",
        steps: [
          { say: `${P.owners} owners put in ${money(P.perOwner)} each.`, go: ["owners", "co"], tag: money(P.capital) },
          { say: `The company buys the truck, the wrap and the kit for ${money(P.spent)}.`, go: ["co", "truck"], tag: money(P.spent) },
          { say: `In the base case it does ${b.hires} hires and makes ${money(b.profit)} before tax.`, go: ["truck", "hires"], tag: `${b.hires} hires` },
          { say: `After tax and a reserve, ${money(b.payoutEach)} goes to each owner over the year.`, go: ["hires", "pay", "owners"], tag: `${money(b.payoutEach)} each` },
        ],
      },
    ],
  };

  // Year-one profit by scenario, as horizontal bars on one zero line.
  const rows = [
    { k: "Bear", v: sc.bear },
    { k: "Base", v: sc.base },
    { k: "Bull", v: sc.bull },
  ];
  const lo = Math.min(0, ...rows.map((r) => r.v.profit));
  const hi = Math.max(...rows.map((r) => r.v.profit));
  const x = (n: number) => 120 + ((n - lo) / (hi - lo)) * 400;

  return (
    <article className="col">
      <h1>Business plan</h1>
      <p className="byline">Draft for the {P.owners} owners · v1 of 22 October 2026, numbers from the demo&apos;s simulated year</p>

      <p>We buy one 2018 Suzuki Carry tap truck, wrap it, and hire it out across Perth metro on a dry-hire basis. The client buys the drinks. We deliver a cold, clean, eight-tap truck with glassware, and we collect it after.</p>
      <p>Software takes the bookings, the payments and the questions. <Link href="/how-it-works">How it works</Link> shows that part. {P.owners} friends own it equally. Cold brew for the Wednesday hill run in the morning, beer at a wedding in the evening.</p>

      <figure className="wide photo">
        <img src="/plan/front.jpg" alt="The 2018 Suzuki Carry from the Marketplace listing, shown with the Sunrise Sunset wrap: white cab with three stripes, landscape poster on the box" width={1300} height={1267} style={{ maxHeight: 640, objectFit: "cover" }} />
        <figcaption>The truck from the listing, with the wrap we plan. The wrap is a mock-up.</figcaption>
      </figure>

      <h2>The ask</h2>
      <p>Each owner puts in <strong>{money(P.perOwner)}</strong>. We form a Pty Ltd with all {P.owners} owners as directors, inspect the truck, and buy it at $25,000 to $29,000 (asking price $29,500). We plan on {money(P.startup.find((x) => x.item.includes("Suzuki"))?.amount ?? 0)}.</p>
      <p>In return, each owner gets an equal share of profit, paid each quarter. {money(s.runnerFee)} for each delivery or collection they run. Personal use of the truck when nobody has paid for the date. In the base case the company earns back the capital in about {P.yearsBack} years and still owns the truck.</p>
      <ul className="stats">
        <li><b className="num">{money(P.capital)}</b><span>Capital: {P.owners} owners at {money(P.perOwner)} each</span></li>
        <li><b className="num">{b.hires}</b><span>Hires in the base year, about 3 a month</span></li>
        <li><b className="num">{money(b.revenue)}</b><span>Base-year revenue: hire, travel and forfeited deposits</span></li>
        <li><b className="num">~{P.breakEven}</b><span>Hires a year to cover every cost, depreciation included</span></li>
      </ul>

      <div className="blk out">
        <Sketch cfg={ownership} />
      </div>

      <h2>What the client gets</h2>
      <p>An eight-tap kei truck at their event. The taps are on the rear wall behind the back doors, with a drip tray, a glass rinser and a hand sink. The box is refrigerated. The client supplies their own kegs, 19 to 30 L, because the Carry <Note note="Eight 50 L kegs weigh about 500 kg. The Carry's payload is about 350 kg." ink="gold">carries about 350 kg</Note>. We supply the couplers, the CO2, clean lines, and pint and schooner glassware.</p>
      <ul className="plain">
        <li>We deliver, connect, chill and test the taps, then collect after.</li>
        <li>The client keeps the RSA duty and the venue permission. That is what dry hire means, and it keeps us out of liquor licensing.</li>
        <li>No add-ons and no staff. One price, one truck, one hire a day.</li>
      </ul>
      <div className="blk out">
        <div className="panel">
          <div className="s-price">
            <div><span>4 hours</span><b className="num">{money(s.price4)}</b></div>
            <div><span>8 hours</span><b className="num">{money(s.price8)}</b></div>
          </div>
          <table className="tbl">
            <tbody>
              <tr><td>Deposit, at booking</td><td className="r">{money(s.deposit)}</td></tr>
              <tr><td>Bond, released after inspection</td><td className="r">{money(s.bond)}</td></tr>
              <tr><td>Travel, more than {s.travelThresholdMin} min from the Perth CBD</td><td className="r">+{money(s.travelFee)}</td></tr>
              <tr><td>Balance due</td><td className="r">{s.balanceDaysBefore} days out</td></tr>
              <tr><td>Minimum notice</td><td className="r">{s.minNoticeDays} days</td></tr>
              <tr><td>Book ahead up to</td><td className="r">{s.bookAheadMonths} months</td></tr>
              <tr><td>Taps close by</td><td className="r">{LATEST_FINISH - 12} pm</td></tr>
              <tr><td>Cancel more than {s.cancelDays} days out</td><td className="r">Full refund</td></tr>
              <tr><td>Cancel {s.cancelDays} days or less</td><td className="r">Deposit kept</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="wide duo">
        <figure><img src="/plan/side.jpg" alt="Kerb side of the truck with the wrap applied" width={1000} height={974} loading="lazy" /><figcaption>Kerb side. White cab with the three-ink stripe, landscape poster on the box.</figcaption></figure>
        <figure><img src="/plan/rear.jpg" alt="Rear of the truck with doors open, showing eight taps" width={1000} height={997} loading="lazy" /><figcaption>The rear. Eight taps, drip tray and glass rinser, as listed, with the wrap around the opening.</figcaption></figure>
      </div>

      <h2>Who books it</h2>
      <p>Everyone who throws a party outdoors: weddings, birthdays and engagements, corporate events, run clubs, school fetes, brewery launches, market stalls and sports clubs. Weddings will be the biggest group. Demand peaks from October to March.</p>
      <p>The service area is Perth metro, from Two Rocks to Mandurah and out to the Swan Valley, measured from the Perth CBD.</p>

      <h3>Competition</h3>
      <div className="blk out">
        <div className="panel scrollx">
          <table className="tbl">
            <thead><tr><th>Operator</th><th>Model</th><th className="r">Price</th></tr></thead>
            <tbody>
              <tr><td>Kombi Keg WA, Perth</td><td>6 taps, dry hire, upsells (TV, photo booth)</td><td className="r">Quote only</td></tr>
              <tr><td>Kombi Crew, Adelaide</td><td>Licensed bar, staffed</td><td className="r">~$2,000 / 8 h</td></tr>
              <tr><td><strong>Sunrise Sunset</strong></td><td>8 taps, dry hire, book by text</td><td className="r"><strong>{money(s.price4)} / {money(s.price8)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p>Our edge: a public price, a booking you can finish in one text conversation, and two more taps than the local competitor.</p>

      <h2>Operations without staff</h2>
      <p>The truck lives at Filament Coffee in Osborne Park or at Rhys&apos;s house in North Perth. Owners do the physical work and get paid for it.</p>
      <ul className="plain">
        <li><strong>Runs.</strong> Any owner can claim a delivery or a collection. Each leg pays {money(s.runnerFee)}, added to that owner&apos;s quarterly payout.</li>
        <li><strong>Lines and gas.</strong> Owners supply CO2 and couplers and clean the lines after each hire. Aaron sets the cleaning standard.</li>
        <li><strong>Calendar.</strong> Paid bookings always beat owner use. Personal use is free, but the user pays fuel and any damage.</li>
        <li><strong>Inspection.</strong> The runner checks the truck at collection. A clean return releases the bond.</li>
      </ul>
      <h3>The agent does the desk work</h3>
      <p>Clients text, email, call or use the web form. One AI agent answers all of them from the same knowledge base. There is no web chat.</p>
      <ul className="plain">
        <li>It quotes, checks the calendar, takes the deposit and confirms the booking over SMS.</li>
        <li>It charges the balance {s.balanceDaysBefore} days out. A failed card retries daily for {BALANCE_RETRIES} days, then goes to an owner. If the balance is still unpaid {RELEASE_UNPAID_DAYS} days out, the date is released.</li>
        <li>When an owner takes over a conversation, the agent still answers questions but does not book or cancel.</li>
        <li>It never promises a text it does not send.</li>
      </ul>

      <h2>Ownership and money</h2>
      <ul className="plain">
        <li>Pty Ltd. {P.owners} equal owners, all directors: {P.names.slice(0, -1).join(", ")} and {P.names.at(-1)}.</li>
        <li>Every owner sees everything in the admin: bookings, ledger, payouts.</li>
        <li>A departing owner offers their share to the others pro rata.</li>
        <li>Deposits and balances sit as a liability until the hire is done or forfeited. Only then are they revenue.</li>
        <li>Each quarter the system proposes a payout: profit after a {Math.round(s.taxRate * 100)}% tax provision, less a cash reserve ({s.reserveMonths} months of fixed costs plus {Math.round(s.maintPerKm * 100)}¢ a km for maintenance). {s.approvalsRequired} directors approve it.</li>
        <li>Runner fees are paid in the same batch, to whoever ran.</li>
      </ul>

      <h3>Start-up costs</h3>
      <div className="blk out">
        <div className="panel scrollx">
          <table className="tbl">
            <thead><tr><th>Item</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {P.startup.map((x) => (
                <tr key={x.item}><td>{x.item}{x.item.includes("Suzuki") ? ", planning price" : ""}</td><td className="r">{money(x.amount)}</td></tr>
              ))}
              <tr className="total"><td>Total, against {money(P.capital)} of capital ({money(P.left)} left as opening cash)</td><td className="r">{money(P.spent)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2>Base case: {b.hires} hires, {money(b.profit)} profit in year one</h2>
      <p>Three scenarios from the demo&apos;s simulated first year. They use the same prices and costs. Only demand and bad luck change. The set-up kit sits on the balance sheet with the truck, so it is not in profit. All figures are illustrative and exclude GST.</p>
      <div className="blk out">
        <figure className="panel">
          <svg viewBox="0 0 600 196" role="img" aria-label={`Year-one profit before tax: bear ${signed(sc.bear.profit)} from ${sc.bear.hires} hires, base ${signed(b.profit)} from ${b.hires} hires, bull ${signed(sc.bull.profit)} from ${sc.bull.hires} hires`} style={{ width: "100%", height: "auto", display: "block" }}>
            <line x1={x(0)} y1="4" x2={x(0)} y2="176" stroke="var(--ink)" strokeWidth="1.5" />
            {rows.map((r, i) => {
              const y = 14 + i * 58;
              const neg = r.v.profit < 0;
              return (
                <g key={r.k}>
                  <text x="0" y={y + 16} fontSize="14" fontWeight="600" fill="var(--ink)">{r.k}</text>
                  <text x="0" y={y + 34} fontSize="12.5" fill="var(--ink-2)">{r.v.hires} hires</text>
                  <rect x={Math.min(x(0), x(r.v.profit))} y={y} width={Math.max(2, Math.abs(x(r.v.profit) - x(0)))} height="36" rx="2" fill={neg ? "var(--bad)" : r.k === "Base" ? "var(--ink)" : "var(--azure)"} />
                  <text x={neg ? x(0) + 8 : x(r.v.profit) + 8} y={y + 24} fontSize="15" fontWeight="600" fill="var(--ink)">{signed(r.v.profit)}</text>
                </g>
              );
            })}
          </svg>
          <p className="small">The base year pays {money(b.payoutEach)} to each owner, plus about {money(P.runnerEach)} each in runner fees. The company keeps {money(b.cash)} of cash, of which {money(b.held)} is clients&apos; money for future hires.</p>
        </figure>
      </div>
      <div className="blk out">
        <div className="panel scrollx">
          <table className="tbl">
            <thead><tr><th>Year one</th><th className="r">Bear</th><th className="r">Base</th><th className="r">Bull</th></tr></thead>
            <tbody>
              <tr><td>Hires completed (4 h / 8 h)</td>{rows.map((r) => <td key={r.k} className="r">{r.v.hires} ({r.v.h4}/{r.v.h8})</td>)}</tr>
              <tr><td>Revenue</td>{rows.map((r) => <td key={r.k} className="r">{money(r.v.revenue)}</td>)}</tr>
              <tr><td>Per-hire costs: runners, CO2, fuel, cleaning, breakage, card fees</td>{rows.map((r) => <td key={r.k} className="r">{money(r.v.perHire)}</td>)}</tr>
              <tr><td>Fixed: insurance, rego, software, listing, accountant, ASIC</td>{rows.map((r) => <td key={r.k} className="r">{money(r.v.fixed)}</td>)}</tr>
              <tr><td>Repairs and maintenance</td>{rows.map((r) => <td key={r.k} className="r">{money(r.v.repairs)}</td>)}</tr>
              <tr><td>Truck depreciation (8 years)</td>{rows.map((r) => <td key={r.k} className="r">{money(r.v.depreciation)}</td>)}</tr>
              <tr className="total"><td>Profit before tax</td>{rows.map((r) => <td key={r.k} className={`r${r.v.profit < 0 ? " neg" : ""}`}>{signed(r.v.profit)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2>Risks we check before we buy</h2>
      <ul className="plain">
        <li><strong>The fridge runs off the engine.</strong> The truck idles for the whole event. Check for a 240 V standby plug at inspection, or make one a condition of sale.</li>
        <li><strong>Payload.</strong> About 350 kg. Eight 50 L kegs weigh 500 kg, so we limit hires to 19 to 30 L kegs.</li>
        <li><strong>Structure.</strong> Ask an accountant about personal use (FBT and Division 7A) and confirm that {P.owners} friends do not need a managed investment scheme.</li>
        <li><strong>Insurance.</strong> $20M public liability plus commercial vehicle cover for {P.owners} named drivers, about $1,800 a year.</li>
      </ul>

      <h2>Next steps</h2>
      <ol className="plain">
        <li>All {P.owners} owners say yes to this plan and the {money(P.perOwner)}.</li>
        <li>Pre-purchase inspection, with the fridge power question answered.</li>
        <li>Accountant review of the structure, then register the Pty Ltd.</li>
        <li>Buy the truck, aiming for $25,000 to $27,000.</li>
        <li>Wrap, insurance, Stripe and the SMS number. Then go live.</li>
      </ol>

      <hr />
      <p className="small">{BUSINESS.name} Pty Ltd · Perth, Western Australia · ABN pending · Text {BUSINESS.sms} · {BUSINESS.email}</p>
    </article>
  );
}
