"use client";

import Link from "next/link";
import { useState } from "react";
import { Loading, Section, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import { addDays, addMonths, cls, fmtDate, todayISO, weekday } from "@/lib/util";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Calendar() {
  const data = useData();
  const toggleBlackout = useApp((s) => s.toggleBlackout);
  const addPersonalUse = useApp((s) => s.addPersonalUse);
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7) + "-01");
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!data) return <Loading />;

  const lead = (weekday(month) + 6) % 7;
  const start = addDays(month, -lead);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const live = data.bookings.filter((b) => b.state !== "cancelled");
  const name = (b: (typeof live)[number]) =>
    b.kind === "personal" ? `${data.owners.find((o) => o.id === b.ownerId)?.name} (own)` : data.customers.find((c) => c.id === b.customerId)?.name?.split(" ")[0];
  const selBooking = sel ? live.find((b) => b.date === sel) : undefined;

  return (
    <div className="page">
      <div className="admin-top">
        <h1>{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</h1>
        <div className="row">
          <button className="btn ghost small" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>←</button>
          <button className="btn ghost small" onClick={() => setMonth(today.slice(0, 7) + "-01")}>Today</button>
          <button className="btn ghost small" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>→</button>
        </div>
      </div>
      <div className="stack">
        <div className="mcal">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="label">{d}</div>)}
          {cells.map((d) => {
            const bs = live.filter((b) => b.date === d);
            return (
              <div
                key={d}
                className={cls("cell", d.slice(0, 7) !== month.slice(0, 7) && "out", d === today && "today", data.blackouts.includes(d) && "black")}
                onClick={() => { setSel(d); setNote(""); }}
                style={{ cursor: "pointer", outline: sel === d ? "2px solid var(--ink)" : undefined }}
              >
                <button type="button" className="day-btn mono" aria-pressed={sel === d} aria-label={fmtDate(d, { dow: true, year: true })} onClick={(e) => { e.stopPropagation(); setSel(d); setNote(""); }}>{Number(d.slice(8))}</button>
                {bs.map((b) => (
                  <Link key={b.id} href={`/admin/bookings/${b.id}`} className={`ev ${b.kind === "personal" ? "personal" : b.state === "held" ? "held" : "paid"}`} onClick={(e) => e.stopPropagation()}>
                    {name(b)}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span><i style={{ background: "var(--ink)" }} />Paid booking</span>
          <span><i style={{ background: "var(--gold)" }} />Held, awaiting deposit</span>
          <span><i style={{ background: "var(--sand)" }} />Owner use</span>
          <span><i style={{ background: "repeating-linear-gradient(135deg,#fff,#fff 3px,var(--ground) 3px,var(--ground) 6px)" }} />Blocked out</span>
        </div>
      </div>

      {sel && (
        <Section title={fmtDate(sel, { dow: true, year: true })}>
          <div className="card stack">
            {selBooking ? (
              <span>Booked: <Link href={`/admin/bookings/${selBooking.id}`}>{selBooking.ref} · {name(selBooking)}</Link></span>
            ) : sel <= today ? (
              <span className="muted">In the past.</span>
            ) : (
              <>
                <div className="row">
                  <input className="input" aria-label="What for?" style={{ maxWidth: 360 }} placeholder="What for? (e.g. Run club Saturday)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn small" onClick={() => { addPersonalUse(sel, note || "Owner use"); setSel(null); }}>Book for my own use</button>
                  <button className="btn ghost small" onClick={() => toggleBlackout(sel)}>{data.blackouts.includes(sel) ? "Unblock date" : "Block out (service, away)"}</button>
                </div>
                <span className="note">Own use stays open to customers: a paid booking on the same day bumps it.</span>
              </>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
