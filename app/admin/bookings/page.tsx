"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHANNEL_LABEL, Loading, StatePill, useData } from "@/components/ui";
import { paidSoFar } from "@/lib/domain";
import { cls, fmtDate, money, todayISO } from "@/lib/util";

const FILTERS = ["Upcoming", "Held", "Past", "Cancelled", "All"] as const;

export default function Bookings() {
  const data = useData();
  const router = useRouter();
  const [f, setF] = useState<(typeof FILTERS)[number]>("Upcoming");
  const [q, setQ] = useState("");
  if (!data) return <Loading />;
  const today = todayISO();
  const cust = (id?: string) => data.customers.find((c) => c.id === id);
  const owner = (id?: string) => data.owners.find((o) => o.id === id)?.name;
  const rows = data.bookings
    .filter((b) => {
      if (f === "Upcoming") return b.date >= today && b.state !== "cancelled";
      if (f === "Held") return b.state === "held";
      if (f === "Past") return b.date < today && b.state !== "cancelled";
      if (f === "Cancelled") return b.state === "cancelled";
      return true;
    })
    .filter((b) => {
      if (!q) return true;
      const c = cust(b.customerId);
      return [b.ref, b.suburb, b.eventType, c?.name, c?.email, c?.phone, owner(b.ownerId)].join(" ").toLowerCase().includes(q.toLowerCase());
    })
    .sort((a, b) => (f === "Upcoming" || f === "Held" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="admin-top">
        <h1>Bookings</h1>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search name, ref, suburb" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="seg">
        {FILTERS.map((x) => <button key={x} className={cls(f === x && "on")} onClick={() => setF(x)}>{x}</button>)}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr><th>Date</th><th>Ref</th><th>Customer</th><th>Event</th><th>Where</th><th>Via</th><th className="num">Total</th><th className="num">Paid</th><th>Runs</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const c = cust(b.customerId);
              return (
                <tr key={b.id} className="click" onClick={() => router.push(`/admin/bookings/${b.id}`)}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(b.date, { dow: true, year: true })}<br /><span className="muted">{b.block}h</span></td>
                  <td className="mono">{b.ref}</td>
                  <td>{b.kind === "personal" ? `${owner(b.ownerId)} (owner)` : c?.name}</td>
                  <td>{b.eventType}</td>
                  <td>{b.suburb}</td>
                  <td>{CHANNEL_LABEL[b.createdVia]}</td>
                  <td className="num">{b.kind === "paid" ? money(b.total) : "—"}</td>
                  <td className="num">{b.kind === "paid" ? money(paidSoFar(data, b.id)) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{owner(b.deliver.ownerId) ?? "?"} / {owner(b.collect.ownerId) ?? "?"}</td>
                  <td><StatePill b={b} /></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={10} className="muted">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
