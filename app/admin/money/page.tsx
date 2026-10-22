"use client";

import { useEffect, useState } from "react";
import { StepChart } from "@/components/StepChart";
import { Loading, Stat, useData } from "@/components/ui";
import { ACCOUNT_LABEL, balance, cashAt, liveBookings, periodTotals, reserveTarget } from "@/lib/domain";
import { SCENARIOS } from "@/lib/seed";
import { useApp } from "@/lib/store";
import type { Account } from "@/lib/types";
import { addDays, addMonths, fmtDate, money, quarterLabel, quarterOf, todayISO } from "@/lib/util";

const EXPENSE_ACCOUNTS: Account[] = ["maintenance", "fuel", "co2", "cleaning", "breakage", "insurance", "rego", "software", "accounting", "marketing", "setup"];
const GST_THRESHOLD = 75000;
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cum = (xs: number[]) => xs.map((_, i) => xs.slice(0, i + 1).reduce((a, b) => a + b, 0));

export default function Money() {
  const data = useData();
  const addExpense = useApp((s) => s.addExpense);
  const today = todayISO();
  const [period, setPeriod] = useState(quarterOf(today).key);
  const [acct, setAcct] = useState<Account | "all">("all");
  const [ex, setEx] = useState({ date: today, account: "maintenance" as Account, amount: "", memo: "" });
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  if (!data) return <Loading />;

  // last 12 months, by month
  const months = Array.from({ length: 12 }, (_, i) => addMonths(today.slice(0, 7) + "-01", i - 11));
  const series = months.map((m) => {
    const t = periodTotals(data, m, addDays(addMonths(m, 1), -1));
    return { m, ...t };
  });
  const best = series.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const hires = data.bookings.filter((b) => b.kind === "paid" && b.state === "completed" && b.date >= months[0] && b.date <= today).length;
  // same window as the chart (1st of the month, 11 months back, to today) so the numbers agree
  const year = periodTotals(data, months[0], today);
  const cash = cashAt(data);
  const reserve = reserveTarget(data, today);
  const held = balance(data, "deposits");
  const owed = balance(data, "owed_runners");
  const capital = balance(data, "capital");
  const margin = Math.round((year.profit / Math.max(1, year.revenue)) * 100);
  const payback = year.profit > 0 ? capital / year.profit : Infinity;
  const scenario = SCENARIOS[data.scenario].label.toLowerCase();
  // The ATO tests projected turnover too: this month plus the next 11, which includes hires already booked.
  const monthStart = today.slice(0, 7) + "-01";
  const horizon = addDays(addMonths(monthStart, 12), -1);
  const projected =
    periodTotals(data, monthStart, today).revenue +
    liveBookings(data).filter((b) => b.kind === "paid" && b.state !== "held" && b.state !== "completed" && b.date <= horizon).reduce((s, b) => s + b.total, 0);

  const quarters = Array.from(new Set(data.ledger.map((e) => quarterOf(e.date).key))).sort().reverse();
  const q = quarterOf(period.replace(/-Q(\d)/, (_, n) => `-${String((Number(n) - 1) * 3 + 1).padStart(2, "0")}-01`));
  const inQ = data.ledger.filter((e) => e.date >= q.start && e.date <= q.end);
  const byAcct = new Map<Account, number>();
  for (const e of inQ) byAcct.set(e.account, (byAcct.get(e.account) ?? 0) + e.amount);
  const rows = [...byAcct.entries()].sort((a, b) => b[1] - a[1]);
  const ledger = [...data.ledger].filter((e) => acct === "all" || e.account === acct).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="admin-top"><h1>Money</h1><span className="pill">Illustrative · {scenario} case</span></div>

      <div className="grid cols-4">
        <Stat k="Cash in the bank" v={money(cash)} sub={`${money(held)} is customers' money for hires ahead`} />
        <Stat k="Revenue, last 12 months" v={money(year.revenue)} />
        <Stat k="Operating costs, last 12 months" v={money(year.expenses)} />
        <Stat k="Profit, last 12 months" v={money(year.profit)} sub={`${margin}% margin`} />
      </div>

      <div className="chart-panel">
        <div className="scroll">
          <StepChart
            compact={compact}
            eyebrow="Payback · cumulative"
            title={Number.isFinite(payback) ? `Owners' ${money(capital)} back in ${payback.toFixed(1)} years at this pace` : "At this pace the owners don't get their capital back"}
            sub="Operating profit after depreciation, AUD, cumulative by month, against capital paid in. Revenue counts when the hire happens."
            periods={series.map((x) => MON3[Number(x.m.slice(5, 7)) - 1])}
            fmt={(n) => money(n)}
            series={[
              { name: "Capital in", values: series.map(() => capital), color: "azure", note: "five owners" },
              { name: "Profit", values: cum(series.map((x) => x.profit)), color: "ink", note: `best month ${MON3[Number(best.m.slice(5, 7)) - 1]}` },
            ]}
            strip={{
              label: "Profit, last 12 months",
              lines: [`${hires} hires`, `${margin}% margin · avg ${money(year.revenue / Math.max(1, hires))} a hire`, `Illustrative ${scenario} case · source: ledger`],
              hero: money(year.profit),
            }}
          />
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <div className="row between">
            <strong>Profit and loss</strong>
            <select className="input" aria-label="Quarter" style={{ width: "auto" }} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {quarters.map((k) => <option key={k} value={k}>{quarterLabel(k)}</option>)}
            </select>
          </div>
          <div>
            {rows.map(([k, v]) => (
              <div key={k} className="summary-row"><span>{ACCOUNT_LABEL[k]}</span><span className={v > 0 ? "pos" : ""}>{money(v)}</span></div>
            ))}
            <div className="summary-row"><strong>Net cash movement</strong><strong>{money(inQ.reduce((s, e) => s + e.amount, 0))}</strong></div>
          </div>
        </div>

        <div className="stack">
          <div className="card stack" style={{ gap: 10 }}>
            <strong>GST registration watch</strong>
            <div className="gauge"><div style={{ width: `${Math.min(100, (Math.max(year.revenue, projected) / GST_THRESHOLD) * 100)}%`, background: Math.max(year.revenue, projected) > GST_THRESHOLD * 0.8 ? "var(--sunset)" : "var(--ink)" }} /></div>
            <span className="muted" style={{ fontSize: 14 }}>
              {money(year.revenue)} of {money(GST_THRESHOLD)} turnover in the last 12 months, and {money(projected)} projected
              for this month and the next 11 (including hires already booked). Register within 21 days of either crossing it,
              and prices then include GST.
            </span>
          </div>
          <form className="card stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (!(Number(ex.amount) > 0)) return; addExpense(ex.date, ex.account, Number(ex.amount), ex.memo || ACCOUNT_LABEL[ex.account]); setEx({ ...ex, amount: "", memo: "" }); }}>
            <strong>Add an expense</strong>
            <div className="grid cols-2">
              <div className="field"><label htmlFor="ex-1">Date</label><input id="ex-1" type="date" className="input" value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="ex-2">Category</label>
                <select id="ex-2" className="input" value={ex.account} onChange={(e) => setEx({ ...ex, account: e.target.value as Account })}>
                  {EXPENSE_ACCOUNTS.map((x) => <option key={x} value={x}>{ACCOUNT_LABEL[x]}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="ex-3">Amount</label><input id="ex-3" className="input" inputMode="decimal" value={ex.amount} onChange={(e) => setEx({ ...ex, amount: e.target.value })} /></div>
              <div className="field"><label htmlFor="ex-4">Note</label><input id="ex-4" className="input" value={ex.memo} onChange={(e) => setEx({ ...ex, memo: e.target.value })} /></div>
            </div>
            <button className="btn small primary" style={{ alignSelf: "flex-start" }}>Add expense</button>
            <span className="muted" style={{ fontSize: 13 }}>In production, expenses come from the bank feed and receipts are attached.</span>
          </form>
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="row between">
          <span className="eyebrow muted">Ledger</span>
          <select className="input" aria-label="Ledger account" style={{ width: "auto" }} value={acct} onChange={(e) => setAcct(e.target.value as Account | "all")}>
            <option value="all">All accounts</option>
            {(Object.keys(ACCOUNT_LABEL) as Account[]).map((k) => <option key={k} value={k}>{ACCOUNT_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Date</th><th>Account</th><th>Memo</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.date, { year: true })}</td>
                  <td>{ACCOUNT_LABEL[e.account]}</td>
                  <td className="muted">{e.memo}</td>
                  <td className={`num ${e.amount > 0 ? "pos" : ""}`}>{money(e.amount, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
