"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HireTermsText } from "@/components/HireTerms";
import { Logo } from "@/components/Logo";
import { Loading, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import { daysBetween, fmtDate, fmtTime, money, todayISO } from "@/lib/util";

// Stand-in for Stripe Checkout. In production this is a hosted Checkout Session
// (mode "payment", setup_future_usage "off_session") and the webhook confirms the booking.
const S = {
  page: { minHeight: "100vh", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", background: "#fff", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: "#1a1f36" },
  left: { background: "#f6f9fc", padding: "48px clamp(20px, 5vw, 64px)", display: "flex", flexDirection: "column" as const, gap: 20 },
  right: { padding: "48px clamp(20px, 5vw, 64px)", display: "flex", flexDirection: "column" as const, gap: 16, maxWidth: 520 },
  label: { fontSize: 13, color: "#697386", fontWeight: 500, marginBottom: 6, display: "block" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #e0e6eb", borderRadius: 6, fontSize: 15, boxShadow: "0 1px 1px rgba(0,0,0,.03)" },
  pay: { background: "#635bff", color: "#fff", border: 0, borderRadius: 6, padding: "13px 16px", fontSize: 16, fontWeight: 600, cursor: "pointer" },
  test: { background: "#ffde92", color: "#a04100", fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: ".04em" },
};

export default function Checkout() {
  const { id } = useParams<{ id: string }>();
  const data = useData();
  const payDeposit = useApp((s) => s.payDeposit);
  const payBalance = useApp((s) => s.payBalance);
  const router = useRouter();
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [exp, setExp] = useState("12 / 30");
  const [cvc, setCvc] = useState("123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Never prefilled from the customer record: the link can reach someone who isn't that customer.
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <Loading />;
  const b = data.bookings.find((x) => x.id === id);
  if (!b) return <main className="wrap section"><h1 className="display">Booking not found</h1><Link href="/book">Start again</Link></main>;
  // A balance that kept declining is paid here with a new card.
  const balanceMode = b.state === "confirmed" && !!b.balanceFailedAt;
  if (b.state !== "held" && !balanceMode) {
    return (
      <main className="wrap section stack">
        <h1 className="display">{b.state === "cancelled" ? "This hold has expired" : "Already paid"}</h1>
        <Link className="btn" style={{ alignSelf: "flex-start" }} href={b.state === "cancelled" ? "/book" : `/booking/${b.id}`}>
          {b.state === "cancelled" ? "Pick a date again" : "View booking"}
        </Link>
      </main>
    );
  }

  const full = daysBetween(todayISO(), b.date) <= data.settings.balanceDaysBefore;
  const due = balanceMode ? b.total - b.deposit : full ? b.total : b.deposit;
  const left = balanceMode ? Infinity : Math.max(0, Date.parse(b.heldUntil ?? "") - now);
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const needsTerms = !b.agreementSigned && !balanceMode;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const digits = card.replace(/\D/g, "");
    if (!/\S+@\S+\.\S+/.test(email)) return setErr("Enter an email for your receipt.");
    if (needsTerms && !agree) return setErr("Please accept the hire terms.");
    if (digits.length < 15) return setErr("Your card number is incomplete.");
    if (digits === "4000000000000002") return setErr("Your card was declined. Try another card.");
    setBusy(true);
    setTimeout(() => {
      if (balanceMode) payBalance(b!.id, `Visa •• ${digits.slice(-4)}`);
      else payDeposit(b!.id, `Visa •• ${digits.slice(-4)}`, { email: email.trim(), agreed: needsTerms ? agree : undefined });
      router.push(`/booking/${b!.id}?paid=1`);
    }, 900);
  }

  return (
    <main style={S.page}>
      <div style={S.left}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href="/book" style={{ color: "#697386", textDecoration: "none" }}>←</Link>
          <Logo size={28} />
          <strong>Sunrise Sunset Tap Co.</strong>
          <span style={S.test}>TEST MODE</span>
        </div>
        <div>
          <div style={{ color: "#697386", fontSize: 15 }}>{balanceMode ? "Balance" : full ? "Pay in full" : "Deposit to hold your date"}</div>
          <div style={{ fontSize: 36, fontWeight: 600 }}>{money(due, true)}</div>
        </div>
        <div style={{ fontSize: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{b.block}-hour tap truck hire · {b.ref}<br /><span style={{ color: "#697386" }}>{fmtDate(b.date, { dow: true, year: true })}, {fmtTime(b.startTime)} · {b.suburb}</span></span>
            <span>{money(b.price, true)}</span>
          </div>
          {b.travelFee > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Travel fee</span><span>{money(b.travelFee, true)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e0e6eb", paddingTop: 10 }}><span>Total</span><span>{money(b.total, true)}</span></div>
          {!full && !balanceMode && <div style={{ display: "flex", justifyContent: "space-between", color: "#697386" }}><span>Balance, charged automatically {data.settings.balanceDaysBefore} days before</span><span>{money(b.total - b.deposit, true)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span>Due today</span><span>{money(due, true)}</span></div>
        </div>
        <div style={{ fontSize: 13, color: left < 5 * 60000 ? "#cd3d64" : "#697386" }}>
          {balanceMode ? "" : left > 0 ? `Date held for ${mm}:${ss}` : "Hold expired. Refresh to see if the date is still free."}
        </div>
      </div>

      <form style={S.right} onSubmit={submit}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Pay with card</h1>
        <div>
          <label style={S.label} htmlFor="co-email">Email</label>
          <input id="co-email" style={S.input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Card information</label>
          <input style={{ ...S.input, borderRadius: "6px 6px 0 0" }} value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" aria-label="Card number" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <input style={{ ...S.input, borderRadius: "0 0 0 6px", borderTop: 0 }} value={exp} onChange={(e) => setExp(e.target.value)} aria-label="Expiry" />
            <input style={{ ...S.input, borderRadius: "0 0 6px 0", borderTop: 0, borderLeft: 0 }} value={cvc} onChange={(e) => setCvc(e.target.value)} aria-label="CVC" />
          </div>
        </div>
        <div>
          <label style={S.label} htmlFor="co-name">Name on card</label>
          <input id="co-name" style={S.input} autoComplete="cc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {needsTerms && (
          <label style={{ display: "flex", gap: 8, fontSize: 13, color: "#1a1f36", lineHeight: 1.5 }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span><HireTermsText s={data.settings} /></span>
          </label>
        )}
        <label style={{ display: "flex", gap: 8, fontSize: 13, color: "#697386" }}>
          <input type="checkbox" defaultChecked disabled />
          Save this card so Sunrise Sunset can charge the balance and hold the bond as agreed.
        </label>
        {err && <div style={{ color: "#cd3d64", fontSize: 14 }}>{err}</div>}
        <button style={{ ...S.pay, opacity: busy || left <= 0 || (needsTerms && !agree) ? 0.6 : 1 }} disabled={busy || left <= 0 || (needsTerms && !agree)}>
          {busy ? "Processing…" : `Pay ${money(due, true)}`}
        </button>
        <div style={{ fontSize: 12, color: "#697386", lineHeight: 1.5 }}>
          Simulated checkout. No money moves. Use 4242 4242 4242 4242 to succeed or 4000 0000 0000 0002 to see a decline.
        </div>
      </form>
    </main>
  );
}
