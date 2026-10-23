"use client";

import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { SmsWidget } from "@/components/SmsWidget";
import { Loading, useData } from "@/components/ui";
import { SCENARIOS } from "@/lib/seed";
import { useApp } from "@/lib/store";
import "./admin.css";

// The owners' admin reads like a finance console: Geist on white, Golden Hour inks as accents only.
const sans = Geist({ subsets: ["latin"], variable: "--font-admin", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-admin-mono", display: "swap" });

const NAV = [
  { href: "/admin", label: "Today" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/money", label: "Money" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/owners", label: "Owners" },
  { href: "/admin/truck", label: "Truck" },
  { href: "/admin/knowledge", label: "Agent knowledge" },
  { href: "/admin/settings", label: "Settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const data = useData();
  const ownerId = useApp((s) => s.ownerId);
  const logout = useApp((s) => s.logout);
  const path = usePathname();
  const router = useRouter();
  // phones: every page lives in a menu sheet under the top bar
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [menu]);

  useEffect(() => {
    if (data && !ownerId) router.replace("/login");
  }, [data, ownerId, router]);

  if (!data || !ownerId) return <Loading />;
  const me = data.owners.find((o) => o.id === ownerId);
  const inbox = data.conversations.filter((c) => c.escalated || (c.unread && !c.agentActive)).length;
  const payouts = data.distributions.filter((d) => d.status === "awaiting" && !d.approvals.includes(ownerId)).length;
  const badge: Record<string, number> = { "/admin/inbox": inbox, "/admin/payouts": payouts };
  const current = NAV.find((n) => (n.href === "/admin" ? path === "/admin" : path.startsWith(n.href)));

  return (
    <div className={`admin ${sans.variable} ${mono.variable}`}>
      <div className="demo-bar">
        Demo · {SCENARIOS[data.scenario].label.toLowerCase()} case<span className="long">. Figures are illustrative; data lives in your browser and payments are simulated.</span>
      </div>
      <div className="admin-shell">
        <nav className={`admin-nav${menu ? " open" : ""}`} aria-label="Admin">
          <div className="nav-bar">
            <Link href="/" className="nav-home" aria-label="Public site">
              <Logo size={24} />
              <span>Sunrise Sunset</span>
            </Link>
            <button type="button" className="menu-btn" aria-expanded={menu} aria-controls="admin-pages" onClick={() => setMenu(!menu)}>
              {current?.label ?? "Menu"}
              {inbox + payouts > 0 && <span className="badge">{inbox + payouts}</span>}
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="nav-links" id="admin-pages">
            {NAV.map((n) => {
              const on = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
                  {n.label}
                  {badge[n.href] ? <span className="badge">{badge[n.href]}</span> : null}
                </Link>
              );
            })}
            <div className="nav-foot">
              <span className="avatar sm owner" aria-hidden="true">{me?.name.slice(0, 1)}</span>
              <span className="who">{me?.name}</span>
              <button type="button" className="btn small" onClick={() => { logout(); router.push("/login"); }}>Switch owner</button>
            </div>
          </div>
        </nav>
        <main className="admin-main">{children}</main>
      </div>
      <SmsWidget as={ownerId} />
    </div>
  );
}
