"use client";

import Link from "next/link";
import { Fragment, useEffect } from "react";
import { useApp } from "@/lib/store";
import type { Booking, BookingState, Channel, Data } from "@/lib/types";
import type { BookingView, PublicView } from "@/lib/views";

// The whole business, for a signed-in owner. Null for everyone else, and until the first read lands.
export function useData(): Data | null {
  return useApp((s) => (s.hydrated ? s.data : null));
}

// What anyone may see: availability, settings and the knowledge base.
export function usePublic(): PublicView | null {
  return useApp((s) => s.pub);
}

// The booking a customer's link opens. The token comes from the link's ?t=, and without it nothing opens.
export function useBooking(id: string): { view: BookingView | null; token: string; loading: boolean } {
  const openLink = useApp((s) => s.openLink);
  const loading = useApp((s) => s.bookingFor !== id);
  const view = useApp((s) => (s.bookingFor === id ? s.booking : null));
  const token = useApp((s) => (s.link?.id === id ? s.link.token : ""));
  useEffect(() => {
    openLink(id, new URLSearchParams(window.location.search).get("t") ?? "");
  }, [id, openLink]);
  return { view, token, loading };
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

// What the agent did, in the owners' words. Unknown ids fall back to the id itself.
const TOOL_LABEL: Record<string, string> = {
  check_availability: "checked availability",
  lookup_booking: "looked up the booking",
  find_booking: "found the booking",
  quote: "quoted",
  hold_and_send_deposit_link: "held the date and sent the deposit link",
  cancel_quote: "quoted the cancellation",
  cancel_booking: "cancelled the booking",
  escalate_to_owner: "handed over",
  "stripe:webhook": "payment received",
  claude: "",
  rules: "",
};
export function toolWords(tools: string[] | undefined): string {
  return (tools ?? [])
    .map((t) => (t in TOOL_LABEL ? TOOL_LABEL[t] : t.startsWith("kb:") ? `read the ${t.slice(3).replace(/-/g, " ")} page` : t))
    .filter(Boolean)
    .join(", ");
}

// Turns URLs in agent messages into links; links to this site stay in the tab, with their link token (?t=) or
// fragment (a sign-in link's #token=). They are never prefetched, so a link is opened only by a click (A5).
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
          if (typeof window !== "undefined" && u.origin === window.location.origin) path = u.pathname + u.search + u.hash;
        } catch {}
        return (
          <Fragment key={i}>
            {path ? <Link href={path} prefetch={false}>{url}</Link> : <a href={url} target="_blank" rel="noreferrer">{url}</a>}
            {tail}
          </Fragment>
        );
      })}
    </>
  );
}

// One figure in a .stats strip: label over number, no caption.
export function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="stat">
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
        <h2 className="block-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
