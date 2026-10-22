"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/Logo";
import { Loading, useData } from "@/components/ui";
import { useApp } from "@/lib/store";

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
    <>
      <div className="demo-bar">
        Demo: data lives in your browser, payments and bank transfers are simulated. Signed in as {me?.name}.{" "}
        <button className="linkbtn" style={{ color: "var(--ink)" }} onClick={() => { logout(); router.push("/login"); }}>Switch owner</button>
      </div>
      <div className="admin">
        <nav className="admin-nav">
          <Link href="/" style={{ marginBottom: 12, gap: 10, justifyContent: "flex-start" }}><Logo size={34} /><span className="display" style={{ fontSize: 22, color: "var(--paper)", lineHeight: 0.95 }}>Sunrise<br />Sunset</span></Link>
          {NAV.map((n) => {
            const on = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={on ? "on" : ""}>
                {n.label}
                {badge[n.href] ? <span className="badge">{badge[n.href]}</span> : null}
              </Link>
            );
          })}
        </nav>
        <main className="admin-main">{children}</main>
      </div>
    </>
  );
}
