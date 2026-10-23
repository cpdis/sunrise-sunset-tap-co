"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/SiteChrome";
import { Loading, StatePill, useData } from "@/components/ui";
import { BUSINESS } from "@/lib/config";
import { RELEASE_UNPAID_DAYS, balanceDueDate, cancelNeedsOwner, cancelPolicy, paidSoFar } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { addDays, fmtDate, fmtTime, money, todayISO } from "@/lib/util";

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const data = useData();
  const customerCancel = useApp((s) => s.customerCancel);
  const [paid, setPaid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [asked, setAsked] = useState(false);
  useEffect(() => setPaid(new URLSearchParams(window.location.search).has("paid")), []);

  if (!data) return <SiteShell><Loading /></SiteShell>;
  const b = data.bookings.find((x) => x.id === id);
  if (!b) return <SiteShell><div className="wrap section"><h1 className="display">Booking not found</h1></div></SiteShell>;
  const s = data.settings;
  const cust = data.customers.find((c) => c.id === b.customerId);
  const pol = cancelPolicy(s, b);
  const today = todayISO();
  const balDate = balanceDueDate(s, b);
  const created = b.createdAt.slice(0, 10);
  // A late booking can't have a bond date before the day it was made.
  const bondDate = [addDays(b.date, -s.bondHoldDaysBefore), created, today].sort().at(-1)!;
  const end = fmtTime(`${String((Number(b.startTime.slice(0, 2)) + b.block) % 24).padStart(2, "0")}:00`);
  const paidUpFront = balDate <= created;
  // Over the refund limit the cancel goes to the owners, as it does by SMS. A flag already raised stays shown.
  const ownerReason = cancelNeedsOwner(s, b);
  const requested = asked || (!!ownerReason && data.conversations.some((c) => c.customerId === b.customerId && c.escalated === ownerReason));
  const balancePaid = b.state === "balance_paid" || b.state === "completed";

  const steps = [
    { t: "Date held", d: fmtDate(created, { dow: true }), done: true },
    paidUpFront
      ? { t: `Paid in full (${money(b.total)})`, d: `Inside ${s.balanceDaysBefore} days, so it's paid up front. Hire agreement signed`, done: b.state !== "held" }
      : { t: `Deposit paid (${money(b.deposit)})`, d: "Hire agreement signed", done: b.state !== "held" },
    ...(paidUpFront ? [] : [{ t: `Balance ${money(b.total - b.deposit)} charged automatically`, d: fmtDate(balDate, { dow: true }), done: balancePaid }]),
    { t: `${money(b.bond)} bond hold placed`, d: fmtDate(bondDate, { dow: true }), done: b.bondStatus !== "none" },
    { t: `Delivery and setup, taps open ${fmtTime(b.startTime)}`, d: `${fmtDate(b.date, { dow: true })} · ${b.suburb}`, done: b.deliver.done },
    { t: `Collection at ${end}`, d: "Bond released once the truck's back", done: b.collect.done },
  ];
  const nowIdx = steps.findIndex((x) => !x.done);

  return (
    <SiteShell>
      <section className="section" style={{ paddingTop: 48 }}>
        <div className="wrap stack" style={{ gap: 24, maxWidth: 900 }}>
          {paid && b.state !== "held" && b.state !== "cancelled" && (
            <div className="card night stack" style={{ gap: 8 }}>
              <span className="eyebrow">You&apos;re booked</span>
              <span className="display" style={{ fontSize: 48 }}>See you on {fmtDate(b.date, { dow: true })}.</span>
              <span>Receipt and hire agreement sent to {b.receiptEmail ?? cust?.email}.</span>
            </div>
          )}
          {b.state === "confirmed" && b.balanceFailedAt && (
            <div className="notice">
              <strong>Your card was declined for the {money(b.total - b.deposit)} balance.</strong> Update it by{" "}
              {fmtDate(addDays(b.date, -RELEASE_UNPAID_DAYS), { dow: true })} to keep your date.{" "}
              <Link href={`/checkout/${b.id}`}>Update card and pay</Link>
            </div>
          )}
          <div className="row between">
            <div className="stack" style={{ gap: 4 }}>
              <span className="eyebrow">Booking {b.ref}</span>
              <h1 className="display" style={{ margin: 0, fontSize: "clamp(36px, 4.6vw, 60px)" }}>{fmtDate(b.date, { dow: true, year: true })}</h1>
              <span className="muted">{b.block} hours, {fmtTime(b.startTime)} to {end} · {b.suburb}</span>
            </div>
            <StatePill b={b} />
          </div>

          <div className="grid cols-2" style={{ alignItems: "start" }}>
            <div className="card">
              <ul className="timeline">
                {steps.map((st, i) => (
                  <li key={i}>
                    <span className={`dot ${st.done ? "done" : i === nowIdx && b.state !== "cancelled" ? "now" : ""}`} />
                    <div><strong>{st.t}</strong><br /><span className="muted" style={{ fontSize: 14 }}>{st.d}</span></div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="stack">
              <div className="card">
                <div className="summary-row"><span>Hire</span><span>{money(b.price)}</span></div>
                {b.travelFee > 0 && <div className="summary-row"><span>Travel</span><span>{money(b.travelFee)}</span></div>}
                <div className="summary-row"><strong>Total</strong><strong>{money(b.total)}</strong></div>
                <div className="summary-row"><span>Paid so far</span><span>{money(paidSoFar(data, b.id))}</span></div>
              </div>
              <div className="card stack" style={{ gap: 8 }}>
                <strong>Before the day</strong>
                <span className="muted" style={{ fontSize: 15 }}>Order your kegs and pick them up the day before so they&apos;re cold. Most Aussie beers use the S-type coupler we carry. Text {BUSINESS.sms} with your keg list and we&apos;ll double-check.</span>
              </div>
              {b.state !== "cancelled" && b.state !== "completed" && b.date > today && (
                <div className="card stack" style={{ gap: 10 }}>
                  <strong>Need to cancel?</strong>
                  <span className="muted" style={{ fontSize: 15 }}>
                    {pol.fullRefund
                      ? `You're more than ${s.cancelDays} days out, so you'd get a full refund of ${money(pol.refund)}.`
                      : `You're within ${s.cancelDays} days, so the ${money(b.deposit)} deposit is kept${pol.refund ? ` and ${money(pol.refund)} is refunded` : ""}.`}
                    {ownerReason && !requested && " A refund this size needs one of the owners to approve it, so we'll pass your request on."}
                  </span>
                  {requested ? (
                    <span className="notice info" role="status">
                      A refund this size needs one of the owners to approve it. We&apos;ve sent them your request and they&apos;ll be in touch. Your booking stays as it is until then.
                    </span>
                  ) : confirming ? (
                    <div className="row">
                      <button className="btn danger small" onClick={() => { const r = customerCancel(b.id); if (r && "needsOwner" in r) setAsked(true); setConfirming(false); }}>
                        {ownerReason ? `Ask to cancel ${b.ref}` : `Yes, cancel ${b.ref}`}
                      </button>
                      <button className="btn ghost small" onClick={() => setConfirming(false)}>Keep it</button>
                    </div>
                  ) : (
                    <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setConfirming(true)}>Cancel booking</button>
                  )}
                </div>
              )}
              {b.state === "held" && <Link href={`/checkout/${b.id}`} className="btn gold">Pay deposit</Link>}
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
