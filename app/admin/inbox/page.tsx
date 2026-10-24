"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { CHANNEL_LABEL, Linkify, Loading, toolWords, useData } from "@/components/ui";
import { owesReply, replyRoute } from "@/lib/ops";
import { useApp } from "@/lib/store";
import type { Conversation, Data, Msg } from "@/lib/types";
import { cls, fmtDateTime } from "@/lib/util";

type Inbound = Conversation["channel"];

const SAMPLES: Record<Inbound, { contact: string; name: string; body: string }> = {
  email: { contact: "mia.kelly@example.com", name: "Mia Kelly", body: "Hi! Is the truck free the second Saturday in December for 8 hours in Cottesloe? It's for our engagement party." },
  phone: { contact: "0421 778 300", name: "Caller · 0421 778 300", body: "Hi, how much is it for four hours in Mandurah?" },
  web: { contact: "tom.hughes@example.com", name: "Tom Hughes", body: "Can I get a discount for a school fete?" },
  sms: { contact: "0499 120 554", name: "New contact", body: "how many kegs can it fit" },
};

const lastAt = (c: Conversation) => c.messages.at(-1)?.at ?? "";
const byRecent = (x: Conversation, y: Conversation) => lastAt(y).localeCompare(lastAt(x));
const ownerName = (d: Data, id?: string) => d.owners.find((o) => o.id === id)?.name ?? "An owner";

// "Harbour Collective (events)" -> "HC"; a phone-number caller gets a hash.
function initials(name: string) {
  const w = name.replace(/\(.*?\)/g, "").split(/[\s·]+/).filter((x) => /^[A-Za-z]/.test(x));
  return w.length ? (w[0][0] + (w[1]?.[0] ?? "")).toUpperCase() : "#";
}

// One state per conversation, worst first. The list groups by it, the thread header shows it once.
function status(c: Conversation): { dot: string; pill: string; label: string } {
  if (c.escalated) return { dot: "bad", pill: "bad", label: "Needs you" };
  if (!c.agentActive) return { dot: "warn", pill: "warn", label: "Owner handling" };
  if (c.ownerId) return { dot: "info", pill: "", label: "Owner line" };
  return { dot: "good", pill: "good", label: "Agent" };
}

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Alert = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.3v3.4M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);

