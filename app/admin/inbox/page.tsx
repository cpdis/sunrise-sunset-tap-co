"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CHANNEL_LABEL, Linkify, Loading, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { cls, fmtDateTime } from "@/lib/util";

type Inbound = Exclude<Conversation["channel"], "sms"> | "sms";

const SAMPLES: Record<Inbound, { contact: string; name: string; body: string }> = {
  email: { contact: "mia.kelly@example.com", name: "Mia Kelly", body: "Hi! Is the truck free the second Saturday in December for 8 hours in Cottesloe? It's for our engagement party." },
  phone: { contact: "0421 778 300", name: "Caller · 0421 778 300", body: "Hi, how much is it for four hours in Mandurah?" },
  web: { contact: "tom.hughes@example.com", name: "Tom Hughes", body: "Can I get a discount for a school fete?" },
  sms: { contact: "0499 120 554", name: "New contact", body: "how many kegs can it fit" },
};

export default function Inbox() {
  const data = useData();
  const a = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sim, setSim] = useState<Inbound>("email");
  const [simBody, setSimBody] = useState(SAMPLES.email.body);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSel(c);
  }, []);

  const conv = data?.conversations.find((c) => c.id === sel);
  useEffect(() => {
    if (!sel && data?.conversations.length && window.innerWidth > 900) {
      setSel(data.conversations.find((c) => c.escalated)?.id ?? data.conversations[0].id);
    }
  }, [sel, data?.conversations]);
  useEffect(() => {
    if (conv?.unread) a.markRead(conv.id);
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, conv?.messages.length]);

  if (!data) return <Loading />;
  const list = [...data.conversations].sort((x, y) => (y.messages.at(-1)?.at ?? "").localeCompare(x.messages.at(-1)?.at ?? ""));
  const owner = (id?: string) => data.owners.find((o) => o.id === id)?.name ?? "Owner";
  const linked = conv?.customerId ? data.bookings.filter((b) => b.customerId === conv.customerId) : [];

  async function simulate() {
    const s = SAMPLES[sim];
    setBusy(true);
    const id = a.startConversation({ channel: sim, contact: s.contact, name: s.name });
    setSel(id);
    await a.sendCustomer(id, simBody);
    setBusy(false);
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="admin-top">
        <h1>Inbox</h1>
        <span className="muted" style={{ fontSize: 14 }}>SMS, email, phone and web form land here. The agent answers; anything it hands over is flagged.</span>
      </div>

      <details className="card stack" style={{ gap: 10 }}>
        <summary className="eyebrow muted" style={{ cursor: "pointer" }}>Demo controls: simulate an inbound message</summary>
        <div className="row" style={{ alignItems: "flex-end", marginTop: 12 }}>
          <div className="field" style={{ width: 140 }}>
            <label htmlFor="sim-channel">Channel</label>
            <select id="sim-channel" className="input" value={sim} onChange={(e) => { const v = e.target.value as Inbound; setSim(v); setSimBody(SAMPLES[v].body); }}>
              <option value="email">Email</option>
              <option value="phone">Phone (transcribed)</option>
              <option value="web">Web form</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="sim-body">From {SAMPLES[sim].contact}</label>
            <input id="sim-body" className="input" value={simBody} onChange={(e) => setSimBody(e.target.value)} />
          </div>
          <button className="btn small" disabled={busy || !simBody.trim()} onClick={simulate}>{busy ? "Agent replying…" : "Send in"}</button>
        </div>
      </details>

      <div className="split">
        <div className="table-wrap" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <table className="t">
            <tbody>
              {list.map((c) => {
                const last = c.messages.at(-1);
                return (
                  <tr key={c.id} className="click" style={{ background: sel === c.id ? "#faf6ef" : undefined }}>
                    <td>
                      <button type="button" className="rowbtn" onClick={() => setSel(c.id)} aria-current={sel === c.id ? "true" : undefined}>
                      <div className="row between" style={{ flexWrap: "nowrap" }}>
                        <strong style={{ fontWeight: c.unread ? 700 : 500 }}>{c.name}</strong>
                        <span className="pill">{CHANNEL_LABEL[c.channel]}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{last?.body}</div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        {c.escalated && <span className="pill bad">Needs a person</span>}
                        {!c.agentActive && !c.escalated && <span className="pill warn">Owner handling</span>}
                        {last && <span className="mono muted" style={{ fontSize: 11 }}>{fmtDateTime(last.at)}</span>}
                      </div>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {conv ? (
          <div className="stack" style={{ minWidth: 0 }}>
            <div className="row between">
              <div>
                <strong style={{ fontSize: 18 }}>{conv.name}</strong>{" "}
                <span className="muted">{CHANNEL_LABEL[conv.channel]} · {conv.contact}</span>
              </div>
              {conv.agentActive ? (
                <button className="btn small ghost" onClick={() => a.setAgentActive(conv.id, false)}>Take over</button>
              ) : (
                <button className="btn small" onClick={() => a.setAgentActive(conv.id, true)}>Hand back to agent</button>
              )}
            </div>
            {conv.escalated && <div className="notice"><strong>Handed over:</strong> {conv.escalated}</div>}
            {linked.length > 0 && (
              <div className="row" style={{ fontSize: 14 }}>
                Bookings: {linked.map((b) => <Link key={b.id} href={`/admin/bookings/${b.id}`}>{b.ref}</Link>)}
              </div>
            )}
            <div className="thread" ref={threadRef}>
              {conv.messages.map((m) => (
                <div key={m.id} style={{ display: "contents" }}>
                  <div className={cls("bubble", m.from === "customer" ? "me" : m.from === "owner" ? "owner" : m.from === "system" ? "sys" : "them")}>
                    {m.from === "owner" && <span className="mono" style={{ fontSize: 10, display: "block", opacity: 0.8 }}>{owner(m.ownerId)}</span>}
                    <Linkify text={m.body} />
                  </div>
                  {m.from === "agent" && (
                    <span className="tools">
                      agent · {fmtDateTime(m.at)}{m.tools?.length ? ` · ${m.tools.join(", ")}` : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (!reply.trim()) return; if (conv.agentActive) a.setAgentActive(conv.id, false); a.ownerReply(conv.id, reply.trim()); setReply(""); }}>
              <input className="input" aria-label="Reply" style={{ flex: 1 }} placeholder={`Reply by ${CHANNEL_LABEL[conv.channel].toLowerCase()} as ${owner(a.ownerId ?? undefined)}`} value={reply} onChange={(e) => setReply(e.target.value)} />
              <button className="btn primary">Send</button>
            </form>
            <span className="muted" style={{ fontSize: 13 }}>Replying takes the conversation off the agent until you hand it back.</span>
          </div>
        ) : (
          <div className="card muted">Pick a conversation.</div>
        )}
      </div>
    </div>
  );
}
