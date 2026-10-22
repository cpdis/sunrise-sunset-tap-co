"use client";

import { useEffect, useRef, useState } from "react";
import { nextFreeDates } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { fmtDate, todayISO } from "@/lib/util";
import { Roundel } from "./Logo";
import { Linkify, useData } from "./ui";

const DEMO_PHONE_KEY = "sst-demo-phone";

function demoPhone() {
  try {
    const saved = localStorage.getItem(DEMO_PHONE_KEY);
    if (saved) return saved;
    const n = `04${Math.floor(10 + Math.random() * 89)} ${Math.floor(100 + Math.random() * 899)} ${Math.floor(100 + Math.random() * 899)}`;
    localStorage.setItem(DEMO_PHONE_KEY, n);
    return n;
  } catch {
    return "0412 000 000";
  }
}

// A phone-shaped simulator for texting the business. Messages go through the same
// agent and inbox the owners see in /admin/inbox. "Text as" switches to an owner's number,
// which gets the owner agent instead of the customer one.
export function SmsWidget({ as: initialAs = "customer" }: { as?: string }) {
  const data = useData();
  const startConversation = useApp((s) => s.startConversation);
  const sendCustomer = useApp((s) => s.sendCustomer);
  const [open, setOpen] = useState(false);
  const [customerPhone, setCustomerPhone] = useState("");
  const [as, setAs] = useState(initialAs);
  const [convId, setConvId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const fab = useRef<HTMLButtonElement>(null);

  useEffect(() => setCustomerPhone(demoPhone()), []);
  useEffect(() => setAs(initialAs), [initialAs]);
  const owner = data?.owners.find((o) => o.id === as);
  const phone = owner?.phone ?? customerPhone;
  // Focus the message box on open; Escape closes and returns focus to the button.
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        fab.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const conv = data?.conversations.find((c) => c.id === convId && c.contact === phone) ?? data?.conversations.find((c) => c.channel === "sms" && c.contact === phone);
  const msgs = conv?.messages ?? [];

  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy, open]);

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || busy || !data) return;
    setText("");
    setBusy(true);
    const id = conv?.id ?? startConversation({ channel: "sms", contact: phone, name: "New contact" });
    setConvId(id);
    try {
      await sendCustomer(id, msg);
    } finally {
      setBusy(false);
    }
  }

  const sat = data ? nextFreeDates(data, todayISO(), 1, true)[0] : undefined;
  const chips = owner
    ? ["What's on?", "I'll take the Fremantle delivery", "Log 115,900 km", "$42 CO2 refill", "Approve the payout"]
    : [
        sat ? `Is ${fmtDate(sat, { dow: true })} free?` : "Is next Saturday free?",
        "How much for 8 hours in Fremantle?",
        "How many kegs fit?",
        "Do we need an RSA?",
      ];

  return (
    <>
      {open && (
        <div className="sms-panel" role="dialog" aria-label="Chat" id="sms-panel">
          <div className="sms-head">
            <div className="stack" style={{ gap: 0 }}>
              <span className="label" style={{ fontSize: 13 }}>Sunrise Sunset</span>
              <label className="sms-as muted">
                From
                <select value={as} onChange={(e) => { setAs(e.target.value); setConvId(null); }} aria-label="Text as">
                  <option value="customer">{customerPhone} (customer)</option>
                  {data?.owners.map((o) => <option key={o.id} value={o.id}>{o.name}, owner</option>)}
                </select>
              </label>
            </div>
            <button className="chip" onClick={() => { setOpen(false); fab.current?.focus(); }}>Close</button>
          </div>
          <div className="sms-body" ref={body} aria-live="polite" aria-relevant="additions">
            {msgs.length === 0 && (
              <div className="bubble them">
                {owner
                  ? `G'day ${owner.name}. You're texting from your own number, so you get the owner agent: runs, truck log, expenses, payouts and the inbox.`
                  : "G'day! Text us like you would a mate. Ask about dates, prices or kegs, and we can book you in right here."}
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`bubble ${m.from === "customer" ? "me" : m.from === "owner" ? "owner" : m.from === "system" ? "sys" : "them"}`}>
                {m.from === "owner" && <span className="label" style={{ fontSize: 10, display: "block" }}>{data?.owners.find((o) => o.id === m.ownerId)?.name ?? "Owner"}</span>}
                <Linkify text={m.body} />
              </div>
            ))}
            {busy && <div className="typing">typing…</div>}
            {conv && !conv.agentActive && !conv.escalated && !busy && (
              <div className="bubble sys">An owner is looking at this and will reply here.</div>
            )}
          </div>
          {msgs.length < 2 && (
            <div className="chips">
              {chips.map((c) => (
                <button key={c} className="chip" onClick={() => send(c)}>{c}</button>
              ))}
            </div>
          )}
          <form className="sms-foot" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Text message" aria-label="Message" />
            <button className="btn gold small" disabled={busy || !text.trim()}>Send</button>
          </form>
          <div className="muted" style={{ fontSize: 11, padding: "0 14px 8px" }}>Demo SMS</div>
        </div>
      )}
      <button ref={fab} className="btn sms-fab" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="sms-panel">
        <Roundel size={22} />
        {open ? "Close" : "Chat"}
      </button>
    </>
  );
}
