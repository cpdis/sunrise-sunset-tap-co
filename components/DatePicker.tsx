"use client";

import { useEffect, useState } from "react";
import { type Avail, dayStatus, type DayStatus } from "@/lib/domain";
import { addDays, addMonths, cls, fmtDate, todayISO, weekday } from "@/lib/util";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function statusText(st: DayStatus, notice: number) {
  if (st === "free" || st === "personal") return "free";
  if (st === "booked" || st === "held") return "booked";
  if (st === "short_notice") return `less than ${notice} days away, text us`;
  if (st === "blackout") return "unavailable";
  if (st === "too_far") return "too far ahead";
  return "past";
}

export function DatePicker({ data, value, onChange }: { data: Avail; value?: string; onChange: (d: string) => void }) {
  const today = todayISO();
  const [month, setMonth] = useState((value ?? addDays(today, 1)).slice(0, 7) + "-01");
  // A date can arrive after mount (from the query string), so follow it to its month.
  useEffect(() => {
    if (value) setMonth(value.slice(0, 7) + "-01");
  }, [value]);
  const lastMonth = addMonths(today, data.settings.bookAheadMonths).slice(0, 7) + "-01";
  // Monday-first grid
  const lead = (weekday(month) + 6) % 7;
  const days: (string | null)[] = Array(lead).fill(null);
  for (let d = month; d.slice(0, 7) === month.slice(0, 7); d = addDays(d, 1)) days.push(d);
  const label = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between">
        <button className="btn ghost small" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= today.slice(0, 7) + "-01"}>←</button>
        <strong className="display" style={{ fontSize: 30 }} aria-live="polite">{label}</strong>
        <button className="btn ghost small" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= lastMonth}>→</button>
      </div>
      <div className="cal" role="group" aria-label={`Dates in ${label}`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="dow" aria-hidden="true">{d}</div>)}
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const st = dayStatus(data, d);
          const ok = st === "free" || st === "personal";
          const wd = weekday(d);
          const text = statusText(st, data.settings.minNoticeDays);
          return (
            <button
              key={d}
              className={cls("day", (st === "booked" || st === "held") && "booked", d === value && "sel", (wd === 0 || wd === 6) && "wknd")}
              disabled={!ok}
              aria-pressed={d === value}
              aria-label={`${fmtDate(d, { dow: true, year: true })}, ${text}`}
              onClick={() => onChange(d)}
              title={text[0].toUpperCase() + text.slice(1)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="row muted" style={{ fontSize: 13, gap: 16 }}>
        <span><span style={{ display: "inline-block", width: 12, height: 12, borderBottom: "4px solid var(--gold)", background: "var(--white)", marginRight: 6 }} />Weekend</span>
        <span><span style={{ display: "inline-block", width: 12, height: 12, background: "var(--sand)", border: "1px solid var(--rule)", marginRight: 6 }} />Booked</span>
        <span>Within {data.settings.minNoticeDays} days? Text us.</span>
      </div>
    </div>
  );
}
