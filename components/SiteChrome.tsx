"use client";

import Link from "next/link";
import { BUSINESS } from "@/lib/config";
import { Roundel, Wordmark } from "./Logo";
import { SmsWidget } from "./SmsWidget";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="Sunrise Sunset Tap Co., home">
          <Wordmark height={46} />
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
      <div className="wrap">
        <div className="row" style={{ gap: 16, alignItems: "center" }}>
          <Roundel size={56} />
          <div className="stack" style={{ gap: 2 }}>
            <span className="display" style={{ fontSize: 30 }}>Cold brew at dawn. Beer at dusk.</span>
            <span className="label">Self-pour tap truck · Swan Valley to Mandurah</span>
          </div>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span>Text <a href={`sms:${BUSINESS.sms.replace(/\s/g, "")}`}>{BUSINESS.sms}</a></span>
          <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
          <span className="muted" style={{ fontSize: 13 }}>Perth, Western Australia · ABN pending · <Link href="/login">Owner login</Link></span>
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
