"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DatePicker } from "@/components/DatePicker";
import { HireTermsText } from "@/components/HireTerms";
import { SiteShell } from "@/components/SiteChrome";
import { Loading, useData } from "@/components/ui";
import { SUBURBS, startTimesFor } from "@/lib/config";
import { isBookable, quote } from "@/lib/domain";
import { useApp } from "@/lib/store";
import type { Block } from "@/lib/types";
import { addDays, daysBetween, fmtDate, fmtTime, money, todayISO } from "@/lib/util";

const EVENT_TYPES = ["Wedding", "Birthday", "Engagement", "Corporate", "Run club", "School or club fundraiser", "Other"];
const SORTED = [...SUBURBS].sort((a, b) => a.name.localeCompare(b.name));

export default function Book() {
  const data = useData();
  const book = useApp((s) => s.book);
  const router = useRouter();
  const [date, setDate] = useState<string>();
  const [block, setBlock] = useState<Block>(8);
  const [start, setStart] = useState("12:00");
  const [suburb, setSuburb] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [eventType, setEventType] = useState("Wedding");
  const [guests, setGuests] = useState("");
  const [notes, setNotes] = useState("");
  const [agree, setAgree] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("date")) setDate(q.get("date")!);
    if (q.get("block") === "4") { setBlock(4); setStart("14:00"); }
  }, []);

  if (!data) return <SiteShell><Loading /></SiteShell>;
  const s = data.settings;
  const q = suburb && suburb !== "other" ? quote(s, block, suburb) : null;
  const dateOk = !!date && isBookable(data, date);
  const times = startTimesFor(block);
  const missing = [
    !dateOk && "a date",
    !q && "a suburb",
    !name.trim() && "your name",
    phone.replace(/\D/g, "").length < 8 && "a mobile number",
    !/\S+@\S+\.\S+/.test(email) && "an email",
    !agree && "the hire terms",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0;
  const dueToday = q && date ? (daysBetween(todayISO(), date) <= s.balanceDaysBefore ? q.total : q.deposit) : 0;

  function submit() {
    if (!ready || !date || !q) return;
    const id = book({
      date, block, startTime: start, suburb, name: name.trim(), email: email.trim(), phone: phone.trim(),
      eventType, guests: Number(guests) || undefined, notes: notes.trim() || undefined, via: "web", agreed: true,
    });
    // An empty id means the hold was refused; the date notice above then shows.
    if (id) router.push(`/checkout/${id}`);
  }

  return (
    <SiteShell>
      <div className="banner">
        <img src="/art/hero-pm.jpg" alt="Lithograph of a vineyard wedding table at sunset, a guest pouring from the rear taps of the truck" />
      </div>
      <section className="section" style={{ paddingTop: 40 }}>
        <div className="wrap">
          <span className="eyebrow">Book the truck</span>
          <h1 className="display" style={{ fontSize: "clamp(36px, 4.6vw, 60px)", margin: "10px 0 28px" }}>Check a date</h1>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", alignItems: "start", gap: 24 }}>
            <div className="stack" style={{ gap: 24 }}>
              <div className="card">
                <DatePicker data={data} value={date} onChange={setDate} />
                {date && !dateOk && <div className="notice" style={{ marginTop: 12 }}>That date has just been taken. Pick another?</div>}
              </div>

              <div className="card stack">
                <div className="field">
                  <span id="block-label" style={{ fontSize: 13, fontWeight: 600 }}>How long?</span>
                  <div className="seg" role="group" aria-labelledby="block-label">
                    {([4, 8] as const).map((b) => (
                      <button
                        key={b}
                        className={block === b ? "on" : ""}
                        aria-pressed={block === b}
                        onClick={() => {
                          setBlock(b);
                          // Taps close by the latest finish, so a long block can't start late.
                          const ok = startTimesFor(b);
                          if (!ok.includes(start)) setStart(ok.at(-1)!);
                        }}
                      >
                        {b} hours · {money(b === 4 ? s.price4 : s.price8)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid cols-2">
                  <div className="field">
                    <label htmlFor="start">Taps open at</label>
                    <select id="start" className="input" value={start} onChange={(e) => setStart(e.target.value)}>
                      {times.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="suburb">Suburb</label>
                    <select id="suburb" className="input" value={suburb} onChange={(e) => setSuburb(e.target.value)}>
                      <option value="">Choose…</option>
                      {SORTED.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                      <option value="other">Somewhere else</option>
                    </select>
                  </div>
                </div>
                {suburb === "other" && (
                  <div className="notice">We cover the Perth metro, Swan Valley and Hills, Two Rocks to Mandurah. Text us with the address and we&apos;ll check.</div>
                )}
                {q && q.travelFee > 0 && (
                  <div className="notice info">{suburb} is about {q.minutes} minutes from the Perth CBD, so there&apos;s a {money(q.travelFee)} travel fee.</div>
                )}
              </div>

              <div className="card stack">
                <div className="grid cols-2">
                  <div className="field"><label htmlFor="name">Your name</label><input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
                  <div className="field"><label htmlFor="phone">Mobile</label><input id="phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" /></div>
                  <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" /></div>
                  <div className="field">
                    <label htmlFor="type">Event</label>
                    <select id="type" className="input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                      {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field"><label htmlFor="guests">Guests (roughly)</label><input id="guests" className="input" value={guests} onChange={(e) => setGuests(e.target.value)} inputMode="numeric" /></div>
                </div>
                <div className="field">
                  <label htmlFor="notes">Access, kegs, anything we should know</label>
                  <textarea id="notes" className="input" style={{ fontFamily: "var(--sans)", minHeight: 80 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <label className="check">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span><HireTermsText s={s} /></span>
                </label>
              </div>
            </div>

            <aside className="ticket" style={{ position: "sticky", top: 88 }}>
              <div className="t-top">
                <span className="eyebrow">Your hire</span>
                <strong style={{ fontSize: 18 }}>{date ? fmtDate(date, { dow: true, year: true }) : "Pick a date"}</strong>
                <span className="muted" style={{ fontSize: 14 }}>
                  {block} hours from {fmtTime(start)}{suburb && suburb !== "other" ? ` · delivered to ${suburb}` : ""}
                </span>
              </div>
              <div className="t-row"><span>{block}-hour hire</span><span className="num">{money(block === 4 ? s.price4 : s.price8)}</span></div>
              {q && q.travelFee > 0 && <div className="t-row"><span>Travel, over {s.travelThresholdMin} min</span><span className="num">{money(q.travelFee)}</span></div>}
              <div className="t-row"><span>Total</span><strong className="num">{q ? money(q.total) : "—"}</strong></div>
              <div className="t-row"><span>Bond, held {s.bondHoldDaysBefore} days before</span><span className="num">{money(s.bond)}</span></div>
              <div className="t-tot">
                <span className="label">{q && date && dueToday >= q.total ? "Pay in full today" : "Deposit today"}</span>
                <span className="display">{q && date ? money(dueToday) : money(s.deposit)}</span>
              </div>
              <div className="t-foot">
                {q && date && dueToday < q.total && (
                  <span className="muted">{money(q.total - q.deposit)} charged automatically on {fmtDate(addDays(date, -s.balanceDaysBefore), { dow: true })}.</span>
                )}
                {q && date && dueToday >= q.total && <span className="muted">Your event is within {s.balanceDaysBefore} days, so it&apos;s paid up front.</span>}
                <button className="btn gold" disabled={!ready} onClick={submit} aria-describedby={ready ? undefined : "missing"}>Continue to payment</button>
                {!ready && <span id="missing" className="muted" style={{ fontSize: 13 }}>Still needed: {missing.join(", ")}.</span>}
                <span className="muted" style={{ fontSize: 13 }}>Your date is held for {s.holdMinutes} minutes while you pay.</span>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
