"use client";

import { useState } from "react";
import { DateField } from "@/components/DateField";
import { PaybackChart } from "@/components/PaybackChart";
import { Loading, Section, Stat, useData } from "@/components/ui";
import { GST_THRESHOLD } from "@/lib/config";
import { ACCOUNT_LABEL, balance, cashAt, liveBookings, periodTotals } from "@/lib/domain";
import { useApp } from "@/lib/store";
import type { Account } from "@/lib/types";
import { addDays, addMonths, fmtDate, money, quarterLabel, quarterOf, todayISO } from "@/lib/util";

const EXPENSE_ACCOUNTS: Account[] = ["maintenance", "fuel", "co2", "cleaning", "breakage", "insurance", "rego", "software", "accounting", "marketing", "setup"];
// the ledger shows a page at a time, newest first
const LEDGER_PAGE = 15;
const cum = (xs: number[]) => xs.map((_, i) => xs.slice(0, i + 1).reduce((a, b) => a + b, 0));

export default function Money() {
  const data = useData();
  const addExpense = useApp((s) => s.addExpense);
  const today = todayISO();
  const [period, setPeriod] = useState(quarterOf(today).key);
  const [acct, setAcct] = useState<Account | "all">("all");
  const [rowsShown, setRowsShown] = useState(LEDGER_PAGE);
  const [adding, setAdding] = useState(false);
  const [ex, setEx] = useState({ date: today, account: "maintenance" as Account, amount: "", memo: "" });
  if (!data) return <Loading />;

  // last 12 months, by month
  const months = Array.from({ length: 12 }, (_, i) => addMonths(today.slice(0, 7) + "-01", i - 11));
  const series = months.map((m) => {
    const t = periodTotals(data, m, addDays(addMonths(m, 1), -1));
    return { m, ...t };
  });
  const hires = data.bookings.filter((b) => b.kind === "paid" && b.state === "completed" && b.date >= months[0] && b.date <= today).length;
  // same window as the chart (1st of the month, 11 months back, to today) so the numbers agree
  const year = periodTotals(data, months[0], today);
  const cash = cashAt(data);
  const capital = balance(data, "capital");
  const margin = Math.round((year.profit / Math.max(1, year.revenue)) * 100);
  const payback = year.profit > 0 ? capital / year.profit : Infinity;
  // The ATO tests projected turnover too: this month plus the next 11, which includes hires already booked.
  const monthStart = today.slice(0, 7) + "-01";
  const horizon = addDays(addMonths(monthStart, 12), -1);
  const projected =
    periodTotals(data, monthStart, today).revenue +
    liveBookings(data).filter((b) => b.kind === "paid" && b.state !== "held" && b.state !== "completed" && b.date <= horizon).reduce((s, b) => s + b.total, 0);

  const gstHot = Math.max(year.revenue, projected) > GST_THRESHOLD * 0.8;
  const pct = (n: number) => Math.min(100, (n / GST_THRESHOLD) * 100);

  const quarters = Array.from(new Set(data.ledger.map((e) => quarterOf(e.date).key))).sort().reverse();
  const q = quarterOf(period.replace(/-Q(\d)/, (_, n) => `-${String((Number(n) - 1) * 3 + 1).padStart(2, "0")}-01`));
  const inQ = data.ledger.filter((e) => e.date >= q.start && e.date <= q.end);
  const byAcct = new Map<Account, number>();
  for (const e of inQ) byAcct.set(e.account, (byAcct.get(e.account) ?? 0) + e.amount);
  const rows = [...byAcct.entries()].sort((a, b) => b[1] - a[1]);
  const net = inQ.reduce((s, e) => s + e.amount, 0);
  const ledger = [...data.ledger].filter((e) => acct === "all" || e.account === acct).sort((a, b) => b.date.localeCompare(a.date));
  const more = Math.min(LEDGER_PAGE * 3, ledger.length - rowsShown);

  return (
    <div className="page">
      <div className="admin-top"><div><h1>Money</h1></div></div>

      <div className="stats">
        <Stat k="Cash in the bank" v={money(cash)} />
        <Stat k="Revenue, last 12 months" v={money(year.revenue)} />
        <Stat k="Operating costs, last 12 months" v={money(year.expenses)} />
        <Stat k="Profit, last 12 months" v={money(year.profit)} />
      </div>

      <Section title="Payback">
        <div className="chart-card">
          <div className="ch-head">
            <div className="ch-title">
              <span className="v">{money(year.profit)} <span className="meta">of {money(capital)}</span></span>
              <span className="finding">{Number.isFinite(payback) ? `Owners' capital back in ${payback.toFixed(1)} years at this pace.` : "At this pace the owners don't get their capital back."}</span>
            </div>
          </div>
          <PaybackChart months={series.map((x) => x.m)} profit={cum(series.map((x) => x.profit))} capital={capital} />
          <div className="ch-foot">
            <div><span className="k">Hires</span><span className="v">{hires}</span></div>
            <div><span className="k">Margin</span><span className="v">{margin}%</span></div>
            <div><span className="k">Average a hire</span><span className="v">{money(year.revenue / Math.max(1, hires))}</span></div>
          </div>
          <p className="ch-note note">Operating profit after depreciation, cumulative by month, against capital paid in. Revenue counts when the hire happens.</p>
        </div>
      </Section>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <Section
          title="Profit and loss"
          aside={
            <select className="input" aria-label="Quarter" style={{ width: "auto" }} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {quarters.map((k) => <option key={k} value={k}>{quarterLabel(k)}</option>)}
            </select>
          }
        >
          <div className="card">
            {rows.map(([k, v]) => (
              <div key={k} className="summary-row"><span>{ACCOUNT_LABEL[k]}</span><span>{money(v)}</span></div>
            ))}
            <div className="summary-row total"><strong>Net cash movement</strong><strong>{money(net)}</strong></div>
          </div>
        </Section>

        <Section title="GST registration watch">
          <div className="card meter">
            <div className={`track${gstHot ? " hot" : ""}`} role="img" aria-label={`${money(year.revenue)} of ${money(GST_THRESHOLD)}, ${money(projected)} projected`}>
              <span className="proj" style={{ width: `${pct(projected)}%` }} />
              <span className="act" style={{ width: `${pct(year.revenue)}%` }} />
            </div>
            <div className="ends meta"><span>$0</span><span>{money(GST_THRESHOLD)} threshold</span></div>
            <div className="legend2">
              <div><span className="k"><i style={{ background: gstHot ? "var(--sunset)" : "var(--azure)" }} />Last 12 months</span><span className="v">{money(year.revenue)}</span></div>
              <div><span className="k"><i style={{ background: gstHot ? "color-mix(in srgb, var(--sunset) 30%, white)" : "color-mix(in srgb, var(--azure) 28%, white)" }} />Projected, next 12</span><span className="v">{money(projected)}</span></div>
            </div>
            <span className="note">Projected counts this month and the next 11, including hires already booked. Register within 21 days of either crossing the threshold; prices then include GST.</span>
          </div>
        </Section>
      </div>

      <Section
        title="Ledger"
        aside={
          <div className="row">
            <select className="input" aria-label="Ledger account" style={{ width: "auto" }} value={acct} onChange={(e) => { setAcct(e.target.value as Account | "all"); setRowsShown(LEDGER_PAGE); }}>
              <option value="all">All accounts</option>
              {(Object.keys(ACCOUNT_LABEL) as Account[]).map((k) => <option key={k} value={k}>{ACCOUNT_LABEL[k]}</option>)}
            </select>
            {!adding && <button className="btn small" onClick={() => setAdding(true)}>+ Add expense</button>}
          </div>
        }
      >
        {adding && (
          <form className="card stack drawer" onSubmit={(e) => { e.preventDefault(); if (!(Number(ex.amount) > 0)) return; addExpense(ex.date, ex.account, Number(ex.amount), ex.memo || ACCOUNT_LABEL[ex.account]); setEx({ ...ex, amount: "", memo: "" }); setAdding(false); }}>
            <div className="grid cols-4">
              <div className="field"><label htmlFor="ex-1">Date</label><DateField id="ex-1" value={ex.date} onChange={(d) => setEx({ ...ex, date: d })} /></div>
              <div className="field"><label htmlFor="ex-2">Category</label>
                <select id="ex-2" className="input" value={ex.account} onChange={(e) => setEx({ ...ex, account: e.target.value as Account })}>
                  {EXPENSE_ACCOUNTS.map((x) => <option key={x} value={x}>{ACCOUNT_LABEL[x]}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="ex-3">Amount</label><span className="adorn"><i>$</i><input id="ex-3" className="input" inputMode="decimal" value={ex.amount} onChange={(e) => setEx({ ...ex, amount: e.target.value })} /></span></div>
              <div className="field"><label htmlFor="ex-4">Note</label><input id="ex-4" className="input" value={ex.memo} onChange={(e) => setEx({ ...ex, memo: e.target.value })} /></div>
            </div>
            <div className="row">
              <button className="btn small primary">Add expense</button>
              <button type="button" className="btn small" onClick={() => setAdding(false)}>Cancel</button>
              <span className="note">In production, expenses come from the bank feed with receipts attached.</span>
            </div>
          </form>
        )}
        <div className="table-wrap">
          <table className="t cards">
            <thead><tr><th>Date</th><th>Account</th><th>Memo</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {ledger.slice(0, rowsShown).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDate(e.date, { year: true })}</td>
                  <td data-label="Account">{ACCOUNT_LABEL[e.account]}</td>
                  <td className="muted" data-label="Memo">{e.memo}</td>
                  <td className={`num ${e.amount > 0 ? "pos" : ""}`} data-label="Amount">{money(e.amount, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {more > 0 && (
            <div className="table-foot">
              <span className="meta">{rowsShown} of {ledger.length} entries</span>
              <button className="btn small" onClick={() => setRowsShown(rowsShown + more)}>Show {more} more</button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
