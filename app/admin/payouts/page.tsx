"use client";

import { Loading, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import { fmtDate, fmtDateTime, money, quarterLabel } from "@/lib/util";

export default function Payouts() {
  const data = useData();
  const ownerId = useApp((s) => s.ownerId);
  const approve = useApp((s) => s.approveDistribution);
  const payOut = useApp((s) => s.payDistribution);
  if (!data) return <Loading />;
  const s = data.settings;
  const owner = (id: string) => data.owners.find((o) => o.id === id);
  const dists = [...data.distributions].sort((a, b) => b.quarter.localeCompare(a.quarter));

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="admin-top">
        <h1>Payouts</h1>
      </div>
      <div className="notice info">
        Each quarter the system works out profit, sets aside {Math.round(s.taxRate * 100)}% for company tax, keeps a reserve
        ({s.reserveMonths} months of fixed costs, {money(s.maintPerKm, true)}/km driven for maintenance, plus $500), keeps back customers&apos;
        money for hires that haven&apos;t happened yet, and splits the rest by shareholding, rounded down to $10. Runner fees owed go out in
        the same transfer. It pays only after {s.approvalsRequired} directors approve. Bank transfers are simulated here; in
        production they go out through the bank&apos;s payments API.
      </div>

      {dists.map((d) => {
        const mine = ownerId ? d.approvals.includes(ownerId) : false;
        const ready = d.approvals.length >= s.approvalsRequired;
        const total = d.lines.reduce((sum, l) => sum + l.amount + (l.runnerFees ?? 0), 0);
        const director = !!ownerId && !!owner(ownerId)?.isDirector;
        return (
          <div key={d.id} className="card stack" style={{ gap: 16 }}>
            <div className="row between">
              <div>
                <strong style={{ fontSize: 20 }}>{quarterLabel(d.quarter)}</strong>
                <div className="muted" style={{ fontSize: 14 }}>{fmtDate(d.start, { year: true })} to {fmtDate(d.end, { year: true })}</div>
              </div>
              {d.status === "paid" ? <span className="pill good">Paid {d.paidAt ? fmtDateTime(d.paidAt) : ""}</span> : <span className="pill warn">{d.approvals.length} of {s.approvalsRequired} approvals</span>}
            </div>
            <div className="grid cols-2">
              <div>
                <div className="summary-row"><span>Revenue</span><span>{money(d.revenue)}</span></div>
                <div className="summary-row"><span>Operating costs</span><span>−{money(d.expenses)}</span></div>
                <div className="summary-row"><strong>Profit</strong><strong>{money(d.profit)}</strong></div>
                <div className="summary-row"><span>Tax provision</span><span>−{money(d.taxProvision)}</span></div>
                <div className="summary-row"><span>Cash at quarter end</span><span>{money(d.cash)}</span></div>
                <div className="summary-row"><span>Reserve kept</span><span>{money(d.reserve)}</span></div>
                <div className="summary-row"><span>Customer money held for hires ahead</span><span>{money(d.deposits ?? 0)}</span></div>
                <div className="summary-row"><span>Runner fees owed</span><span>{money(d.owedRunners ?? 0)}</span></div>
                <div className="summary-row"><strong>To distribute</strong><strong>{money(d.distributable)}</strong></div>
              </div>
              <div className="table-wrap" style={{ background: "var(--paper)" }}>
                <table className="t cards wide tight">
                  <thead><tr><th>Owner</th><th className="num">Shares</th><th className="num">Dividend</th><th className="num">Runner fees</th><th>Transfer</th></tr></thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.ownerId}>
                        <td>{owner(l.ownerId)?.name}<br /><span className="mono muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{owner(l.ownerId)?.payoutAccount}</span></td>
                        <td className="num" data-label="Shares">{l.shares}</td>
                        <td className="num" data-label="Dividend">{money(l.amount)}</td>
                        <td className="num" data-label="Runner fees">{money(l.runnerFees ?? 0)}</td>
                        <td className="mono muted" style={{ fontSize: 11, overflowWrap: "anywhere" }} data-label="Transfer">{l.payoutId ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {d.status === "awaiting" && (
              <div className="row">
                <span className="muted" style={{ fontSize: 14 }}>
                  Approved by {d.approvals.length ? d.approvals.map((a) => owner(a)?.name).join(", ") : "nobody yet"}.
                </span>
                {!mine && director && <button className="btn small" onClick={() => approve(d.id)}>Approve</button>}
                <button className="btn small primary" disabled={!ready || total <= 0} onClick={() => payOut(d.id)}>
                  Pay {money(total)}
                </button>
                {mine && !ready && <span className="muted" style={{ fontSize: 13 }}>Switch owner (top bar) to add a second approval.</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
