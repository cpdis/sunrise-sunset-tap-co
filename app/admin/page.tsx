"use client";

import Link from "next/link";
import { CHANNEL_LABEL, Loading, Stat, StatePill, useData } from "@/components/ui";
import { cashAt, liveBookings, periodTotals, reserveTarget } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { addDays, daysBetween, fmtDate, fmtDateTime, fmtTime, money, quarterLabel, todayISO } from "@/lib/util";

export default function Today() {
  const data = useData();
  const ownerId = useApp((s) => s.ownerId);
  const claimRun = useApp((s) => s.claimRun);
  if (!data) return <Loading />;
  const today = todayISO();
  const me = data.owners.find((o) => o.id === ownerId);
  const name = (id?: string) => data.owners.find((o) => o.id === id)?.name;
  const upcoming = liveBookings(data).filter((b) => b.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const next30 = upcoming.filter((b) => b.kind === "paid" && daysBetween(today, b.date) <= 30);
  const unclaimed = next30.filter((b) => b.state !== "held" && (!b.deliver.ownerId || !b.collect.ownerId));
  const attention = data.conversations.filter((c) => c.escalated || (c.unread && !c.agentActive));
  const awaiting = data.distributions.filter((d) => d.status === "awaiting");
  const t30 = periodTotals(data, addDays(today, -30), today);
  const cash = cashAt(data);
  const reserve = reserveTarget(data, today);
  const confirmedAhead = upcoming.filter((b) => b.kind === "paid" && b.state !== "held");
  const myRuns = next30.filter((b) => b.deliver.ownerId === ownerId || b.collect.ownerId === ownerId);

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="admin-top">
        <div>
          <span className="eyebrow muted">{fmtDate(today, { dow: true, year: true })}</span>
          <h1>Morning, {me?.name}.</h1>
        </div>
        <Link href="/admin/calendar" className="btn small">Open calendar</Link>
      </div>

      <div className="grid cols-4">
        <Stat k="Cash in the bank" v={money(cash)} sub={`Reserve target ${money(reserve)}`} />
        <Stat k="Revenue, last 30 days" v={money(t30.revenue)} sub={`Profit ${money(t30.profit)}`} />
        <Stat k="Booked ahead" v={confirmedAhead.length} sub={`${money(confirmedAhead.reduce((s, b) => s + b.total, 0))} contracted`} />
        <Stat k="Your runs, next 30 days" v={myRuns.length} sub={`${money(myRuns.length * data.settings.runnerFee)}+ in runner fees`} />
      </div>

      {(attention.length > 0 || awaiting.length > 0) && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow muted">Needs a person</span>
          {attention.map((c) => (
            <Link key={c.id} href={`/admin/inbox?c=${c.id}`} className="notice" style={{ textDecoration: "none", display: "block" }}>
              <strong>{CHANNEL_LABEL[c.channel]} · {c.name}</strong>: {c.escalated ?? "Waiting on an owner reply"}
            </Link>
          ))}
          {awaiting.map((d) => (
            <Link key={d.id} href="/admin/payouts" className="notice info" style={{ textDecoration: "none", display: "block" }}>
              <strong>{quarterLabel(d.quarter)} payout</strong>: {money(d.distributable)} ready, {d.approvals.length} of {data.settings.approvalsRequired} approvals.
              {ownerId && !d.approvals.includes(ownerId) && " Yours is needed."}
            </Link>
          ))}
        </div>
      )}

      <div className="stack" style={{ gap: 10 }}>
        <span className="eyebrow muted">Runs nobody has claimed (next 30 days)</span>
        {unclaimed.length === 0 ? (
          <div className="card muted">All runs are covered.</div>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Date</th><th>Booking</th><th>Where</th><th>Delivery</th><th>Collection</th></tr></thead>
              <tbody>
                {unclaimed.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDate(b.date, { dow: true })}<br /><span className="muted">{fmtTime(b.startTime)}, {b.block}h</span></td>
                    <td><Link href={`/admin/bookings/${b.id}`}>{b.ref}</Link></td>
                    <td>{b.suburb}<br /><span className="muted">{b.travelMinutes} min</span></td>
                    {(["deliver", "collect"] as const).map((w) => (
                      <td key={w}>
                        {b[w].ownerId ? name(b[w].ownerId) : <button className="btn small gold" onClick={() => claimRun(b.id, w)}>I&apos;ll take it</button>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow muted">Coming up</span>
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {upcoming.slice(0, 8).map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDate(b.date, { dow: true })}</td>
                    <td>
                      <Link href={`/admin/bookings/${b.id}`}>{b.kind === "personal" ? `${name(b.ownerId)} (own use)` : data.customers.find((c) => c.id === b.customerId)?.name}</Link>
                      <br /><span className="muted">{b.eventType ?? ""} · {b.suburb}</span>
                    </td>
                    <td><StatePill b={b} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow muted">What the system did</span>
          <div className="card stack" style={{ gap: 8, fontSize: 14 }}>
            {data.jobs.slice(0, 12).map((j, i) => (
              <div key={i} className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <span>{j.text}</span>
                <span className="mono muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtDateTime(j.at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
