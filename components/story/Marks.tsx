"use client";

// Marks in the running text. Term lights up part of a diagram while you point at it.
// Note writes an aside in the margin on wide screens, and opens it on tap below that.
import { useEffect, useRef, useState } from "react";
import { pointAt } from "./Sketch";

export function Term({ sketch, nodes = "", edges = "", children }: { sketch: string; nodes?: string; edges?: string; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  const hot = { nodes: nodes.split(",").filter(Boolean), edges: edges.split(",").filter(Boolean) };
  const set = (v: boolean) => {
    setOn(v);
    pointAt(sketch, v ? hot : null);
  };
  return (
    <span
      className={`term${on ? " on" : ""}`}
      tabIndex={0}
      role="button"
      aria-pressed={on}
      onMouseEnter={() => set(true)}
      onMouseLeave={() => set(false)}
      onFocus={() => set(true)}
      onBlur={() => set(false)}
      onClick={() => set(!on)}
    >
      {children}
    </span>
  );
}

type Ink = "azure" | "gold" | "green";

export function Note({ note, ink = "azure", side = "right", children }: { note: string; ink?: Ink; side?: "left" | "right"; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className={`ann ink-${ink} ${side}${open ? " open" : ""}`}>
      <span className="ann-mark" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(!open))}>
        {children}
      </span>
      <span className="ann-note" role="note">
        {note}
        <svg viewBox="0 0 48 20" width="48" height="20" aria-hidden="true">
          {side === "right" ? <path d="M46 11 C 32 7, 18 13, 4 9 M11 4 L4 9 L10 15" /> : <path d="M2 11 C 16 7, 30 13, 44 9 M37 4 L44 9 L38 15" />}
        </svg>
      </span>
    </span>
  );
}
