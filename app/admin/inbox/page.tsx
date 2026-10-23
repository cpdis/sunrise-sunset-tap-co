"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { CHANNEL_LABEL, Linkify, Loading, toolWords, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { Conversation, Msg } from "@/lib/types";
import { cls, fmtDateTime } from "@/lib/util";

type Inbound = Exclude<Conversation["channel"], "sms"> | "sms";

const SAMPLES: Record<Inbound, { contact: string; name: string; body: string }> = {
  email: { contact: "mia.kelly@example.com", name: "Mia Kelly", body: "Hi! Is the truck free the second Saturday in December for 8 hours in Cottesloe? It's for our engagement party." },
  phone: { contact: "0421 778 300", name: "Caller · 0421 778 300", body: "Hi, how much is it for four hours in Mandurah?" },
  web: { contact: "tom.hughes@example.com", name: "Tom Hughes", body: "Can I get a discount for a school fete?" },
  sms: { contact: "0499 120 554", name: "New contact", body: "how many kegs can it fit" },
};

// "Harbour Collective (events)" -> "HC"; a phone-number caller gets a hash.
function initials(name: string) {
  const w = name.replace(/\(.*?\)/g, "").split(/[\s·]+/).filter((x) => /^[A-Za-z]/.test(x));
  return w.length ? (w[0][0] + (w[1]?.[0] ?? "")).toUpperCase() : "#";
}

// One status per conversation, worst first, so the list never stacks pills.
function status(c: Conversation): { dot: string; label: string } {
  if (c.escalated) return { dot: "bad", label: "Needs you" };
  if (!c.agentActive) return { dot: "warn", label: "Owner handling" };
  if (c.ownerId) return { dot: "info", label: "Owner line" };
  return { dot: "good", label: "Agent" };
}

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Alert = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.3v3.4M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);

