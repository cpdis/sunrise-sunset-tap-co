"use client";

import { useEffect, useState } from "react";
import { Loading, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import { SCENARIOS } from "@/lib/seed";
import type { Scenario, Settings } from "@/lib/types";
import { cls } from "@/lib/util";

const GROUPS: { title: string; fields: { k: keyof Settings; label: string; unit?: string }[] }[] = [
  {
    title: "Prices",
    fields: [
      { k: "price4", label: "4-hour block", unit: "$" },
      { k: "price8", label: "8-hour block", unit: "$" },
      { k: "deposit", label: "Deposit", unit: "$" },
      { k: "bond", label: "Bond", unit: "$" },
      { k: "travelFee", label: "Travel fee", unit: "$" },
      { k: "travelThresholdMin", label: "Travel fee applies beyond", unit: "min" },
    ],
  },
  {
    title: "Booking rules",
    fields: [
      { k: "bookAheadMonths", label: "Book ahead up to", unit: "months" },
      { k: "holdMinutes", label: "Unpaid holds expire after", unit: "min" },
      { k: "minNoticeDays", label: "Online bookings need at least", unit: "days notice" },
      { k: "balanceDaysBefore", label: "Charge balance", unit: "days before" },
      { k: "bondHoldDaysBefore", label: "Hold bond", unit: "days before" },
      { k: "cancelDays", label: "Full refund if cancelled more than", unit: "days out" },
      { k: "refundLimit", label: "Agent can refund up to", unit: "$" },
    ],
  },
  {
    title: "Owners and payouts",
    fields: [
      { k: "runnerFee", label: "Runner fee per delivery or pickup", unit: "$" },
      { k: "approvalsRequired", label: "Approvals to pay a distribution", unit: "owners" },
      { k: "taxRate", label: "Tax provision", unit: "0–1" },
      { k: "reserveMonths", label: "Reserve: fixed costs", unit: "months" },
      { k: "fixedMonthly", label: "Fixed costs per month", unit: "$" },
      { k: "maintPerKm", label: "Maintenance reserve", unit: "$/km" },
    ],
  },
];

export default function SettingsPage() {
  const data = useData();
  const update = useApp((s) => s.updateSettings);
  const reset = useApp((s) => s.reset);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [engine, setEngine] = useState("");

  useEffect(() => {
    if (data) setForm(Object.fromEntries(Object.entries(data.settings).map(([k, v]) => [k, String(v)])));
  }, [data?.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetch("/api/agent").then((r) => r.json()).then((j) => setEngine(j.engine)).catch(() => {}); }, []);

  if (!data) return <Loading />;

  function save() {
    const next: Partial<Settings> = {};
    for (const g of GROUPS) for (const f of g.fields) {
      const n = Number(form[f.k]);
      if (Number.isFinite(n)) next[f.k] = n;
    }
    update(next);
    setSaved(true);
  }

  const integrations = [
    { name: "Payments", now: "Simulated Stripe Checkout and webhooks", prod: "Stripe (one standard account, saved cards, off-session charges)" },
    { name: "Owner payouts", now: "Mock bank API", prod: "Business bank account with a payments API (e.g. Airwallex)" },
    { name: "Agent", now: engine === "claude" ? "Claude (ANTHROPIC_API_KEY is set)" : "Rules engine (no API key)", prod: "Claude with tool use, same tools" },
    { name: "SMS and phone", now: "On-site simulator", prod: "Twilio number, voice transcription" },
    { name: "Email", now: "Simulated in the inbox", prod: "Resend inbound and outbound" },
    { name: "Data and login", now: "Your browser (localStorage)", prod: "Supabase Postgres and email sign-in" },
  ];

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="admin-top">
        <h1>Settings</h1>
        <div className="row">
          {saved && <span className="pill good">Saved</span>}
          <button className="btn primary" onClick={save}>Save changes</button>
        </div>
      </div>
      {GROUPS.map((g) => (
        <div key={g.title} className="card stack">
          <strong>{g.title}</strong>
          <div className="grid cols-3">
            {g.fields.map((f) => (
              <div key={f.k} className="field">
                <label htmlFor={`set-${f.k}`}>{f.label} <span className="muted mono" style={{ fontSize: 11 }}>{f.unit}</span></label>
                <input id={`set-${f.k}`} className="input" inputMode="decimal" value={form[f.k] ?? ""} onChange={(e) => { setForm({ ...form, [f.k]: e.target.value }); setSaved(false); }} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="stack" style={{ gap: 10 }}>
        <span className="eyebrow muted">Integrations</span>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Service</th><th>In this demo</th><th>In production</th></tr></thead>
            <tbody>{integrations.map((i) => <tr key={i.name}><td><strong>{i.name}</strong></td><td>{i.now}</td><td className="muted">{i.prod}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <strong>Demo scenario</strong>
        <span className="muted" style={{ fontSize: 14 }}>
          Every figure in the admin is illustrative. Base is the one to plan on; bear has fewer hires, a fridge repair and two late cancellations; bull is the optimistic year. Switching regenerates the demo data.
        </span>
        <div className="seg" role="group" aria-label="Demo scenario">
          {(Object.keys(SCENARIOS) as Scenario[]).map((k) => (
            <button key={k} className={cls(data.scenario === k && "on")} aria-pressed={data.scenario === k} onClick={() => { if (data.scenario !== k && confirm(`Switch to the ${SCENARIOS[k].label.toLowerCase()} case? This regenerates the demo data.`)) { reset(k); useApp.getState().ensure(); } }}>
              {SCENARIOS[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <strong>Demo data</strong>
        <span className="muted" style={{ fontSize: 14 }}>Regenerates a fresh simulated year of trading and wipes anything you&apos;ve done in this browser.</span>
        <button className="btn small danger" style={{ alignSelf: "flex-start" }} onClick={() => { if (confirm("Reset all demo data?")) { reset(); useApp.getState().ensure(); } }}>Reset demo data</button>
      </div>
    </div>
  );
}