// The inbox is a queue in a console: conversations grouped by who owes the next move, the open thread beside them.
export default function Inbox() {
  const data = useData();
  const a = useApp();
  const [sel, setSel] = useState<string | null>(null);

  // Choosing a thread is reading it. The wide-screen default below only shows one; it never marks it read.
  function open(id: string | null) {
    setSel(id);
    const c = data?.conversations.find((x) => x.id === id);
    if (c?.unread) a.markRead(c.id);
  }

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSel(c);
  }, []);
  useEffect(() => {
    if (!sel && data?.conversations.length && window.innerWidth > 700) {
      setSel([...data.conversations].sort(byRecent).find((c) => c.escalated)?.id ?? [...data.conversations].sort(byRecent)[0].id);
    }
  }, [sel, data?.conversations]);

  if (!data) return <Loading />;
  const conv = data.conversations.find((c) => c.id === sel);
  const customer = data.conversations.filter((c) => !c.ownerId).sort(byRecent);
  const groups: [string, Conversation[]][] = [
    ["Needs you", customer.filter((c) => c.escalated)],
    ["Owners handling", customer.filter((c) => !c.escalated && !c.agentActive)],
    ["Agent handled", customer.filter((c) => !c.escalated && c.agentActive)],
    ["Owner line", data.conversations.filter((c) => c.ownerId).sort(byRecent)],
  ];
  const waiting = groups[0][1].length;

  return (
    <div className="page">
      <div className="admin-top">
        <div><h1>Inbox</h1></div>
        <span className="meta">{waiting ? `${waiting} waiting on an owner` : "Nothing waiting on an owner"}</span>
      </div>

      <div className={cls("inbox", conv && "has-sel")}>
        <div className="inbox-list">
          <div className="il-head"><strong>Conversations</strong><span className="meta">{data.conversations.length}</span></div>
          <div className="il-body">
            {groups.map(([title, xs]) => (title === "Needs you" || xs.length > 0) && (
              <div key={title} className="il-group">
                <div className="il-title">{title}<span>{xs.length}</span></div>
                {xs.length === 0 ? (
                  <p className="il-empty">Nothing is waiting on you.</p>
                ) : (
                  <ul>
                    {xs.map((c) => {
                      const last = c.messages.at(-1);
                      return (
                        <li key={c.id}>
                          <button type="button" className={cls("conv", c.unread && "unread")} onClick={() => open(c.id)} aria-current={sel === c.id ? "true" : undefined}>
                            <span className="avatar">{initials(c.name)}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="c1"><strong>{c.name}</strong>{last && <span className="meta">{fmtDateTime(last.at)}</span>}</span>
                              <span className="c2" style={{ display: "block" }}>{last?.body}</span>
                              <span className="c3">
                                <span className={`dot ${status(c).dot}`} />
                                {c.escalated || c.agentActive ? CHANNEL_LABEL[c.channel] : `${ownerName(data, c.handledBy)} · ${CHANNEL_LABEL[c.channel]}`}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>

        {conv ? <Thread key={conv.id} conv={conv} data={data} back={() => setSel(null)} /> : <div className="pane"><div className="pane-empty">Pick a conversation.</div></div>}
      </div>

      <Simulator onSent={open} />
    </div>
  );
}

function Thread({ conv, data, back }: { conv: Conversation; data: Data; back: () => void }) {
  const a = useApp();
  const me = ownerName(data, a.ownerId ?? undefined);
  // A hand-over opens with the agent's draft in the composer. Edits are saved on the conversation on blur.
  const [reply, setReply] = useState(conv.draft ?? "");
  const [confirm, setConfirm] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const route = replyRoute(conv);
  const st = status(conv);
  const linked = conv.customerId ? data.bookings.filter((b) => b.customerId === conv.customerId) : [];
  // The last agent turn that handed over carries the reason, once, as that step's result.
  const handover = conv.escalated ? [...conv.messages].reverse().find((m) => m.from === "agent" && m.tools?.includes("escalate_to_owner"))?.id : undefined;

  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [conv.messages.length]);

  function send() {
    const text = reply.trim();
    if (!text) return;
    a.ownerReply(conv.id, text);
    setReply("");
  }
  function handBack() {
    if (owesReply(conv)) setConfirm(true);
    else a.handBack(conv.id);
  }
  const action = conv.ownerId ? null : conv.agentActive ? (
    <button type="button" className="btn small" onClick={() => a.setAgentActive(conv.id, false)}>Take over</button>
  ) : (
    <button type="button" className="btn small" onClick={handBack}>Hand back to agent</button>
  );

  function turn(m: Msg) {
    // the hand-over's own system line repeats the reason the "Handed over" step already shows
    if (m.from === "system") return handover && conv.escalated && m.body.includes(conv.escalated) ? null : <div key={m.id} className="sysline">{m.body}</div>;
    const steps = m.from === "agent" ? (m.tools ?? []).map((t) => [t, toolWords([t])]).filter(([, w]) => w) : [];
    const who = m.from === "customer" ? conv.name : m.from === "owner" ? ownerName(data, m.ownerId) : "Agent";
    const via = m.from === "owner" && m.via ? `by ${m.via === "sms" ? "SMS" : "email"} to ${m.to}` : "";
    return (
      <div key={m.id} className={cls("turn", m.from)}>
        {m.from === "agent" ? <span className="avatar sm agent"><Logo size={20} /></span> : <span className={cls("avatar sm", m.from === "owner" && "owner")}>{initials(who)}</span>}
        <div>
          <div className="who-line"><strong>{who}</strong><span className="meta">{fmtDateTime(m.at)}</span></div>
          {steps.length > 0 && (
            <ul className="steps">
              {steps.map(([t, w]) => t === "escalate_to_owner" ? (
                <li key={t} className="handover">
                  <Alert />
                  <span>
                    Handed over
                    {m.id === handover && (
                      <span className="result">
                        {conv.escalated}
                        {linked.map((b) => <Link key={b.id} className="ref" href={`/admin/bookings/${b.id}`}>{b.ref}</Link>)}
                      </span>
                    )}
                  </span>
                </li>
              ) : (
                <li key={t}><Check />{w[0].toUpperCase() + w.slice(1)}</li>
              ))}
            </ul>
          )}
          {/* Customer text shows as written: a link a customer sends is never clickable here. Agent and owner links are. */}
          <div className="body">{m.from === "customer" ? m.body : <Linkify text={m.body} />}</div>
          {via && <div className="via">{via}</div>}
        </div>
      </div>
    );
  }

  return (
    <section className="pane" aria-label={`Conversation with ${conv.name}`}>
      <div className="pane-head">
        <div className="who">
          <button type="button" className="btn small back" onClick={back} aria-label="Back to conversations">←</button>
          <span className="avatar">{initials(conv.name)}</span>
          <div>
            <strong>{conv.name}</strong>
            <span className="meta">
              {CHANNEL_LABEL[conv.channel]}
              {!handover && linked.length > 0 && <> · {linked.map((b, i) => <span key={b.id}>{i ? ", " : ""}<Link className="ref" href={`/admin/bookings/${b.id}`}>{b.ref}</Link></span>)}</>}
            </span>
          </div>
        </div>
        <div className="acts">
          <span className={cls("pill", st.pill)}>{conv.escalated || conv.agentActive ? st.label : `${ownerName(data, conv.handledBy)} handling`}</span>
          <span className="wide-only">{action}</span>
        </div>
      </div>
      <div className="pane-body" ref={body}>{conv.messages.map(turn)}</div>
      {confirm && (
        <div className="confirm" role="alert">
          <span>{conv.name} was told an owner will reply. Hand back anyway?</span>
          <span className="acts">
            <button type="button" className="btn small" onClick={() => setConfirm(false)}>Keep</button>
            <button type="button" className="btn small danger" onClick={() => { setConfirm(false); a.handBack(conv.id, true); }}>Hand back without replying</button>
          </span>
        </div>
      )}
      {conv.ownerId ? null : (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          {conv.agentActive && <div className="cwarn">Sending takes this conversation off the agent.</div>}
          <textarea
            aria-label={conv.draft && reply === conv.draft ? "Reply, drafted by the agent" : "Reply"}
            placeholder={`Reply to ${conv.name}`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onBlur={() => { if (conv.escalated && reply !== (conv.draft ?? "")) a.setDraft(conv.id, reply); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          />
          <div className="cbar">
            <span className="chip" title={`Sends by ${route.via === "sms" ? "SMS" : "email"} as ${me}`}>{route.via === "sms" ? "SMS" : "Email"} · {route.to}</span>
            <span className="acts">
              <span className="narrow-only">{action}</span>
              {conv.draft && reply !== conv.draft && <button type="button" className="btn small" onClick={() => setReply(conv.draft ?? "")}>Use draft</button>}
              <button className="btn small primary" disabled={!reply.trim()}>Send <kbd>⌘↵</kbd></button>
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

function Simulator({ onSent }: { onSent: (id: string) => void }) {
  const a = useApp();
  const [sim, setSim] = useState<Inbound>("email");
  const [body, setBody] = useState(SAMPLES.email.body);
  const [busy, setBusy] = useState(false);
  async function go() {
    const s = SAMPLES[sim];
    setBusy(true);
    const id = await a.sendCustomer({ channel: sim, contact: s.contact, name: s.name }, body);
    setBusy(false);
    if (id) onSent(id);
  }
  return (
    <details className="sim">
      <summary>Demo: simulate an inbound message</summary>
      <div className="row">
        <div className="field" style={{ width: 160 }}>
          <label htmlFor="sim-channel">Channel</label>
          <select id="sim-channel" className="input" value={sim} onChange={(e) => { const v = e.target.value as Inbound; setSim(v); setBody(SAMPLES[v].body); }}>
            <option value="email">Email</option>
            <option value="phone">Phone (transcribed)</option>
            <option value="web">Web form</option>
            <option value="sms">SMS</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="sim-body">From {SAMPLES[sim].contact}</label>
          <input id="sim-body" className="input" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <button type="button" className="btn small" disabled={busy || !body.trim()} onClick={go}>{busy ? "Agent replying…" : "Send in"}</button>
      </div>
    </details>
  );
}
