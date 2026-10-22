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
        <video
          className="hero-art"
          src="/video/hero-am-loop.mp4"
          poster="/art/hero-am.jpg"
          autoPlay muted loop playsInline preload="metadata"
          aria-label="Lithograph of five runners cresting a hill at dawn, the Perth skyline behind and the tap truck parked at the top"
        />
        <div className="hero-copy">
          <span className="eyebrow">Self-pour tap truck · Perth</span>
          <h1 className="display">Cold brew at dawn.<br />Beer at dusk.</h1>
          <p>Eight cold taps on a tiny truck. We drive it in, hook up your kegs, test every line and come back for it when the night&apos;s done.</p>
          <div className="row">
            <Link href="/book" className="btn gold">Check a date</Link>
            <span className="label">From {money(s.price4)} · delivered</span>
          </div>
        </div>
      </section>

      {free.length > 0 && (
        <section style={{ borderBottom: "1.5px solid var(--ink)", background: "var(--white)" }}>
          <div className="wrap row" style={{ padding: "14px max(16px, 3vw)", gap: 10 }}>
            <span className="label" style={{ marginRight: 8 }}>Next free weekends</span>
            {free.map((d) => (
              <Link key={d} href={`/book?date=${d}`} className="btn ghost small">{fmtDate(d, { dow: true })}</Link>
            ))}
          </div>
        </section>
      )}

      <section className="section" id="how">
        <div className="wrap">
          <span className="eyebrow">How it works</span>
          <h2 className="display">You bring the beer. We bring the bar.</h2>
          <ol className="timetable">
            <li>
              <span className="n">01</span>
              <strong>Pick a date</strong>
              <span className="muted">Book online or just text us. {money(s.deposit)} holds the day; the balance comes off the same card {s.balanceDaysBefore} days out.</span>
            </li>
            <li>
              <span className="n">02</span>
              <strong>Buy your kegs</strong>
              <span className="muted">From any brewery or distributor at wholesale prices. Up to eight lines: beer, cider, soda water, even nitro cold brew.</span>
            </li>
            <li>
              <span className="n">03</span>
              <strong>We set it up</strong>
              <span className="muted">One of us drives it in, connects the kegs, sets the gas and pours a test from every tap. Your guests pour their own.</span>
            </li>
            <li>
              <span className="n">04</span>
              <strong>We collect</strong>
              <span className="muted">We pick it up at the end of your block. Truck back clean and in one piece, your {money(s.bond)} bond hold drops off.</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="section ground" id="truck">
        <div className="wrap stack" style={{ gap: 28 }}>
          <div className="sec-head">
            <span className="eyebrow">The truck</span>
            <h2 className="display" style={{ marginBottom: 0 }}>Small enough for the backyard. Cold enough for January.</h2>
          </div>
          <ul className="spec">
            <li><strong>8 taps</strong><span className="muted">Stainless flow-control</span></li>
            <li><strong>Refrigerated box</strong><span className="muted">No mains power needed</span></li>
            <li><strong>3.4 × 1.5 m</strong><span className="muted">Fits most gates a small car fits</span></li>
            <li><strong>Glass rinser + sink</strong><span className="muted">Hot water, hand wash</span></li>
            <li><strong>2.5 m awning</strong><span className="muted">Shade over the taps</span></li>
            <li><strong>Glassware included</strong><span className="muted">120 pints, 60 schooners</span></li>
          </ul>
          <figure className="film" style={{ margin: 0 }}>
            <video src="/video/hero-pm-loop.mp4" poster="/video/hero-pm-poster.jpg" autoPlay muted loop playsInline preload="none" aria-label="Lithograph of the tap truck at a vineyard wedding at dusk" />
            <figcaption>Dusk · a vineyard wedding</figcaption>
          </figure>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="wrap">
          <span className="eyebrow">Fares</span>
          <h2 className="display">Two blocks. No surprises.</h2>
          <div className="fares">
            <div className="fare">
              <span className="label">Half day</span>
              <span className="amt">{money(s.price4)}<span className="per"> / 4 hours</span></span>
              <span className="muted">Afternoon parties, launches, after the run.</span>
              <Link href="/book?block=4" className="btn ghost" style={{ alignSelf: "flex-start" }}>Book 4 hours</Link>
            </div>
            <div className="fare hero-strip">
              <span className="label">Full day</span>
              <span className="amt">{money(s.price8)}<span className="per"> / 8 hours</span></span>
              <span>Weddings, ceremony through to last song.</span>
              <Link href="/book?block=8" className="btn" style={{ alignSelf: "flex-start" }}>Book 8 hours</Link>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 20, maxWidth: 760 }}>
            Includes delivery, setup, line test, collection and glassware. Free delivery within {s.travelThresholdMin} minutes
            of North Perth; further out ({far.slice(0, 3).join(", ")}) adds {money(s.travelFee)}. {money(s.bond)} bond held on your card,
            released after pickup. Full refund if you cancel more than {s.cancelDays} days out.
          </p>
        </div>
      </section>

      <section className="section ground">
        <div className="wrap" style={{ maxWidth: 820 }}>
          <span className="eyebrow">Why the name</span>
          <h2 className="display">There&apos;s a hill we run over on Wednesdays.</h2>
          <p style={{ fontSize: 19 }}>
            Some weeks it&apos;s at sunrise, some weeks at sunset. We&apos;re a handful of Perth runners who wanted cold brew after
            the first one and a beer after the second, so we bought a truck that does both. Text us any time. A real person reads
            anything the bot can&apos;t answer.
          </p>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap" style={{ maxWidth: 880 }}>
          <span className="eyebrow">Good questions</span>
          <h2 className="display">FAQ</h2>
          <div className="faq-list">
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
        </div>
      </section>
    </SiteShell>
  );
}
