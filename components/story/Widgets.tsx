"use client";

// The explainer's small interactives. Each one takes data the server computed from lib/ at build time,
// or calls the same pure functions the site uses (quote), so the page can't drift from the PoC.
import { useState } from "react";
import { LATEST_FINISH, startTimesFor } from "@/lib/config";
import { quote } from "@/lib/domain";
import type { Settings } from "@/lib/types";
import { fmtDate, money } from "@/lib/util";
import type { Day, Line } from "@/app/(story)/how-it-works/data";

// ---------- pill switch ----------

export function Pills<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="pills" role="group" aria-label={label}>
      <div className="track">
        {options.map((o) => (
          <button key={String(o.v)} type="button" aria-pressed={o.v === value} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- quote ----------

export function QuoteCalc({ s, suburbs }: { s: Settings; suburbs: { name: string; minutes: number }[] }) {
  const [block, setBlock] = useState<4 | 8>(8);
  const [suburb, setSuburb] = useState("Fremantle");
  const q = quote(s, block, suburb);
  const sorted = [...suburbs].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="panel quote">
      <div className="quote-in">
        <Pills label="Hire length" value={block} onChange={setBlock} options={[{ v: 4, label: "4 hours" }, { v: 8, label: "8 hours" }]} />
        <label className="s-field">
          <span>Suburb</span>
          <select value={suburb} onChange={(e) => setSuburb(e.target.value)}>
            {sorted.map((x) => (
              <option key={x.name} value={x.name}>{x.name}, {x.minutes} min</option>
            ))}
          </select>
        </label>
        <p className="small">Start times for {block} hours: {startTimesFor(block).map((t) => t.replace(/^0/, "")).join(", ")}. Taps close by {LATEST_FINISH - 12} pm.</p>
      </div>
      <dl className="quote-out num">
        <div><dt>Hire</dt><dd>{money(q.price)}</dd></div>
        <div><dt>Travel, {q.minutes} min from the CBD</dt><dd>{q.travelFee ? money(q.travelFee) : "$0"}</dd></div>
        <div className="sum"><dt>Total</dt><dd>{money(q.total)}</dd></div>
        <div><dt>Deposit, at booking</dt><dd>{money(q.deposit)}</dd></div>
        <div><dt>Balance, {s.balanceDaysBefore} days before</dt><dd>{money(q.total - q.deposit)}</dd></div>
        <div><dt>Bond hold, {s.bondHoldDaysBefore} days before</dt><dd>{money(q.bond)}</dd></div>
      </dl>
    </div>
  );
}

// ---------- one booking, day by day ----------

const STATE: Record<string, string> = {
  held: "Held, unpaid",
  confirmed: "Confirmed",
  balance_paid: "Paid in full",
  completed: "Done",
  cancelled: "Released",
};

export function BookingLife({ life }: { life: { ok: { ref: string; date: string; days: Day[] }; declines: { ref: string; date: string; days: Day[] } } }) {
  const [which, setWhich] = useState<"ok" | "declines">("ok");
  const L = life[which];
  // stops: the days something happened, so the slider can jump between them
  const stops = L.days.map((d, i) => (d.events.length ? i : -1)).filter((i) => i >= 0);
  const [i, setI] = useState(0);
  const at = Math.min(i, L.days.length - 1);
  const d = L.days[at];
  const max = L.days.length - 1;
  const when = d.out > 0 ? `${d.out} days before the hire` : d.out === 0 ? "Hire day" : "The day after";

  return (
    <div className="panel life">
      <Pills label="The card on file" value={which} onChange={(v) => { setWhich(v); setI(0); }} options={[{ v: "ok", label: "Card works" }, { v: "declines", label: "Card declines" }]} />
      <div className="life-head">
        <b>{fmtDate(d.date, { dow: true })}</b>
        <span>{when}</span>
        <span className={`s-pill s-${d.state}`}>{STATE[d.state] ?? d.state}</span>
        {d.bond === "held" && <span className="s-pill s-bond">Bond held</span>}
      </div>
      <div className="life-track">
        <input
          type="range"
          min={0}
          max={max}
          value={at}
          aria-label="Day"
          aria-valuetext={`${fmtDate(d.date, { dow: true })}, ${when}`}
          onChange={(e) => setI(Number(e.target.value))}
        />
        <div className="life-ticks" aria-hidden="true">
          {stops.map((s) => (
            <button key={s} type="button" tabIndex={-1} style={{ left: `${(s / max) * 100}%` }} className={s === at ? "on" : ""} onClick={() => setI(s)} />
          ))}
        </div>
      </div>
      <div className="life-jump">
        {stops.map((s) => (
          <button key={s} type="button" className={s === at ? "on" : ""} onClick={() => setI(s)}>
            {L.days[s].out > 0 ? `${L.days[s].out} days out` : L.days[s].out === 0 ? "Hire day" : "After"}
          </button>
        ))}
      </div>
      <ul className="stats three">
        <li><b className="num">{money(d.paid)}</b><span>Sam has paid</span></li>
        <li><b className="num">{money(d.held)}</b><span>Held for Sam, a liability</span></li>
        <li><b className="num">{money(d.earned)}</b><span>Revenue, ours to keep</span></li>
      </ul>
      <p className="life-what">{d.events.length ? d.events.join(". ") + "." : "Nothing runs for this booking today."}</p>
      <details className="long">
        <summary>Ledger lines for {L.ref} so far ({L.days[at].ledger.filter((e) => e.date <= d.date).length})</summary>
        <div className="scrollx">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Account</th><th>Memo</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {L.days[max].ledger.filter((e) => e.date <= d.date).map((e, k) => (
                <tr key={k}><td className="nw">{fmtDate(e.date)}</td><td>{e.account}</td><td>{e.memo}</td><td className="r num">{money(e.amount, e.amount % 1 !== 0)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------- quarterly payout ----------

interface Payout {
  quarter: string;
  status: string;
  profit: number;
  tax: number;
  cash: number;
  reserve: number;
  deposits: number;
  owedRunners: number;
  each: number;
  owners: number;
  distributable: number;
  runnerFees: number;
  approvals: number;
}

export function PayoutCalc({ payouts, approvalsRequired }: { payouts: Payout[]; approvalsRequired: number }) {
  const [i, setI] = useState(payouts.length > 1 ? 1 : 0);
  const p = payouts[i];
  const afterTax = Math.max(0, p.profit - p.tax);
  const room = Math.max(0, p.cash - p.reserve - p.tax - p.deposits - p.owedRunners);
  const raw = Math.min(afterTax, room);
  const scale = Math.max(p.cash, p.profit, 1);
  const bar = (v: number) => `${Math.max(0, (v / scale) * 100)}%`;
  const short = (q: string) => q.split(" (")[0];
  return (
    <div className="panel payout">
      <Pills label="Quarter" value={i} onChange={setI} options={payouts.map((x, k) => ({ v: k, label: short(x.quarter) }))} />
      <div className="wf">
        <h4>Profit test</h4>
        <Row label="Profit for the quarter" v={p.profit} w={bar(p.profit)} />
        <Row label="Less tax provision" v={-p.tax} w={bar(p.tax)} out />
        <Row label="After tax" v={afterTax} w={bar(afterTax)} sum />
        <h4>Cash test</h4>
        <Row label="Cash in the bank at quarter end" v={p.cash} w={bar(p.cash)} />
        <Row label="Less customer money for future hires" v={-p.deposits} w={bar(p.deposits)} out />
        <Row label="Less runner fees owed" v={-p.owedRunners} w={bar(p.owedRunners)} out />
        <Row label="Less reserve" v={-p.reserve} w={bar(p.reserve)} out />
        <Row label="Less tax provision" v={-p.tax} w={bar(p.tax)} out />
        <Row label="Room to pay" v={room} w={bar(room)} sum />
      </div>
      <p className="wf-result">
        The payout is the smaller test: <b className="num">{money(raw)}</b>. Split {p.owners} ways and rounded down to $10, that is <b className="num">{money(p.each)}</b> each ({money(p.distributable)} in all), plus <b className="num">{money(p.runnerFees)}</b> of runner fees to whoever ran.{" "}
        {p.status === "paid" ? `${approvalsRequired} directors approved it and it was paid.` : `It waits for ${approvalsRequired} director approvals (${p.approvals} so far).`}
      </p>
    </div>
  );
}

function Row({ label, v, w, out, sum }: { label: string; v: number; w: string; out?: boolean; sum?: boolean }) {
  return (
    <div className={`wf-row${out ? " out" : ""}${sum ? " sum" : ""}`}>
      <span className="wf-l">{label}</span>
      <span className="wf-bar"><i style={{ width: w }} /></span>
      <span className="wf-v num">{v < 0 ? `−${money(-v)}` : money(v)}</span>
    </div>
  );
}

// ---------- text threads ----------

export function Thread({ lines, who = "Customer" }: { lines: Line[]; who?: string }) {
  return (
    <div className="thread">
      {lines.map((l, k) => (
        <div key={k} className={`s-bubble ${l.from}`}>
          <span className="who">{l.from === "them" ? who : "Agent"}</span>
          <span className="body">{l.body}</span>
          {l.did && <span className="did">{l.did}</span>}
        </div>
      ))}
    </div>
  );
}

export function OwnerTiers({ tiers }: { tiers: { label: string; say: string; lines: Line[] }[] }) {
  const [i, setI] = useState(0);
  return (
    <div className="panel tiers">
      <Pills label="Kind of text" value={i} onChange={setI} options={tiers.map((t, k) => ({ v: k, label: t.label }))} />
      <p className="tiers-say">{tiers[i].say}</p>
      <Thread lines={tiers[i].lines} who="Colin" />
    </div>
  );
}

