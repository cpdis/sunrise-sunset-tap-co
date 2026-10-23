"use client";

import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/Logo";
import { SmsWidget } from "@/components/SmsWidget";
import { Loading, useData } from "@/components/ui";
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

  useEffect(() => {
    if (data && !ownerId) router.replace("/login");
  }, [data, ownerId, router]);

  if (!data || !ownerId) return <Loading />;
  const me = data.owners.find((o) => o.id === ownerId);
  const inbox = data.conversations.filter((c) => c.escalated || (c.unread && !c.agentActive)).length;
  const payouts = data.distributions.filter((d) => d.status === "awaiting" && !d.approvals.includes(ownerId)).length;
  const badge: Record<string, number> = { "/admin/inbox": inbox, "/admin/payouts": payouts };

  return (
    <div className={`admin ${sans.variable} ${mono.variable}`}>
      <div className="demo-bar">
        <span>Demo. Data lives in your browser; payments and bank transfers are simulated.</span>
        <span>
          Signed in as {me?.name} · <button className="linkbtn" onClick={() => { logout(); router.push("/login"); }}>Switch owner</button>
        </span>
      </div>
      <div className="admin-shell">
        <nav className="admin-nav" aria-label="Admin">
          <Link href="/" className="nav-home" aria-label="Public site">
            <Logo size={24} />
            <span>Sunrise Sunset</span>
          </Link>
          <div className="nav-links">
            {NAV.map((n) => {
              const on = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
                  {n.label}
                  {badge[n.href] ? <span className="badge">{badge[n.href]}</span> : null}
                </Link>
              );
            })}
          </div>
        </nav>
        <main className="admin-main">{children}</main>
      </div>
      <SmsWidget as={ownerId} />
    </div>
  );
}
