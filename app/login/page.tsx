"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { Loading, useData } from "@/components/ui";
import { useApp } from "@/lib/store";

// Simulated magic-link login. In production: Supabase Auth email OTP, owners only.
export default function Login() {
  const data = useData();
  const login = useApp((s) => s.login);
  const router = useRouter();
  const [sent, setSent] = useState<string | null>(null);
  if (!data) return <Loading />;
  const owner = data.owners.find((o) => o.id === sent);

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card stack" style={{ width: "min(440px, 100%)", gap: 20 }}>
        <div className="row"><Logo size={44} /><span className="display" style={{ fontSize: 34 }}>Owners</span></div>
        {!owner ? (
          <>
            <span className="muted">Pick who you are. We&apos;ll email you a sign-in link.</span>
            <div className="stack" style={{ gap: 8 }}>
              {data.owners.map((o) => (
                <button key={o.id} className="btn ghost" style={{ justifyContent: "space-between" }} onClick={() => setSent(o.id)}>
                  <span>{o.name}</span><span className="mono muted" style={{ fontSize: 12 }}>{o.email}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="notice info">
              Link sent to <strong>{owner.email}</strong>. In this demo the email is simulated, so open it here.
            </div>
            <button className="btn gold" onClick={() => { login(owner.id); router.push("/admin"); }}>Open sign-in link</button>
            <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setSent(null)}>Not {owner.name}?</button>
          </>
        )}
      </div>
    </div>
  );
}
