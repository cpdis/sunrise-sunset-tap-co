"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CHANNEL_LABEL, Linkify, Loading, Section, toolWords, useData } from "@/components/ui";
import { owesReply, replyRoute } from "@/lib/ops";
import { useApp } from "@/lib/store";
import type { Conversation, Data, Msg } from "@/lib/types";
import { cls, fmtAgo, fmtDateTime } from "@/lib/util";

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

// The inbox is a queue. Hand-overs are cards with a drafted reply; everything else is a row that opens the thread.
export default function Inbox() {
  const data = useData();
  const a = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSel(c);
  }, []);

  if (!data) return <Loading />;
  const conv = data.conversations.find((c) => c.id === sel);
  if (conv) return <Thread conv={conv} data={data} back={() => setSel(null)} />;

  const customer = data.conversations.filter((c) => !c.ownerId).sort(byRecent);
  const needsYou = customer.filter((c) => c.escalated);
  const owners = customer.filter((c) => !c.escalated && !c.agentActive);
  const agent = customer.filter((c) => !c.escalated && c.agentActive);
  const ownerLine = data.conversations.filter((c) => c.ownerId).sort(byRecent);
  const n = (xs: Conversation[]) => (xs.length ? ` · ${xs.length}` : "");

  return (
    <div className="page">
      <div className="admin-top">
        <h1>Inbox</h1>
        <button type="button" className="btn small ghost" aria-expanded={simOpen} onClick={() => setSimOpen((v) => !v)}>
          {simOpen ? "Close simulator" : "Simulate inbound…"}
        </button>
      </div>
      {simOpen && <Simulator onSent={(id) => { setSimOpen(false); setSel(id); }} />}

      <Section title={`Needs you${n(needsYou)}`}>
        {needsYou.length === 0 ? (
          <div className="card note">Nothing is waiting on you. The agent is answering everything.</div>
        ) : (
          needsYou.map((c) => <QueueCard key={c.id} conv={c} data={data} open={() => setSel(c.id)} />)
        )}
      </Section>

      {owners.length > 0 && (
        <Section title={`Owners handling${n(owners)}`}>
          <div className="card">{owners.map((c) => <Row key={c.id} conv={c} data={data} open={() => setSel(c.id)} />)}</div>
        </Section>
      )}

      <Section title={`Agent handled${n(agent)}`}>
        {agent.length === 0 ? (
          <div className="card note">No conversations yet.</div>
        ) : (
          <div className="card">{agent.map((c) => <Row key={c.id} conv={c} data={data} open={() => setSel(c.id)} />)}</div>
        )}
      </Section>

      {ownerLine.length > 0 && (
        <Section title={`Owner line${n(ownerLine)}`}>
          <div className="card">{ownerLine.map((c) => <Row key={c.id} conv={c} data={data} open={() => setSel(c.id)} />)}</div>
        </Section>
      )}
    </div>
  );
}

function Row({ conv: c, data, open }: { conv: Conversation; data: Data; open: () => void }) {
  const last = c.messages.at(-1);
  const booking = c.customerId ? data.bookings.find((b) => b.customerId === c.customerId && b.state !== "cancelled") : undefined;
  return (
    <div className={cls("inbox-row", c.unread && "unread")}>
      <button type="button" className="rowbtn" onClick={open}>
        <div className="l1">
          <strong>{c.name}</strong>
          <span className="meta">{CHANNEL_LABEL[c.channel]} · {last ? fmtAgo(last.at) : ""}</span>
        </div>
        <div className="l2">{last?.body}</div>
        {(!c.agentActive || booking) && (
          <div className="l3">
            {!c.agentActive && <span className="pill warn">{ownerName(data, c.handledBy)} handling</span>}
            {booking && <span className="meta">{booking.ref}</span>}
          </div>
        )}
      </button>
    </div>
  );
}

// A hand-over card: what the customer asked, why the agent stopped, the draft, and the owner's three moves.
function QueueCard({ conv: c, data, open }: { conv: Conversation; data: Data; open: () => void }) {
  const a = useApp();
  const me = ownerName(data, a.ownerId ?? undefined);
  const [draft, setDraft] = useState(c.draft ?? "");
  const [confirm, setConfirm] = useState(false);
  const ask = [...c.messages].reverse().find((m) => m.from === "customer");
  const said = [...c.messages].reverse().find((m) => m.from === "agent");
  const did = toolWords(said?.tools?.filter((t) => t !== "escalate_to_owner"));
  const route = replyRoute(c);
  return (
    <div className="card queue">
      <div className="qh">
        <strong>{c.name}</strong>
        <span className="meta">
          {CHANNEL_LABEL[c.channel]} · {ask ? fmtDateTime(ask.at) : ""} · <button type="button" className="linkbtn" onClick={open}>Open thread</button>
        </span>
      </div>
      {ask && <div className="quote">{ask.body}</div>}
      <div className="note">
        <strong style={{ color: "var(--ink)" }}>Agent stopped:</strong> {c.escalated}
        {said && <> It {did ? `${did}, then ` : ""}told the customer: “{said.body}”</>}
      </div>
      <div className="field">
        <label htmlFor={`draft-${c.id}`}>Reply{c.draft ? ", drafted by the agent" : ""}</label>
        <textarea id={`draft-${c.id}`} className="input" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
      {confirm ? (
        <div className="confirm">
          <span>The customer was told an owner will reply. Hand back anyway?</span>
          <button type="button" className="btn small danger" onClick={() => a.handBack(c.id, true)}>Hand back without replying</button>
          <button type="button" className="btn small ghost" onClick={() => setConfirm(false)}>Keep</button>
        </div>
      ) : (
        <div className="acts">
          <button type="button" className="btn small primary" disabled={!draft.trim()} onClick={() => a.ownerReply(c.id, draft.trim())}>Send as {me}</button>
          <button type="button" className="btn small" onClick={() => (owesReply(c) ? setConfirm(true) : a.handBack(c.id))}>Hand back to agent</button>
          <span className="meta">Sends by {route.via === "sms" ? "SMS" : "email"} to {route.to}</span>
        </div>
      )}
    </div>
  );
}

