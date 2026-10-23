"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/Logo";

interface Props {
  // The demo's owners to pick from; empty outside the demo.
  owners: { name: string; email: string }[];
  demo: boolean;
  minutes: number;
  // Back from a sign-in link that was used, expired or forged.
  expired: boolean;
}

export function LoginForm({ owners, demo, minutes, expired }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(to: string) {
    if (busy || !/\S+@\S+\.\S+/.test(to)) return setErr("Enter the email you use for the business.");
    setBusy(true);
    setErr("");
    const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: to.trim() }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setErr("That didn't send. Try again?");
    setSent(to.trim());
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card stack" style={{ width: "min(440px, 100%)", gap: 20 }}>
        <div className="row"><Logo size={44} /><h1 className="display" style={{ fontSize: 34, margin: 0 }}>Owners</h1></div>
        {sent ? (
          <>
            <div className="notice info" role="status">
              If <strong>{sent}</strong> belongs to an owner, a sign-in link is on its way. It works once, within {minutes} minutes.
              {demo && " In this demo the email is simulated, so it lands in the outbox."}
            </div>
            {demo && <Link className="btn gold" href="/outbox">Open the outbox</Link>}
            <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setSent(null)}>Use another email</button>
          </>
        ) : (
          <>
            {expired && <div className="notice" role="alert">That sign-in link has expired or was used already. Send yourself a new one.</div>}
            {owners.length > 0 && (
              <>
                <span className="muted">Pick who you are. We&apos;ll email you a sign-in link.</span>
                <div className="stack" style={{ gap: 8 }}>
                  {owners.map((o) => (
                    <button key={o.email} className="btn ghost" style={{ justifyContent: "space-between" }} disabled={busy} onClick={() => send(o.email)}>
                      <span>{o.name}</span><span className="mono muted login-email" style={{ fontSize: 12 }}>{o.email}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); send(email); }}>
              <div className="field">
                <label htmlFor="login-email">{owners.length ? "Or type your email" : "Your email"}</label>
                <input id="login-email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy}>Email me a sign-in link</button>
            </form>
            {err && <span role="alert" style={{ color: "var(--bad)", fontSize: 14 }}>{err}</span>}
          </>
        )}
      </div>
    </div>
  );
}
