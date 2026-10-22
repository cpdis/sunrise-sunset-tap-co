"use client";

import { useState } from "react";
import { Loading, Section, Stat, useData } from "@/components/ui";
import type { TruckLog } from "@/lib/types";
import { useApp } from "@/lib/store";
import { addDays, fmtDate, todayISO } from "@/lib/util";

const TYPES: TruckLog["type"][] = ["service", "clean", "odometer", "incident", "purchase"];
const TYPE_LABEL: Record<TruckLog["type"], string> = { service: "Service", clean: "Line clean", odometer: "Odometer", incident: "Incident", purchase: "Purchase" };

export default function Truck() {
  const data = useData();
  const addLog = useApp((s) => s.addTruckLog);
  const [f, setF] = useState({ date: todayISO(), type: "clean" as TruckLog["type"], notes: "", odometer: "" });
  if (!data) return <Loading />;
  const logs = [...data.truck].sort((a, b) => b.date.localeCompare(a.date));
  const odo = logs.find((l) => l.odometer)?.odometer ?? 0;
  const lastService = logs.find((l) => l.type === "service");
  const sinceService = lastService?.odometer ? odo - lastService.odometer : 0;
  const yearKm = data.bookings.filter((b) => b.state === "completed" && b.date >= addDays(todayISO(), -365)).reduce((s, b) => s + b.km * 4, 0);

  return (
    <div className="page">
      <div className="admin-top"><h1>Truck</h1></div>
      <div className="grid cols-4">
        <Stat k="Odometer (last logged)" v={`${odo.toLocaleString()} km`} />
        <Stat k="Since last service" v={`${sinceService.toLocaleString()} km`} />
        <Stat k="Driven for hires, last 12 months" v={`${yearKm.toLocaleString()} km`} />
        <Stat k="Next service" v={sinceService > 4000 ? "Due now" : `${(5000 - sinceService).toLocaleString()} km`} />
      </div>
      <Section title="Log something">
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (!f.notes) return; addLog({ date: f.date, type: f.type, notes: f.notes, odometer: Number(f.odometer) || undefined }); setF({ ...f, notes: "", odometer: "" }); }}>
          <div className="grid cols-4">
            <div className="field"><label htmlFor="tl-1">Date</label><input id="tl-1" type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="tl-2">Type</label><select id="tl-2" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as TruckLog["type"] })}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></div>
            <div className="field"><label htmlFor="tl-3">Odometer</label><input id="tl-3" className="input" inputMode="numeric" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} /></div>
            <div className="field"><label htmlFor="tl-4">Notes</label><input id="tl-4" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          </div>
          <button className="btn small primary" style={{ alignSelf: "flex-start" }}>Add to log</button>
        </form>
      </Section>
      <Section title="History">
        <div className="table-wrap">
          <table className="t cards">
            <thead><tr><th>Date</th><th>Type</th><th>Notes</th><th className="num">Odometer</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(l.date, { year: true })}</td>
                  <td data-label="Type"><span className={`pill ${l.type === "incident" ? "bad" : l.type === "service" ? "good" : ""}`}>{TYPE_LABEL[l.type]}</span></td>
                  <td data-label="Notes">{l.notes}</td>
                  <td className="num" data-label="Odometer">{l.odometer?.toLocaleString() ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
