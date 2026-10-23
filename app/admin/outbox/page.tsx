"use client";

import { useEffect, useState } from "react";
import { Linkify, Loading, Section } from "@/components/ui";
import { useApp } from "@/lib/store";
import { fmtDateTime } from "@/lib/util";

interface Sent {
  id: string;
  channel: "sms" | "email";
  to: string;
  subject: string | null;
  body: string;
  at: string;
}

// The simulated outbox: every SMS and email the business would have sent, newest first. Owner notices when a
// conversation needs one, owner replies to customers and system alerts. Nothing here is really sent.
export default function Outbox() {
  // The store's data changes after every command and refresh, so the outbox is read again with it.
  const data = useApp((s) => s.data);
  const [messages, setMessages] = useState<Sent[] | null>(null);
  useEffect(() => {
    fetch("/api/outbox", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((j) => setMessages(j.messages))
      .catch(() => setMessages([]));
  }, [data]);
  if (!messages) return <Loading />;
  return (
    <div className="page">
      <div className="admin-top"><h1>Outbox</h1></div>
      <p className="note">Simulated SMS and email. In a live business these go to the owners&apos; inbox and the customer&apos;s phone or email; here they stop at this page.</p>
      <Section title="Sent" aside={<span className="meta">{messages.length} latest</span>}>
        {messages.length === 0 ? (
          <div className="card muted">Nothing sent yet.</div>
        ) : (
          <ol className="feed outbox">
            {messages.map((m) => (
              <li key={m.id}>
                <div className="outbox-head">
                  <strong>{m.subject ?? (m.channel === "sms" ? "Text message" : "Email")}</strong>
                  <time className="meta">{fmtDateTime(m.at)}</time>
                </div>
                <span className="meta">{m.channel === "sms" ? "SMS" : "Email"} to {m.to}</span>
                <p><Linkify text={m.body} /></p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
