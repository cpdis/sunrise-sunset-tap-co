"use client";

import Link from "next/link";
import { SiteShell } from "@/components/SiteChrome";
import { useData } from "@/components/ui";
import { DEFAULT_SETTINGS, SUBURBS } from "@/lib/config";
import { nextFreeDates } from "@/lib/domain";
import { fillKb } from "@/lib/agent/tools";
import { DEFAULT_KB } from "@/lib/agent/kb";
import { fmtDate, money, todayISO } from "@/lib/util";

const FAQ_SLUGS = ["how-it-works", "keg-guide", "rsa-licensing", "booking-policy", "service-area", "truck-spec"];

export default function Home() {
  const data = useData();
  const s = data?.settings ?? DEFAULT_SETTINGS;
  const kb = data?.kb ?? DEFAULT_KB;
  const free = data ? nextFreeDates(data, todayISO(), 6, true) : [];
  const far = SUBURBS.filter((x) => x.minutes > s.travelThresholdMin).map((x) => x.name);

  return (
    <SiteShell>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="stack" style={{ gap: 24 }}>
            <span className="eyebrow" style={{ color: "var(--gold)" }}>Perth · Swan Valley to Mandurah</span>
            <h1 className="display">A tiny truck with eight cold taps.</h1>
            <p>
              Dry hire for weddings, birthdays and run clubs. We drive it in, hook up your kegs,
              pour a test from every line, and come back for it when the night&apos;s done.
            </p>
            <div className="row">
              <Link href="/book" className="btn gold">Check a date</Link>
              <span className="muted" style={{ color: "#d9d2c4" }}>From {money(s.price4)} · delivery included</span>
            </div>
            {free.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="eyebrow" style={{ color: "#a6aec0" }}>Next free weekends</span>
                <div className="row" style={{ gap: 8 }}>
                  {free.map((d) => (
                    <Link key={d} href={`/book?date=${d}`} className="btn ghost small" style={{ color: "var(--bone)" }}>
                      {fmtDate(d, { dow: true })}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          <video
            className="hero-img"
            src="/video/hero-wedding-loop.mp4"
            poster="/video/hero-wedding-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="The Sunrise Sunset tap truck pouring beers at a garden wedding at sunset"
          />
        </div>
      </section>
      <div className="stripes"><span /><span /><span /></div>

      <section className="section" id="how">
        <div className="wrap">
          <span className="eyebrow">How it works</span>
          <h2 className="display">You bring the beer. We bring the bar.</h2>
          <ol className="steps">
            <li>
              <span className="mono muted">01</span>
              <strong>Pick a date</strong>
              <span className="muted">Book online or just text us. {money(s.deposit)} holds the day, and the balance comes off the same card {s.balanceDaysBefore} days out.</span>
            </li>
            <li>
              <span className="mono muted">02</span>
              <strong>Buy your kegs</strong>
              <span className="muted">From any brewery or distributor at wholesale prices. Up to eight lines: beer, cider, soda water, even nitro cold brew.</span>
            </li>
            <li>
              <span className="mono muted">03</span>
              <strong>We set it up</strong>
              <span className="muted">One of us drives it in, connects the kegs, sets the gas and pours a test from every tap. Then we leave you to it.</span>
            </li>
            <li>
              <span className="mono muted">04</span>
              <strong>We pick it up</strong>
              <span className="muted">We collect at the end of your block. Truck back clean and in one piece, your {money(s.bond)} bond hold drops off.</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="truck" style={{ background: "var(--white)" }}>
        <div className="wrap hero-grid">
          <video
            className="hero-img"
            src="/video/hero-runclub-loop.mp4"
            poster="/video/hero-runclub-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            aria-label="Runners getting cold brew from the truck at sunrise"
          />
          <div className="stack" style={{ gap: 20 }}>
            <span className="eyebrow">The truck</span>
            <h2 className="display" style={{ margin: 0 }}>Small enough for the backyard. Cold enough for January.</h2>
            <ul className="spec">
              <li><strong>8 taps</strong><br /><span className="muted">Stainless flow-control</span></li>
              <li><strong>Refrigerated box</strong><br /><span className="muted">No mains power needed</span></li>
              <li><strong>3.4 × 1.5 m</strong><br /><span className="muted">Fits most gates a small car fits</span></li>
              <li><strong>Glass rinser + sink</strong><br /><span className="muted">Hot water, hand wash</span></li>
              <li><strong>2.5 m awning</strong><br /><span className="muted">Shade for whoever&apos;s pouring</span></li>
              <li><strong>Glassware included</strong><br /><span className="muted">120 pints, 60 schooners</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="wrap">
          <span className="eyebrow">Pricing</span>
          <h2 className="display">Two blocks. No surprises.</h2>
          <div className="grid cols-2">
            <div className="card price-card stack">
              <span className="eyebrow">Half day</span>
              <span className="amt">{money(s.price4)}</span>
              <span className="muted">4 hours on site. Afternoon parties, launches, after the run.</span>
              <Link href="/book?block=4" className="btn ghost" style={{ alignSelf: "flex-start" }}>Book 4 hours</Link>
            </div>
            <div className="card night price-card stack">
              <span className="eyebrow" style={{ color: "var(--gold)" }}>Full day</span>
              <span className="amt">{money(s.price8)}</span>
              <span style={{ color: "#d9d2c4" }}>8 hours on site. Weddings, ceremonies through to last song.</span>
              <Link href="/book?block=8" className="btn gold" style={{ alignSelf: "flex-start" }}>Book 8 hours</Link>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 20, maxWidth: 760 }}>
            Includes delivery, setup, line test, collection and glassware. Free delivery within {s.travelThresholdMin} minutes
            of North Perth; further out ({far.slice(0, 3).join(", ")}) adds {money(s.travelFee)}. {money(s.bond)} bond held on your card,
            released after pickup. Full refund if you cancel more than {s.cancelDays} days out.
          </p>
        </div>
      </section>

      <section className="section" style={{ background: "var(--night)", color: "var(--bone)" }}>
        <div className="wrap" style={{ maxWidth: 760 }}>
          <span className="eyebrow" style={{ color: "var(--gold)" }}>Why the name</span>
          <h2 className="display">There&apos;s a hill we run over on Wednesdays.</h2>
          <p style={{ fontSize: 19, color: "#d9d2c4" }}>
            Some weeks it&apos;s at sunrise, some weeks at sunset. We&apos;re a handful of Perth runners who wanted cold brew after
            the first one and a beer after the second, so we bought a truck that does both. Text us any time. A real person reads
            anything the bot can&apos;t answer.
          </p>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap" style={{ maxWidth: 860 }}>
          <span className="eyebrow">Good questions</span>
          <h2 className="display">FAQ</h2>
          {FAQ_SLUGS.map((slug) => {
            const p = kb.find((x) => x.slug === slug);
            if (!p) return null;
            return (
              <details className="faq" key={slug}>
                <summary>{p.title}</summary>
                <ul className="muted">
                  {fillKb(p.body, s).split("\n").map((l, i) => <li key={i}>{l.replace(/^- /, "")}</li>)}
                </ul>
              </details>
            );
          })}
        </div>
      </section>
    </SiteShell>
  );
}