export default function Inbox() {
  const data = useData();
  const a = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sim, setSim] = useState<Inbound>("email");
  const [simBody, setSimBody] = useState(SAMPLES.email.body);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSel(c);
  }, []);

  const conv = data?.conversations.find((c) => c.id === sel);
  // wide screens open the most urgent thread; phones start on the list
  useEffect(() => {
    if (!sel && data?.conversations.length && window.innerWidth > 900) {
      setSel(data.conversations.find((c) => c.escalated)?.id ?? data.conversations[0].id);
    }
  }, [sel, data?.conversations]);
  useEffect(() => {
    if (conv?.unread) a.markRead(conv.id);
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, conv?.messages.length]);

  if (!data) return <Loading />;
  const list = [...data.conversations].sort((x, y) => (y.messages.at(-1)?.at ?? "").localeCompare(x.messages.at(-1)?.at ?? ""));
  const owner = (id?: string) => data.owners.find((o) => o.id === id)?.name ?? "Owner";
  const me = owner(a.ownerId ?? undefined);
  const linked = conv?.customerId ? data.bookings.filter((b) => b.customerId === conv.customerId) : [];
  const waiting = list.filter((c) => c.escalated).length;

  async function simulate() {
    const s = SAMPLES[sim];
    setBusy(true);
    const id = a.startConversation({ channel: sim, contact: s.contact, name: s.name });
    setSel(id);
    await a.sendCustomer(id, simBody);
    setBusy(false);
  }

  function send() {
    if (!conv || !reply.trim()) return;
    a.ownerReply(conv.id, reply.trim());
    setReply("");
  }

  function turn(m: Msg) {
    if (m.from === "system") return <div key={m.id} className="sysline">{m.body}</div>;
    const words = m.from === "agent" ? toolWords(m.tools) : "";
    const who = m.from === "customer" ? conv!.name : m.from === "owner" ? owner(m.ownerId) : "Agent";
    return (
      <div key={m.id} className={cls("turn", m.from)}>
        {m.from === "agent" ? (
          <span className="avatar sm agent"><Logo size={20} /></span>
        ) : (
          <span className={cls("avatar sm", m.from === "owner" && "owner")}>{initials(who)}</span>
        )}
        <div>
          <div className="who-line"><strong>{who}</strong><span className="meta">{fmtDateTime(m.at)}</span></div>
          {words && (
            <ul className="steps">
              {words.split(", ").map((w) => (
                <li key={w} className={w === "handed over" ? "handover" : undefined}>{w === "handed over" ? <Alert /> : <Check />}{w[0].toUpperCase() + w.slice(1)}</li>
              ))}
            </ul>
          )}
          <div className="body"><Linkify text={m.body} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="admin-top">
        <div><h1>Inbox</h1></div>
        <span className="meta">{waiting ? `${waiting} waiting on an owner` : "Nothing waiting on an owner"}</span>
      </div>

      <div className={cls("inbox", conv && "has-sel")}>
        <div className="inbox-list">
          <div className="il-head"><strong>Conversations</strong><span className="meta">{list.length}</span></div>
          <ul>
            {list.map((c) => {
              const last = c.messages.at(-1);
              const st = status(c);
              return (
                <li key={c.id}>
                  <button type="button" className={cls("conv", c.unread && "unread")} onClick={() => setSel(c.id)} aria-current={sel === c.id ? "true" : undefined}>
                    <span className="avatar">{initials(c.name)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="c1"><strong>{c.name}</strong>{last && <span className="meta">{fmtDateTime(last.at)}</span>}</span>
                      <span className="c2" style={{ display: "block" }}>{last?.body}</span>
                      <span className="c3"><span className={`dot ${st.dot}`} />{st.label}<span className="sep">·</span>{CHANNEL_LABEL[c.channel]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {conv ? (
          <section className="pane" aria-label={`Conversation with ${conv.name}`}>
            <div className="pane-head">
              <div className="who">
                <button type="button" className="btn small ghost back" onClick={() => setSel(null)} aria-label="Back to conversations">←</button>
                <span className="avatar">{initials(conv.name)}</span>
                <div><strong>{conv.name}</strong><span className="meta">{CHANNEL_LABEL[conv.channel]} · {conv.contact}</span></div>
              </div>
              <div className="acts">
                <span className={`pill ${status(conv).dot === "bad" ? "bad" : status(conv).dot === "warn" ? "warn" : status(conv).dot === "good" ? "good" : ""}`}>{status(conv).label}</span>
                {conv.ownerId ? null : conv.agentActive ? (
                  <button className="btn small" onClick={() => a.setAgentActive(conv.id, false)}>Take over</button>
                ) : (
                  <button className="btn small" onClick={() => a.setAgentActive(conv.id, true)}>Hand back to agent</button>
                )}
              </div>
            </div>
            <div className="pane-body" ref={bodyRef}>
              {conv.escalated && (
                <div className="stopped" role="note">
                  <Alert />
                  <div>
                    <strong>Agent stopped and handed over</strong>
                    {conv.escalated}
                    {linked.length > 0 && <div className="refs">{linked.map((b) => <Link key={b.id} className="ref" href={`/admin/bookings/${b.id}`}>{b.ref}</Link>)}</div>}
                  </div>
                </div>
              )}
              {!conv.escalated && linked.length > 0 && (
                <div className="meta">Bookings: {linked.map((b, i) => <span key={b.id}>{i ? ", " : ""}<Link className="ref" href={`/admin/bookings/${b.id}`}>{b.ref}</Link></span>)}</div>
              )}
              {conv.messages.map(turn)}
            </div>
            {!conv.ownerId && (
              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea
                  aria-label="Reply"
                  placeholder={`Reply to ${conv.name}`}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                />
                <div className="cbar">
                  <span className="meta">Sends by {/^[\d\s+()]+$/.test(conv.contact) ? "SMS" : "email"} to {conv.contact} as {me}. Replying takes the thread off the agent.</span>
                  <button className="btn small primary" disabled={!reply.trim()}>Send <kbd>⌘↵</kbd></button>
                </div>
              </form>
            )}
          </section>
        ) : (
          <div className="pane"><div className="pane-empty">Pick a conversation.</div></div>
        )}
      </div>

      <details className="sim">
        <summary>Demo: simulate an inbound message</summary>
        <div className="row">
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="sim-channel">Channel</label>
            <select id="sim-channel" className="input" value={sim} onChange={(e) => { const v = e.target.value as Inbound; setSim(v); setSimBody(SAMPLES[v].body); }}>
              <option value="email">Email</option>
              <option value="phone">Phone (transcribed)</option>
              <option value="web">Web form</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="sim-body">From {SAMPLES[sim].contact}</label>
            <input id="sim-body" className="input" value={simBody} onChange={(e) => setSimBody(e.target.value)} />
          </div>
          <button className="btn small" disabled={busy || !simBody.trim()} onClick={simulate}>{busy ? "Agent replying…" : "Send in"}</button>
        </div>
      </details>
    </div>
  );
}