function Thread({ conv, data, back }: { conv: Conversation; data: Data; back: () => void }) {
  const a = useApp();
  const me = ownerName(data, a.ownerId ?? undefined);
  const [reply, setReply] = useState("");
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const route = replyRoute(conv);
  const linked = conv.customerId ? data.bookings.filter((b) => b.customerId === conv.customerId) : [];

  // Opening the thread is reading it. The queue never marks anything read on its own.
  useEffect(() => {
    if (conv.unread) a.markRead(conv.id);
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id, conv.messages.length]);

  function send() {
    const body = reply.trim();
    if (!body) return;
    a.ownerReply(conv.id, body);
    setReply("");
  }
  function handBack() {
    if (owesReply(conv)) setConfirm(true);
    else a.handBack(conv.id);
  }

  return (
    <div className="page">
      <div>
        <button type="button" className="linkbtn" onClick={back}>‹ Inbox</button>
      </div>
      <div className="thread-head">
        <div>
          <h2>{conv.name}</h2>
          <div className="meta">
            {CHANNEL_LABEL[conv.channel]} · {conv.contact}
            {linked.length > 0 && <> · {linked.map((b, i) => <span key={b.id}>{i > 0 && ", "}<Link href={`/admin/bookings/${b.id}`}>{b.ref}</Link></span>)}</>}
          </div>
        </div>
        {!conv.ownerId && (
          <div className="acts">
            {conv.escalated ? <span className="pill bad">Needs you</span> : !conv.agentActive ? <span className="pill warn">{ownerName(data, conv.handledBy)} handling</span> : <span className="pill">Agent</span>}
            {conv.agentActive ? (
              <button type="button" className="btn small" onClick={() => a.setAgentActive(conv.id, false)}>Take over</button>
            ) : (
              <button type="button" className="btn small" onClick={handBack}>Hand back to agent</button>
            )}
          </div>
        )}
      </div>
      {confirm && (
        <div className="card confirm" style={{ padding: "12px 16px" }}>
          <span>The customer was told an owner will reply. Hand back anyway?</span>
          <button type="button" className="btn small danger" onClick={() => { setConfirm(false); a.handBack(conv.id, true); }}>Hand back without replying</button>
          <button type="button" className="btn small ghost" onClick={() => setConfirm(false)}>Keep</button>
        </div>
      )}

      <div className="thread" ref={ref}>
        {conv.messages.map((m) => <Message key={m.id} m={m} conv={conv} data={data} />)}
      </div>

      {!conv.ownerId && (
        <form className="compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            className="input"
            aria-label="Reply"
            rows={2}
            placeholder={conv.draft ? "" : "Reply…"}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div className="cline">
            <span className="meta">
              Sends by {route.via === "sms" ? "SMS" : "email"} to {route.to} as {me}
              {conv.agentActive && " · takes the thread off the agent"}
            </span>
            <div className="acts">
              {conv.draft && !reply && <button type="button" className="btn small ghost" onClick={() => setReply(conv.draft ?? "")}>Use the agent's draft</button>}
              <button className="btn small primary" disabled={!reply.trim()}>Send</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

// Every message gets one meta line in the same place: who, what went out where, when.
function Message({ m, conv, data }: { m: Msg; conv: Conversation; data: Data }) {
  if (m.from === "system") return <div className="bubble sys">{m.body} · {fmtDateTime(m.at)}</div>;
  const out = m.from !== "customer";
  const who =
    m.from === "customer" ? conv.name : m.from === "owner" ? ownerName(data, m.ownerId) : "Agent";
  const via = m.from === "owner" && m.via ? ` · by ${m.via === "sms" ? "SMS" : "email"} to ${m.to}` : m.from === "agent" && toolWords(m.tools) ? ` · ${toolWords(m.tools)}` : "";
  return (
    <div className={cls("msg", out ? "out" : "in")}>
      <div className={cls("bubble", m.from === "customer" ? "me" : m.from === "owner" ? "owner" : "them")}>
        <Linkify text={m.body} />
      </div>
      <span className="meta">{who}{via} · {fmtDateTime(m.at)}</span>
    </div>
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
    const id = a.startConversation({ channel: sim, contact: s.contact, name: s.name });
    await a.sendCustomer(id, body);
    setBusy(false);
    onSent(id);
  }
  return (
    <div className="card row" style={{ alignItems: "flex-end" }}>
      <div className="field" style={{ width: 160 }}>
        <label htmlFor="sim-channel">Channel</label>
        <select id="sim-channel" className="input" value={sim} onChange={(e) => { const v = e.target.value as Inbound; setSim(v); setBody(SAMPLES[v].body); }}>
          <option value="email">Email</option>
          <option value="phone">Phone (transcribed)</option>
          <option value="web">Web form</option>
          <option value="sms">SMS</option>
        </select>
      </div>
      <div className="field" style={{ flex: 1, minWidth: 240 }}>
        <label htmlFor="sim-body">From {SAMPLES[sim].contact}</label>
        <input id="sim-body" className="input" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <button type="button" className="btn small" disabled={busy || !body.trim()} onClick={go}>{busy ? "Agent replying…" : "Send in"}</button>
    </div>
  );
}
