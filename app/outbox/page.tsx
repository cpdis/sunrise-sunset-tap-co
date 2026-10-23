import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Logo } from "@/components/Logo";
import { demoFor } from "@/lib/server/auth";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";
import { fmtDateTime } from "@/lib/util";

// Reads the outbox at request time, never at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Outbox · Sunrise Sunset Tap Co.", robots: { index: false } };

// Turns the links in a message into anchors. Everything here is the demo's own mail, so links stay in the tab.
function Body({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/g).map((p, i) =>
        /^https?:\/\//.test(p) ? <a key={i} href={p} style={{ wordBreak: "break-all" }}>{p}</a> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

// The simulated outbox: what would have gone out by email or SMS, sign-in links included (each owner's newest only,
// repo.replaceOutbox). It shows only the demo business, and only while its demo features are on: outside
// production, or in production with DEMO_MODE on (KTD12, A1).
export default async function Outbox() {
  const repo = await getRepo();
  if (!(await demoFor(repo, DEMO_TENANT))) notFound();
  const messages = await repo.readOutbox(DEMO_TENANT);
  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)", padding: "40px 16px" }}>
      <div className="stack" style={{ maxWidth: 720, margin: "0 auto", gap: 20 }}>
        <div className="row between">
          <div className="row"><Logo size={44} /><h1 className="display" style={{ fontSize: 34, margin: 0 }}>Outbox</h1></div>
          <Link href="/login">Owner login</Link>
        </div>
        <div className="notice info">Simulated email and SMS. Nothing here was really sent; in a live business these go to the owner&apos;s inbox or phone.</div>
        {messages.length === 0 && <div className="card muted">Nothing sent yet.</div>}
        {messages.map((m) => (
          <article key={m.id} className="card stack" style={{ gap: 8 }}>
            <div className="row between" style={{ gap: 8 }}>
              <strong>{m.subject ?? (m.channel === "sms" ? "Text message" : "Email")}</strong>
              <span className="muted mono" style={{ fontSize: 12 }}>{fmtDateTime(m.createdAt.toISOString())}</span>
            </div>
            <span className="muted mono login-email" style={{ fontSize: 12 }}>{m.channel === "sms" ? "SMS" : "Email"} to {m.to}</span>
            <p style={{ margin: 0 }}><Body text={m.body} /></p>
          </article>
        ))}
      </div>
    </div>
  );
}
