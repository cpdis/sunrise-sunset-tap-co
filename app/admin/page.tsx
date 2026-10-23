"use client";

import Link from "next/link";
import { CHANNEL_LABEL, Loading, Section, Stat, StatePill, useData } from "@/components/ui";
import { BALANCE_RETRIES, RELEASE_UNPAID_DAYS, balanceStuck, cashAt, liveBookings, periodTotals } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { addDays, daysBetween, fmtDate, fmtDateTime, fmtTime, money, perthHour, quarterLabel, todayISO } from "@/lib/util";

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
  const confirmedAhead = upcoming.filter((b) => b.kind === "paid" && b.state !== "held");
  const myRuns = next30.filter((b) => b.deliver.ownerId === ownerId || b.collect.ownerId === ownerId);
  const stuck = data.bookings.filter(balanceStuck);
  const h = perthHour();
  const greeting = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";

  return (
    <div className="page">
      <div className="admin-top">
        <div>
          <span className="meta">{fmtDate(today, { dow: true, year: true })}</span>
          <h1>{greeting}, {me?.name}.</h1>
        </div>
        <div className="row">
          <Link href="/admin/calendar" className="btn small">Open calendar</Link>
        </div>
      </div>

      <div className="stats">
        <Stat k="Cash in the bank" v={money(cash)} />
        <Stat k="Revenue, last 30 days" v={money(t30.revenue)} />
        <Stat k="Booked ahead" v={confirmedAhead.length} />
        <Stat k="Your runs, next 30 days" v={myRuns.length} />
      </div>

      {(attention.length > 0 || awaiting.length > 0 || stuck.length > 0) && (
        <Section title="Needs a person">
          <div className="list">
            {attention.map((c) => (
              <Link key={c.id} href={`/admin/inbox?c=${c.id}`} className="list-row">
                <span className="dot bad" aria-hidden="true" />
                <span className="list-main"><strong>{c.name}</strong><span>{c.escalated ?? "Waiting on an owner reply"}</span></span>
                <span className="meta">{CHANNEL_LABEL[c.channel]}</span>
              </Link>
            ))}
            {stuck.map((b) => (
              <Link key={b.id} href={`/admin/bookings/${b.id}`} className="list-row">
                <span className="dot warn" aria-hidden="true" />
                <span className="list-main">
                  <strong>{b.ref} balance declined {BALANCE_RETRIES} times</strong>
                  <span>{data.customers.find((c) => c.id === b.customerId)?.name}, {fmtDate(b.date, { dow: true })}. The date is released {fmtDate(addDays(b.date, -RELEASE_UNPAID_DAYS), { dow: true })} if it&apos;s still unpaid.</span>
                </span>
                <span className="meta">Booking</span>
              </Link>
            ))}
            {awaiting.map((d) => (
              <Link key={d.id} href="/admin/payouts" className="list-row">
                <span className="dot info" aria-hidden="true" />
                <span className="list-main">
                  <strong>{quarterLabel(d.quarter)} payout</strong>
                  <span>{money(d.lines.reduce((s, l) => s + l.amount + l.runnerFees, 0))} ready, {d.approvals.length} of {data.settings.approvalsRequired} approvals.{ownerId && !d.approvals.includes(ownerId) && " Yours is needed."}</span>
                </span>
                <span className="meta">Payout</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Runs nobody has claimed (next 30 days)">
        {unclaimed.length === 0 ? (
          <div className="card empty-note">All runs are covered.</div>
        ) : (
          <div className="table-wrap">
            <table className="t cards">
              <thead><tr><th>Date</th><th>Booking</th><th>Where</th><th>Delivery</th><th>Collection</th></tr></thead>
              <tbody>
                {unclaimed.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDate(b.date, { dow: true })}<br /><span className="muted">{fmtTime(b.startTime)}, {b.block}h</span></td>
                    <td data-label="Booking"><Link className="ref" href={`/admin/bookings/${b.id}`}>{b.ref}</Link></td>
                    <td data-label="Where"><span>{b.suburb}<br /><span className="muted">{b.travelMinutes} min</span></span></td>
                    {(["deliver", "collect"] as const).map((w) => (
                      <td key={w} data-label={w === "deliver" ? "Delivery" : "Collection"}>
                        {b[w].ownerId ? name(b[w].ownerId) : <button className="btn small action" onClick={() => claimRun(b.id, w)}>I&apos;ll take it</button>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <Section title="Coming up">
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {upcoming.slice(0, 8).map((b) => (
                  <tr key={b.id}>
                    <td className="nowrap">{fmtDate(b.date, { dow: true })}</td>
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
        </Section>
        <Section title="What the system did">
          <ol className="feed">
            {data.jobs.slice(0, 12).map((j, i) => (
              <li key={i}>
                <span>{j.text}</span>
                <time className="meta">{fmtDateTime(j.at)}</time>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
