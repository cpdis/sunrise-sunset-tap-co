"use client";

import { fmtDate } from "@/lib/util";

// An admin date input that always reads "23 Oct 2026", whatever the browser's locale.
// The native picker sits invisible over the formatted text, so a click or tap still opens it
// and the label still points at a real date input.
export function DateField({ id, value, onChange }: { id: string; value: string; onChange: (d: string) => void }) {
  return (
    <span className="input date-field">
      <span aria-hidden="true">{value ? fmtDate(value, { year: true }) : "Pick a date"}</span>
      <input id={id} type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} onClick={(e) => e.currentTarget.showPicker?.()} />
    </span>
  );
}
