"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";

// The sign-in link's confirm step. The token is in the link's fragment (#token=), which a browser never sends to a
// server; the button posts it to /api/session/confirm, which spends it and sets the session cookie.
export function ConfirmForm({ minutes }: { minutes: number }) {
  // Undefined until the page has read its own address; "" when the address has no token.
  const [token, setToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The token once read. A ref outlives React's development double run of effects, whose second run finds the
  // address already cleared.
  const read = useRef("");

  useEffect(() => {
    // Also on hashchange: a link opened in a tab already on this page changes only the fragment, not the page.
    const take = () => {
      const t = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (t) {
        read.current = t;
        // The token leaves the address bar, so history, a copied address or a page analytics script never holds it.
        history.replaceState(null, "", window.location.pathname);
      }
      setToken(read.current);
    };
    take();
    window.addEventListener("hashchange", take);
    return () => window.removeEventListener("hashchange", take);
  }, []);

  async function signIn() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/session/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    // A full load, so the admin starts from the new session.
    if (res?.ok) return window.location.replace("/admin");
    if (res?.status === 400) return window.location.replace("/login?link=used");
    setBusy(false);
    setErr("That didn't go through. Check your connection and try again.");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card stack" style={{ width: "min(440px, 100%)", gap: 20 }}>
        <div className="row"><Logo size={44} /><h1 className="display" style={{ fontSize: 34, margin: 0 }}>Owners</h1></div>
        {token === undefined ? null : token ? (
          <>
            <p style={{ margin: 0, fontSize: 18 }}>Sign in to the owners&apos; admin on this device?</p>
            <span className="muted">This link works once, within {minutes} minutes of being sent. Nothing happens until you press the button, so if you didn&apos;t ask for it, close this page.</span>
            <button type="button" className="btn gold" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={signIn}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {err && <span role="alert" style={{ color: "var(--bad)", fontSize: 14 }}>{err}</span>}
          </>
        ) : (
          <>
            <div className="notice" role="alert">This page needs the sign-in link from your email. Open the link again, or send yourself a new one.</div>
            <Link className="btn" style={{ alignSelf: "flex-start" }} href="/login">Send a new link</Link>
          </>
        )}
      </div>
    </div>
  );
}
