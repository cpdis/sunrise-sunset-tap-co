"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CHANNEL_LABEL, Loading, StatePill, useData } from "@/components/ui";
import { ACCOUNT_LABEL, BALANCE_RETRIES, RELEASE_UNPAID_DAYS, balanceDueDate, cancelPolicy, paidSoFar } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { addDays, fmtDate, fmtDateTime, fmtTime, money, todayISO } from "@/lib/util";

const PAY_LABEL: Record<string, string> = {
  deposit: "Deposit",
  balance: "Balance",
  bond_hold: "Bond hold (authorisation)",
  bond_release: "Bond released",
  bond_capture: "Bond captured",
  refund: "Refund",
};

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const data = useData();
  const a = useApp();
  const [capAmt, setCapAmt] = useState("");
  const [capNote, setCapNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!data) return <Loading />;
  const b = data.bookings.find((x) => x.id === id);
  if (!b) return <h1>Not found</h1>;
  const s = data.settings;
  const c = data.customers.find((x) => x.id === b.customerId);
  const owner = (oid?: string) => data.owners.find((o) => o.id === oid)?.name;
  const pays = data.payments.filter((p) => p.bookingId === b.id);
  const ledger = data.ledger.filter((e) => e.ref === b.id);
  const conv = data.conversations.find((x) => x.customerId && x.customerId === b.customerId);
  const pol = cancelPolicy(s, b);
  const open = b.state !== "cancelled" && b.state !== "completed";
  const net = ledger.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="admin-top">
        <div>
          <Link href="/admin/bookings" className="muted" style={{ fontSize: 14 }}>← Bookings</Link>
          <h1>{b.ref} · {b.kind === "personal" ? `${owner(b.ownerId)}, own use` : c?.name}</h1>
          <span className="muted">{fmtDate(b.date, { dow: true, year: true })}, {fmtTime(b.startTime)} for {b.block} hours · {b.suburb} ({b.travelMinutes} min, {b.km} km)</span>
        </div>
        <StatePill b={b} />
      </div>

      <div className="grid cols-3" style={{ alignItems: "start" }}>
        <div className="card stack" style={{ gap: 6 }}>
          <span className="eyebrow muted">Customer</span>
          {c ? (
            <>
              <strong>{c.name}</strong>
              <a href={`tel:${c.phone}`}>{c.phone}</a>
              <a href={`mailto:${c.email}`}>{c.email}</a>
            </>
          ) : <span className="muted">Owner booking</span>}
          <span className="muted" style={{ fontSize: 14 }}>Booked via {CHANNEL_LABEL[b.createdVia]} on {fmtDateTime(b.createdAt)}</span>
          {b.eventType && <span>{b.eventType}{b.guests ? `, ~${b.guests} guests` : ""}</span>}
          {b.notes && <span className="muted" style={{ fontSize: 14 }}>“{b.notes}”</span>}
          <span style={{ fontSize: 14 }}>Hire agreement: {b.agreementSigned ? "signed" : "not yet"}</span>
          {conv && <Link href={`/admin/inbox?c=${conv.id}`}>Open conversation →</Link>}
        </div>

        <div className="card stack" style={{ gap: 6 }}>
          <span className="eyebrow muted">Money</span>
          <div className="summary-row"><span>Hire</span><span>{money(b.price)}</span></div>
          {b.travelFee > 0 && <div className="summary-row"><span>Travel</span><span>{money(b.travelFee)}</span></div>}
          <div className="summary-row"><strong>Total</strong><strong>{money(b.total)}</strong></div>
          <div className="summary-row"><span>Collected</span><span>{money(paidSoFar(data, b.id))}</span></div>
          <div className="summary-row"><span>Net to the business</span><span>{money(net)}</span></div>
          {b.state === "confirmed" && !b.balanceFailedAt && <span className="muted" style={{ fontSize: 14 }}>Balance auto-charges {fmtDate(balanceDueDate(s, b), { dow: true })}.</span>}
          {b.state === "confirmed" && b.balanceFailedAt && <span style={{ fontSize: 14 }}>Balance declined {b.balanceAttempts} of {BALANCE_RETRIES} tries. Released {fmtDate(addDays(b.date, -RELEASE_UNPAID_DAYS), { dow: true })} if still unpaid.</span>}
          <span style={{ fontSize: 14 }}>Bond: {b.bondStatus === "none" ? `not yet held (${money(b.bond)})` : b.bondStatus === "captured" ? `captured ${money(b.bondCaptured ?? 0)}` : b.bondStatus}</span>
        </div>

        <div className="card stack" style={{ gap: 10 }}>
          <span className="eyebrow muted">Runs</span>
          {(["deliver", "collect"] as const).map((w) => (
            <div key={w} className="row between">
              <span>{w === "deliver" ? "Delivery" : "Collection"}: <strong>{owner(b[w].ownerId) ?? "unclaimed"}</strong>{b[w].done ? " ✓" : ""}</span>
              {open && b[w].ownerId !== a.ownerId && <button className="btn small ghost" onClick={() => a.claimRun(b.id, w)}>{b[w].ownerId ? "Swap to me" : "Claim"}</button>}
            </div>
          ))}
          <span className="muted" style={{ fontSize: 13 }}>Each run pays {money(s.runnerFee)} to the owner who does it.</span>
        </div>
      </div>

      {b.kind === "paid" && (
        <div className="card stack">
          <span className="eyebrow muted">Actions</span>
          <div className="row">
            {b.state === "confirmed" && <button className="btn small" onClick={() => a.chargeBalanceNow(b.id)}>Charge balance now ({money(b.total - b.deposit)})</button>}
            {b.bondStatus === "held" && <button className="btn small ghost" onClick={() => a.releaseBond(b.id)}>Release bond</button>}
            {open && b.date >= todayISO() && !confirmCancel && <button className="btn small ghost" onClick={() => setConfirmCancel(true)}>Cancel booking…</button>}
            {confirmCancel && (
              <>
                <span>Refund {money(pol.refund)}, keep {money(pol.kept)} ({pol.days} days out).</span>
                <button className="btn small danger" onClick={() => { a.cancel(b.id); setConfirmCancel(false); }}>Confirm cancel</button>
                <button className="btn small ghost" onClick={() => setConfirmCancel(false)}>Back</button>
              </>
            )}
          </div>
          {(b.bondStatus === "held" || (b.state === "completed" && b.bondStatus !== "captured")) && (
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ width: 120 }}><label htmlFor="cap-1">Capture</label><input id="cap-1" className="input" inputMode="numeric" placeholder={String(b.bond)} value={capAmt} onChange={(e) => setCapAmt(e.target.value)} /></div>
              <div className="field" style={{ flex: 1, minWidth: 220 }}><label htmlFor="cap-2">Why (shown to customer)</label><input id="cap-2" className="input" placeholder="e.g. Broken tap handle, $85 part + fitting" value={capNote} onChange={(e) => setCapNote(e.target.value)} /></div>
              <button className="btn small danger" disabled={!capNote || !(Number(capAmt) > 0) || Number(capAmt) > b.bond} onClick={() => { a.captureBond(b.id, Number(capAmt), capNote); setCapAmt(""); setCapNote(""); }}>Capture from bond</button>
            </div>
          )}
          {b.condition && <span>Condition note: {b.condition}</span>}
        </div>
      )}

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow muted">Stripe payments (simulated)</span>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>When</th><th>Type</th><th className="num">Amount</th><th className="num">Fee</th><th>ID</th></tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDateTime(p.at)}</td>
                    <td>{PAY_LABEL[p.type]}{p.status === "failed" && <span className="pill bad" style={{ marginLeft: 6 }}>Declined</span>}<br /><span className="muted">{p.card}</span></td>
                    <td className="num">{money(p.amount, true)}</td>
                    <td className="num muted">{p.fee ? money(p.fee, true) : ""}</td>
                    <td className="mono muted" style={{ fontSize: 11 }}>{p.id}</td>
                  </tr>
                ))}
                {pays.length === 0 && <tr><td colSpan={5} className="muted">No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow muted">Ledger entries</span>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Date</th><th>Account</th><th>Memo</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.date)}</td>
                    <td>{ACCOUNT_LABEL[e.account]}</td>
                    <td className="muted">{e.memo}</td>
                    <td className={`num ${e.amount > 0 ? "pos" : ""}`}>{money(e.amount, true)}</td>
                  </tr>
                ))}
                {ledger.length === 0 && <tr><td colSpan={4} className="muted">Nothing posted.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
