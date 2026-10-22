"use client";

import { useState } from "react";
import { dayStatus } from "@/lib/domain";
import type { Data } from "@/lib/types";
import { addDays, addMonths, cls, todayISO, weekday } from "@/lib/util";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function DatePicker({ data, value, onChange }: { data: Data; value?: string; onChange: (d: string) => void }) {
  const today = todayISO();
  const [month, setMonth] = useState((value ?? addDays(today, 1)).slice(0, 7) + "-01");
  const lastMonth = addMonths(today, data.settings.bookAheadMonths).slice(0, 7) + "-01";
  // Monday-first grid
  const lead = (weekday(month) + 6) % 7;
  const days: (string | null)[] = Array(lead).fill(null);
  for (let d = month; d.slice(0, 7) === month.slice(0, 7); d = addDays(d, 1)) days.push(d);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between">
        <button className="btn ghost small" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= today.slice(0, 7) + "-01"}>←</button>
        <strong>{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</strong>
        <button className="btn ghost small" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= lastMonth}>→</button>
      </div>
      <div className="cal">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="dow">{d}</div>)}
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const st = dayStatus(data, d);
          const ok = st === "free" || st === "personal";
          const wd = weekday(d);
          return (
            <button
              key={d}
              className={cls("day", (st === "booked" || st === "held") && "booked", d === value && "sel", (wd === 0 || wd === 6) && "wknd")}
              disabled={!ok}
              onClick={() => onChange(d)}
              title={ok ? "Free" : st === "booked" || st === "held" ? "Booked" : st === "blackout" ? "Unavailable" : ""}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="row muted" style={{ fontSize: 13, gap: 16 }}>
        <span><span style={{ display: "inline-block", width: 12, height: 12, border: "1.5px solid #e3c06c", borderRadius: 3, marginRight: 6 }} />Weekend</span>
        <span><span style={{ display: "inline-block", width: 12, height: 12, background: "var(--bone-2)", borderRadius: 3, marginRight: 6 }} />Booked</span>
      </div>
    </div>
  );
}
