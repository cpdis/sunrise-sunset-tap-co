"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CHANNEL_LABEL, Loading, Section, StatePill, useData } from "@/components/ui";
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

  const bond = b.bondStatus === "none" ? `Not yet held (${money(b.bond)})` : b.bondStatus === "captured" ? `Captured ${money(b.bondCaptured ?? 0)}` : b.bondStatus === "held" ? "Held" : "Released";

  return (
    <div className="page">
      <div className="admin-top">
        <div className="stack" style={{ gap: 4 }}>
          <Link href="/admin/bookings" className="crumb">← Bookings</Link>
          <h1>{b.ref} · {b.kind === "personal" ? `${owner(b.ownerId)}, own use` : c?.name}</h1>
          <span className="note">{fmtDate(b.date, { dow: true, year: true })}, {fmtTime(b.startTime)} for {b.block} hours · {b.suburb} ({b.travelMinutes} min, {b.km} km)</span>
        </div>
        <StatePill b={b} />
      </div>

      <div className="grid cols-3" style={{ alignItems: "start" }}>
        <Section title="Customer">
          <div className="card stack" style={{ gap: 12 }}>
            {c ? (
              <div>
                <div className="summary-row"><span>Name</span><strong>{c.name}</strong></div>
                <div className="summary-row"><span>Phone</span><a href={`tel:${c.phone}`}>{c.phone}</a></div>
                <div className="summary-row"><span>Email</span><a href={`mailto:${c.email}`}>{c.email}</a></div>
                <div className="summary-row"><span>Booked</span><span>{CHANNEL_LABEL[b.createdVia]}, {fmtDateTime(b.createdAt)}</span></div>
                {b.eventType && <div className="summary-row"><span>Event</span><span>{b.eventType}{b.guests ? `, ~${b.guests} guests` : ""}</span></div>}
                <div className="summary-row"><span>Hire agreement</span><span>{b.agreementSigned ? "Signed" : "Not yet"}</span></div>
              </div>
            ) : <span className="muted">Owner booking</span>}
            {b.notes && <span className="note">“{b.notes}”</span>}
            {conv && <Link href={`/admin/inbox?c=${conv.id}`}>Open conversation →</Link>}
          </div>
        </Section>

        <Section title="Money">
          <div className="card stack" style={{ gap: 12 }}>
            <div>
              <div className="summary-row"><span>Hire</span><span>{money(b.price)}</span></div>
              {b.travelFee > 0 && <div className="summary-row"><span>Travel</span><span>{money(b.travelFee)}</span></div>}
              <div className="summary-row total"><strong>Total</strong><strong>{money(b.total)}</strong></div>
              <div className="summary-row"><span>Collected</span><span>{money(paidSoFar(data, b.id))}</span></div>
              <div className="summary-row"><span>Net to the business</span><span>{money(net)}</span></div>
              <div className="summary-row"><span>Bond</span><span>{bond}</span></div>
            </div>
            {b.state === "confirmed" && !b.balanceFailedAt && <span className="note">Balance auto-charges {fmtDate(balanceDueDate(s, b), { dow: true })}.</span>}
            {b.state === "confirmed" && b.balanceFailedAt && <span className="note">Balance declined {b.balanceAttempts} of {BALANCE_RETRIES} tries. Released {fmtDate(addDays(b.date, -RELEASE_UNPAID_DAYS), { dow: true })} if still unpaid.</span>}
          </div>
        </Section>

        <Section title="Runs">
          <div className="card stack" style={{ gap: 12 }}>
            <div>
              {(["deliver", "collect"] as const).map((w) => (
                <div key={w} className="summary-row" style={{ alignItems: "center" }}>
                  <span>{w === "deliver" ? "Delivery" : "Collection"}</span>
                  <span className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
                    <strong>{owner(b[w].ownerId) ?? "Unclaimed"}{b[w].done ? " ✓" : ""}</strong>
                    {open && b[w].ownerId !== a.ownerId && <button className="btn small ghost" onClick={() => a.claimRun(b.id, w)}>{b[w].ownerId ? "Swap to me" : "Claim"}</button>}
                  </span>
                </div>
              ))}
            </div>
            <span className="note">Each run pays {money(s.runnerFee)} to the owner who does it.</span>
          </div>
        </Section>
      </div>

      {b.kind === "paid" && (
        <Section title="Actions">
          <div className="card stack">
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
        </Section>
      )}

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <Section title="Stripe payments (simulated)">
          <div className="table-wrap">
            <table className="t cards">
              <thead><tr><th>When</th><th>Type</th><th className="num">Amount</th><th className="num">Fee</th><th>ID</th></tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDateTime(p.at)}</td>
                    <td data-label="Type"><span>{PAY_LABEL[p.type]}{p.status === "failed" && <span className="pill bad" style={{ marginLeft: 6 }}>Declined</span>}<br /><span className="muted">{p.card}</span></span></td>
                    <td className="num" data-label="Amount">{money(p.amount, true)}</td>
                    <td className="num muted" data-label="Fee">{p.fee ? money(p.fee, true) : ""}</td>
                    <td className="meta" data-label="ID">{p.id}</td>
                  </tr>
                ))}
                {pays.length === 0 && <tr><td colSpan={5} className="muted">No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Ledger entries">
          <div className="table-wrap">
            <table className="t cards">
              <thead><tr><th>Date</th><th>Account</th><th>Memo</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.date)}</td>
                    <td data-label="Account">{ACCOUNT_LABEL[e.account]}</td>
                    <td className="muted" data-label="Memo">{e.memo}</td>
                    <td className={`num ${e.amount > 0 ? "pos" : ""}`} data-label="Amount">{money(e.amount, true)}</td>
                  </tr>
                ))}
                {ledger.length === 0 && <tr><td colSpan={4} className="muted">Nothing posted.</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
