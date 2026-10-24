"use client";

import { Loading, Section, useData } from "@/components/ui";
import { directorApprovals, freeCash, payoutRefusal, payoutTotal } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { fmtDate, money, quarterLabel, todayISO } from "@/lib/util";

export default function Payouts() {
  const data = useData();
  const ownerId = useApp((s) => s.ownerId);
  const approve = useApp((s) => s.approveDistribution);
  const payOut = useApp((s) => s.payDistribution);
  if (!data) return <Loading />;
  const s = data.settings;
  const owner = (id: string) => data.owners.find((o) => o.id === id);
  const dists = [...data.distributions].sort((a, b) => b.quarter.localeCompare(a.quarter));
  const free = freeCash(data, todayISO());
  const team = { owners: data.owners, settings: s };
  // Runner fees can carry cents; show them when they do.
  const cash = (n: number) => money(n, n % 1 !== 0);

  // one quarter's numbers, owner split and (while awaiting) the approval controls
  function detail(d: (typeof dists)[number]) {
    const mine = ownerId ? d.approvals.includes(ownerId) : false;
    const approvals = directorApprovals(team, d);
    const ready = approvals.length >= s.approvalsRequired;
    const total = payoutTotal(d);
    const director = !!ownerId && !!owner(ownerId)?.isDirector;
    // Once approved, the same check payDistribution makes as it pays: is there still the free cash for it?
    const refused = ready && d.status === "awaiting" ? payoutRefusal(d, team, free) : undefined;
    return (
      <div className="card stack" style={{ gap: 16 }}>
        <div className="grid cols-2">
          <div>
            <div className="summary-row"><span>Revenue</span><span>{money(d.revenue)}</span></div>
            <div className="summary-row"><span>Operating costs</span><span>−{money(d.expenses)}</span></div>
            <div className="summary-row total"><strong>Profit</strong><strong>{money(d.profit)}</strong></div>
            <div className="summary-row"><span>Tax provision</span><span>−{money(d.taxProvision)}</span></div>
            <div className="summary-row"><span>Cash at quarter end</span><span>{money(d.cash)}</span></div>
            <div className="summary-row"><span>Reserve kept</span><span>{money(d.reserve)}</span></div>
            <div className="summary-row"><span>Customer money held for hires ahead</span><span>{money(d.deposits ?? 0)}</span></div>
            <div className="summary-row"><span>Runner fees owed</span><span>{money(d.owedRunners ?? 0)}</span></div>
            <div className="summary-row total"><strong>To distribute</strong><strong>{money(d.distributable)}</strong></div>
          </div>
          <div className="table-wrap">
            <table className="t cards wide tight">
              <thead><tr><th>Owner</th><th className="num">Shares</th><th className="num">Dividend</th><th className="num">Runner fees</th><th>Transfer</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.ownerId}>
                    <td>{owner(l.ownerId)?.name}{d.status === "awaiting" && <><br /><span className="meta nowrap">{owner(l.ownerId)?.payoutAccount}</span></>}</td>
                    <td className="num" data-label="Shares">{l.shares}</td>
                    <td className="num" data-label="Dividend">{money(l.amount)}</td>
                    <td className="num" data-label="Runner fees">{cash(l.runnerFees)}</td>
                    <td className="meta nowrap" data-label="Transfer" title={l.payoutId}>{l.payoutId && d.paidAt ? `Sent ${fmtDate(d.paidAt.slice(0, 10))}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {d.status === "awaiting" && (
          <div className="row">
            <span className="note">
              Approved by {approvals.length ? approvals.map((a) => owner(a)?.name).join(", ") : "nobody yet"}.
            </span>
            {!mine && director && <button className="btn small" onClick={() => approve(d.id)}>Approve</button>}
            {director && (
              <button className="btn small primary" disabled={!ready || !!refused || total <= 0} onClick={() => payOut(d.id)}>
                Pay {cash(total)}
              </button>
            )}
            {mine && !ready && <span className="note">Switch owner (top bar) to add a second approval.</span>}
            {refused && <span className="note">{refused}</span>}
          </div>
        )}
      </div>
    );
  }
  const open = dists.filter((d) => d.status !== "paid");
  const paid = dists.filter((d) => d.status === "paid");

  return (
    <div className="page">
      <div className="admin-top">
        <h1>Payouts</h1>
      </div>
      <details className="notice">
        <summary>Each quarter, profit after tax and reserves is split by shareholding once {s.approvalsRequired} directors approve.</summary>
        <p>
          The system sets aside {Math.round(s.taxRate * 100)}% for company tax, keeps a reserve ({s.reserveMonths} months of fixed costs,
          {" "}{money(s.maintPerKm, true)}/km driven for maintenance, plus $500), keeps back customers&apos; money for hires that haven&apos;t
          happened yet, and splits the rest by shareholding, rounded down to $10. Runner fees owed go out in the same transfer. Bank
          transfers are simulated here; in production they go out through the bank&apos;s payments API.
        </p>
      </details>

      {open.map((d) => (
        <Section
          key={d.id}
          title={`${quarterLabel(d.quarter)} · ${fmtDate(d.start)} to ${fmtDate(d.end, { year: true })}`}
          aside={<span className="pill warn">{directorApprovals(team, d).length} of {s.approvalsRequired} approvals</span>}
        >
          {detail(d)}
        </Section>
      ))}
      {paid.length > 0 && (
        <Section title="Paid">
          <div className="list">
            {paid.map((d) => (
              <details key={d.id} className="fold">
                <summary className="list-row">
                  <span className="list-main"><strong>{quarterLabel(d.quarter)}</strong><span>{fmtDate(d.start)} to {fmtDate(d.end, { year: true })}</span></span>
                  <span className="num">{money(d.distributable)}</span>
                  <span className="meta nowrap">Paid {d.paidAt ? fmtDate(d.paidAt.slice(0, 10)) : ""}</span>
                </summary>
                <div className="fold-body">{detail(d)}</div>
              </details>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
