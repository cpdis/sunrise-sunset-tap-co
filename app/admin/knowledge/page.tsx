"use client";

import { useEffect, useState } from "react";
import { Loading, Section, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { AgentResult, AgentState, Msg } from "@/lib/types";
import { cls, uid } from "@/lib/util";

// What /api/agent/preview answers: the agent's reply and what it would have done.
type Preview = Pick<AgentResult, "reply" | "tools" | "engine" | "state"> & { actions: string[]; error?: string };

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

  // Tests against the current (unsaved) draft without touching real conversations. The server answers from the
  // stored data with the draft pages in place, and applies nothing.
  async function ask() {
    if (!data || !test.trim()) return;
    const draft = data.kb.map((p) => (p.slug === slug ? { ...p, title, body } : p));
    const next: Msg[] = [...msgs, { id: uid("m"), from: "customer", body: test.trim().slice(0, 2000), at: new Date().toISOString() }];
    setMsgs(next);
    setTest("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kb: draft, state, messages: next.slice(-30).map((m) => ({ from: m.from, body: m.body.slice(0, 2000) })) }),
      });
      const r = (await res.json()) as Preview;
      if (!res.ok) throw new Error(r.error ?? `Something went wrong (${res.status}).`);
      setState(r.state);
      setMsgs([...next, { id: uid("m"), from: "agent", body: r.reply + (r.actions.length ? `\n\n[would do: ${r.actions.join(", ")}]` : ""), at: new Date().toISOString(), tools: [...r.tools, r.engine] }]);
    } catch (err) {
      setMsgs([...next, { id: uid("m"), from: "system", body: (err as Error).message, at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="admin-top">
        <h1>Agent knowledge</h1>
        <span className="note">What the agent knows. Numbers in {"{{braces}}"} come from Settings, so prices stay in one place.</span>
      </div>
      <div className="kb">
        <div className="seg kb-pages" role="group" aria-label="Knowledge pages">
          {data.kb.map((p) => <button key={p.slug} className={cls(p.slug === slug && "on")} aria-pressed={p.slug === slug} onClick={() => setSlug(p.slug)}>{p.title}</button>)}
        </div>
        <div className="grid cols-2" style={{ alignItems: "start" }}>
          <Section title="Edit page">
            <div className="card stack">
              <div className="field"><label htmlFor="kb-1">Title</label><input id="kb-1" className="input" value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} /></div>
              <div className="field"><label htmlFor="kb-2">Content</label><textarea id="kb-2" className="input" style={{ minHeight: 360 }} value={body} onChange={(e) => { setBody(e.target.value); setSaved(false); }} /></div>
              <div className="row">
                <button className="btn small primary" onClick={() => { saveKb({ slug, title, body }); setSaved(true); }}>Save</button>
                {saved && <span className="pill good">Saved. The agent uses it from the next message.</span>}
              </div>
            </div>
          </Section>
          <Section title="Test the agent against this draft">
            <div className="thread" style={{ minHeight: 240 }}>
              {msgs.length === 0 && <span className="muted">Ask something a customer would.</span>}
              {msgs.map((m) => (
                <div key={m.id} style={{ display: "contents" }}>
                  <div className={cls("bubble", m.from === "customer" ? "me" : "them")}>{m.body}</div>
                  {m.tools && <span className="tools">{m.tools.join(", ")}</span>}
                </div>
              ))}
              {busy && <span className="meta">thinking…</span>}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); ask(); }}>
              <input className="input" aria-label="Test message" style={{ flex: 1 }} value={test} onChange={(e) => setTest(e.target.value)} />
              <button className="btn small" disabled={busy}>Ask</button>
              <button type="button" className="btn small ghost" onClick={() => { setMsgs([]); setState({}); }}>Clear</button>
            </form>
            <span className="note">Test bookings aren&apos;t saved. Without an API key the rules engine answers from fixed FAQ matches, so edits show fully only once Claude is switched on.</span>
          </Section>
        </div>
      </div>
    </div>
  );
}
