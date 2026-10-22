"use client";

import { useEffect, useState } from "react";
import { Loading, useData } from "@/components/ui";
import { snapshot, useApp } from "@/lib/store";
import type { AgentResult, AgentState, Msg } from "@/lib/types";
import { cls, uid } from "@/lib/util";

export default function Knowledge() {
  const data = useData();
  const saveKb = useApp((s) => s.saveKb);
  const [slug, setSlug] = useState("pricing");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState("How many kegs fit in the truck?");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<AgentState>({});
  const [busy, setBusy] = useState(false);
  const page = data?.kb.find((p) => p.slug === slug);

  useEffect(() => {
    if (page) { setBody(page.body); setTitle(page.title); setSaved(false); }
  }, [page?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Loading />;

  // Tests against the current (unsaved) draft without touching real conversations.
  async function ask() {
    if (!data || !test.trim()) return;
    const draft = data.kb.map((p) => (p.slug === slug ? { ...p, title, body } : p));
    const next: Msg[] = [...msgs, { id: uid("m"), from: "customer", body: test.trim(), at: new Date().toISOString() }];
    setMsgs(next);
    setTest("");
    setBusy(true);
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot: { ...snapshot(data), kb: draft }, conversation: { channel: "sms", contact: "test", name: "Test", state, messages: next } }),
    });
    const r = (await res.json()) as AgentResult;
    setState(r.state);
    setMsgs([...next, { id: uid("m"), from: "agent", body: r.reply + (r.actions.length ? `\n\n[would do: ${r.actions.map((a) => a.type).join(", ")}]` : ""), at: new Date().toISOString(), tools: [...r.tools, r.engine] }]);
    setBusy(false);
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="admin-top">
        <h1>Agent knowledge</h1>
        <span className="muted" style={{ fontSize: 14 }}>What the agent knows. Numbers in {"{{braces}}"} come from Settings, so prices stay in one place.</span>
      </div>
      <div className="seg">
        {data.kb.map((p) => <button key={p.slug} className={cls(p.slug === slug && "on")} onClick={() => setSlug(p.slug)}>{p.title}</button>)}
      </div>
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="field"><label>Title</label><input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} /></div>
          <div className="field"><label>Content</label><textarea className="input" style={{ minHeight: 360 }} value={body} onChange={(e) => { setBody(e.target.value); setSaved(false); }} /></div>
          <div className="row">
            <button className="btn small" onClick={() => { saveKb({ slug, title, body }); setSaved(true); }}>Save</button>
            {saved && <span className="pill good">Saved. The agent uses it from the next message.</span>}
          </div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow muted">Test the agent against this draft</span>
          <div className="thread" style={{ minHeight: 240 }}>
            {msgs.length === 0 && <span className="muted">Ask something a customer would.</span>}
            {msgs.map((m) => (
              <div key={m.id} style={{ display: "contents" }}>
                <div className={cls("bubble", m.from === "customer" ? "me" : "them")}>{m.body}</div>
                {m.tools && <span className="tools">{m.tools.join(", ")}</span>}
              </div>
            ))}
            {busy && <span className="muted mono" style={{ fontSize: 12 }}>thinking…</span>}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <input className="input" style={{ flex: 1 }} value={test} onChange={(e) => setTest(e.target.value)} />
            <button className="btn small" disabled={busy}>Ask</button>
            <button type="button" className="btn small ghost" onClick={() => { setMsgs([]); setState({}); }}>Clear</button>
          </form>
          <span className="muted" style={{ fontSize: 13 }}>Test bookings aren&apos;t saved. Without an API key the rules engine answers from fixed FAQ matches, so edits show fully only once Claude is switched on.</span>
        </div>
      </div>
    </div>
  );
}
