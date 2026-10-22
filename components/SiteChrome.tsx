"use client";

import Link from "next/link";
import { BUSINESS } from "@/lib/config";
import { Wordmark } from "./Logo";
import { SmsWidget } from "./SmsWidget";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="Home">
          <Wordmark />
        </Link>
        <nav>
          <Link href="/#how">How it works</Link>
          <Link href="/#truck">The truck</Link>
          <Link href="/#pricing">Pricing</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/book" className="btn gold small">Check a date</Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="stripes"><span /><span /><span /></div>
      <div className="wrap">
        <div className="stack" style={{ gap: 6 }}>
          <span className="display" style={{ fontSize: 24, color: "var(--bone)" }}>Sunrise Sunset Tap Co.</span>
          <span>Cold brew at sunrise. Cold beer at sunset.</span>
          <span className="mono" style={{ fontSize: 12 }}>Perth, Western Australia · ABN pending</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span>Text <a href={`sms:${BUSINESS.sms.replace(/\s/g, "")}`} style={{ color: "var(--gold)" }}>{BUSINESS.sms}</a></span>
          <span><a href={`mailto:${BUSINESS.email}`} style={{ color: "var(--gold)" }}>{BUSINESS.email}</a></span>
          <Link href="/login" style={{ color: "#a6aec0" }}>Owner login</Link>
        </div>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <Footer />
      <SmsWidget />
    </>
  );
}
