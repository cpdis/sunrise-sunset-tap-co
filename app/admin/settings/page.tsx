"use client";

import { useEffect, useState } from "react";
import { Loading, Section, useData } from "@/components/ui";
import { useApp } from "@/lib/store";
import { SETTING_GROUPS as GROUPS, settingProblem } from "@/lib/config";
import { SCENARIOS } from "@/lib/seed";
import type { Scenario, Settings } from "@/lib/types";
import { cls } from "@/lib/util";

export default function SettingsPage() {
  const data = useData();
  const update = useApp((s) => s.updateSettings);
  const reset = useApp((s) => s.reset);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [engine, setEngine] = useState("");

  // fractions (unit "0–1", the tax rate) are edited as percentages and saved back as fractions
  const pctKeys = new Set(GROUPS.flatMap((g) => g.fields).filter((f) => f.unit === "0–1").map((f) => f.k as string));
  const toForm = (s: Settings) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, pctKeys.has(k) ? String(Math.round(Number(v) * 10000) / 100) : String(v)]));
  useEffect(() => {
    if (data) setForm(toForm(data.settings));
  }, [data?.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetch("/api/agent/preview").then((r) => r.json()).then((j) => setEngine(j.engine)).catch(() => {}); }, []);

  if (!data) return <Loading />;
  const saved0 = toForm(data.settings);
  const dirty = GROUPS.some((g) => g.fields.some((f) => (form[f.k] ?? "") !== (saved0[f.k] ?? "")));
  // The form value in stored units (percentages back to fractions), checked against SETTING_RANGES.
  const stored = (k: keyof Settings) => {
    const raw = (form[k] ?? "").trim();
    const n = raw === "" ? NaN : Number(raw);
    return pctKeys.has(k) ? n / 100 : n;
  };
  const errors = Object.fromEntries(
    GROUPS.flatMap((g) => g.fields).flatMap((f) => {
      const why = settingProblem(f.k, stored(f.k));
      // The tax rate is typed as a percentage, so its range is shown that way too.
      return why ? [[f.k, pctKeys.has(f.k) ? why.replace(/(\d+(?:\.\d+)?)/g, (x) => `${Math.round(Number(x) * 10000) / 100}%`) : why]] : [];
    }),
  ) as Partial<Record<keyof Settings, string>>;
  const invalid = Object.keys(errors).length > 0;

  function save() {
    if (invalid) return;
    const next: Partial<Settings> = {};
    for (const g of GROUPS) for (const f of g.fields) next[f.k] = stored(f.k);
    update(next);
    setSaved(true);
  }

  const integrations = [
    { name: "Payments", now: "Simulated Stripe Checkout and webhooks", prod: "Stripe (one standard account, saved cards, off-session charges)" },
    { name: "Owner payouts", now: "Mock bank API", prod: "Business bank account with a payments API (e.g. Airwallex)" },
    { name: "Agent", now: engine === "claude" ? "Claude (ANTHROPIC_API_KEY is set)" : "Rules engine (no API key)", prod: "Claude with tool use, same tools" },
    { name: "SMS and phone", now: "On-site simulator", prod: "Twilio number, voice transcription" },
    { name: "Email", now: "Simulated in the inbox", prod: "Resend inbound and outbound" },
    { name: "Data and login", now: "Demo database (PGlite) and simulated sign-in emails", prod: "Hosted Postgres and emailed sign-in links" },
  ];

  return (
    <div className="page">
      <div className="admin-top">
        <h1>Settings</h1>
        {saved && !dirty && <span className="pill good">Saved</span>}
      </div>
      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          <div className="card grid cols-3">
            {g.fields.map((f) => (
              <div key={f.k} className="field">
                <label htmlFor={`set-${f.k}`}>{f.label}</label>
                <span className="adorn">
                  {f.unit === "$" && <i>$</i>}
                  <input
                    id={`set-${f.k}`}
                    className="input"
                    inputMode="decimal"
                    value={form[f.k] ?? ""}
                    aria-invalid={!!errors[f.k]}
                    aria-describedby={errors[f.k] ? `set-${f.k}-error` : undefined}
                    onChange={(e) => { setForm({ ...form, [f.k]: e.target.value }); setSaved(false); }}
                  />
                  {f.unit && f.unit !== "$" && <i>{f.unit === "0–1" ? "%" : f.unit}</i>}
                </span>
                {errors[f.k] && <span id={`set-${f.k}-error`} className="field-error">{errors[f.k]}</span>}
              </div>
            ))}
          </div>
        </Section>
      ))}
      <Section title="Integrations">
        <div className="table-wrap">
          <table className="t cards">
            <thead><tr><th>Service</th><th>In this demo</th><th>In production</th></tr></thead>
            <tbody>{integrations.map((i) => <tr key={i.name}><td><strong>{i.name}</strong></td><td data-label="In this demo">{i.now}</td><td className="muted" data-label="In production">{i.prod}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Demo scenario">
        <div className="card stack" style={{ gap: 12 }}>
          <span className="note">
            Every figure in the admin is illustrative. Base is the one to plan on; bear has fewer hires, a fridge repair and two late cancellations; bull is the optimistic year. Switching regenerates the demo data.
          </span>
          <div className="seg" role="group" aria-label="Demo scenario">
            {(Object.keys(SCENARIOS) as Scenario[]).map((k) => (
              <button key={k} className={cls(data.scenario === k && "on")} aria-pressed={data.scenario === k} onClick={() => { if (data.scenario !== k && confirm(`Switch to the ${SCENARIOS[k].label.toLowerCase()} case? This regenerates the demo data for everyone using it.`)) reset(k); }}>
                {SCENARIOS[k].label}
              </button>
            ))}
          </div>
        </div>
      </Section>
      {dirty && (
        <div className="save-bar" role="region" aria-label="Unsaved changes">
          <span>{invalid ? "Fix the highlighted settings to save." : "You have unsaved changes."}</span>
          <div className="row">
            <button className="btn small" onClick={() => setForm(saved0)}>Discard</button>
            <button className="btn small primary" onClick={save} disabled={invalid}>Save changes</button>
          </div>
        </div>
      )}
      <Section title="Demo data">
        <div className="card stack" style={{ gap: 12 }}>
          <span className="note">Regenerates a fresh simulated year of trading and wipes every change made in the demo, for everyone using it.</span>
          <button className="btn small danger" style={{ alignSelf: "flex-start" }} onClick={() => { if (confirm("Reset all demo data?")) reset(); }}>Reset demo data</button>
        </div>
      </Section>
    </div>
  );
}
