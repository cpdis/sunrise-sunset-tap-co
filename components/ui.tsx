"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useApp } from "@/lib/store";
import type { Booking, BookingState, Channel, Data } from "@/lib/types";

export function useData(): Data | null {
  return useApp((s) => (s.hydrated ? s.data : null));
}

export function Loading() {
  return <div className="muted mono" style={{ padding: 40 }}>Loading…</div>;
}

const STATE_LABEL: Record<BookingState, string> = {
  held: "Held",
  confirmed: "Deposit paid",
  balance_paid: "Paid in full",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function StatePill({ b }: { b: Pick<Booking, "state" | "kind"> }) {
  if (b.kind === "personal" && b.state !== "cancelled") return <span className="pill personal">Owner use</span>;
  return <span className={`pill ${b.state}`}>{STATE_LABEL[b.state]}</span>;
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  sms: "SMS",
  email: "Email",
  phone: "Phone",
  web: "Web form",
  admin: "Admin",
};

// Turns URLs in agent messages into links; links to this site stay in the tab.
export function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!/^https?:\/\//.test(p)) return <Fragment key={i}>{p}</Fragment>;
        const url = p.replace(/[.,!?)]+$/, "");
        const tail = p.slice(url.length);
        let path: string | null = null;
        try {
          const u = new URL(url);
          if (typeof window !== "undefined" && u.origin === window.location.origin) path = u.pathname;
        } catch {}
        return (
          <Fragment key={i}>
            {path ? <Link href={path}>{url}</Link> : <a href={url} target="_blank" rel="noreferrer">{url}</a>}
            {tail}
          </Fragment>
        );
      })}
    </>
  );
}

export function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="card stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

// An admin section: its label (and any control, such as a filter) sits above the card, not inside it.
export function Section({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="block">
      <div className="block-head">
        <h2 className="eyebrow muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
