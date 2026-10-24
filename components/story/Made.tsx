"use client";

// Widgets for the making-of page: a before/after slider, a stepper through images, and the timeline strip.
import { useMemo, useState } from "react";

export interface Img {
  src: string;
  alt: string;
  cap?: string;
  w: number;
  h: number;
}

// Two images of the same thing. Drag the handle to wipe from before to after.
export function Compare({ a, b, labels = ["Before", "After"] }: { a: Img; b: Img; labels?: [string, string] }) {
  const [x, setX] = useState(50);
  return (
    <div className="cmp" style={{ aspectRatio: `${b.w} / ${b.h}` }}>
      <img src={b.src} alt={b.alt} loading="lazy" />
      <img src={a.src} alt={a.alt} loading="lazy" className="cmp-a" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }} />
      <span className="cmp-l l">{labels[0]}</span>
      <span className="cmp-l r">{labels[1]}</span>
      <i className="cmp-bar" style={{ left: `${x}%` }} aria-hidden="true"><b /></i>
      <input type="range" min={0} max={100} value={x} onChange={(e) => setX(+e.target.value)} aria-label={`Wipe between ${labels[0]} and ${labels[1]}`} />
    </div>
  );
}

export interface View {
  label: string;
  say: string;
  cmp?: { a: Img; b: Img; labels?: [string, string] };
  imgs?: Img[];
  cols?: number;
}

function Pic({ img }: { img: Img }) {
  return (
    <figure className="m-pic">
      <img src={img.src} alt={img.alt} width={img.w} height={img.h} loading="lazy" />
      {img.cap && <figcaption>{img.cap}</figcaption>}
    </figure>
  );
}

export function Views({ views }: { views: View[] }) {
  const [i, setI] = useState(0);
  const v = views[i];
  return (
    <div className="m-views">
      <div className="pills" role="group" aria-label="Pick a stage">
        <div className="track">
          {views.map((s, k) => (
            <button key={s.label} type="button" aria-pressed={k === i} onClick={() => setI(k)}>{s.label}</button>
          ))}
        </div>
      </div>
      <div className="m-view">
        {v.cmp && <Compare {...v.cmp} />}
        {v.imgs && (
          <div className="m-grid" style={{ ["--cols" as string]: v.cols ?? v.imgs.length }}>
            {v.imgs.map((m) => <Pic key={m.src} img={m} />)}
          </div>
        )}
      </div>
      <p className="m-say" aria-live="polite">{v.say}</p>
    </div>
  );
}

// ---------- the timeline ----------

export interface Mark {
  at: string;
  say: string;
  kind?: "pr" | "pick" | "start";
  pr?: number;
  href?: string;
}

const t = (at: string) => new Date(at.replace(" ", "T") + ":00+08:00").getTime();
const DAY = 864e5;

export function Timeline({ marks, from, to }: { marks: Mark[]; from: string; to: string }) {
  const t0 = t(from), t1 = t(to);
  const pct = (at: string) => ((t(at) - t0) / (t1 - t0)) * 100;
  const days = useMemo(() => [...new Set(marks.map((m) => m.at.slice(0, 10)))], [marks]);
  const [sel, setSel] = useState(0);
  const [day, setDay] = useState(days[0]);
  const m = marks[sel];

  // Ticks that would touch climb a level, so each one can still be pressed.
  const last: Record<string, number[]> = {};
  const levels = marks.map((k) => {
    const side = k.kind === "pr" ? "up" : "down";
    const p = pct(k.at);
    const used = (last[side] ??= []);
    let lv = 0;
    while (used[lv] !== undefined && p - used[lv] < 1.6) lv++;
    used[lv] = p;
    return lv;
  });

  // Night, 22:00 to 07:00, drawn as a soft band.
  const nights: number[][] = [];
  for (let d = new Date(from.slice(0, 10) + "T22:00:00+08:00").getTime(); d < t1; d += DAY) {
    const l = Math.max(0, ((d - t0) / (t1 - t0)) * 100), r = Math.min(100, ((d + 9 * 36e5 - t0) / (t1 - t0)) * 100);
    if (r > l) nights.push([l, r]);
  }
  const fmt = (at: string) => new Date(t(at)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Perth" });

  function pick(k: number) {
    setSel(k);
    setDay(marks[k].at.slice(0, 10));
  }

  return (
    <div className="tl">
      <div className="tl-scroll">
        <div className="tl-strip">
          {nights.map(([l, r], k) => <i key={k} className="tl-night" style={{ left: `${l}%`, width: `${r - l}%` }} />)}
          {days.map((d) => (
            <span key={d} className="tl-day" style={{ left: `${Math.max(0, pct(d + " 00:00"))}%` }}>{fmt(d + " 12:00")}</span>
          ))}
          <svg className="tl-line" viewBox="0 0 1000 8" preserveAspectRatio="none" aria-hidden="true">
            <path d="M2 4 C 120 2.6, 260 5.4, 400 3.8 S 700 2.8, 840 4.6 S 960 3.4, 998 4" />
          </svg>
          {marks.map((k, i) => (
            <button
              key={k.at + i}
              type="button"
              className={`tl-tick ${k.kind ?? "say"} ${k.kind === "pr" ? "up" : "down"}${i === sel ? " on" : ""}`}
              style={{ left: `${pct(k.at)}%`, ["--lv" as string]: levels[i] }}
              aria-label={`${k.at.slice(11)}, ${k.say}`}
              aria-pressed={i === sel}
              onClick={() => pick(i)}
            >
              {k.kind === "pr" && <span>#{k.pr}</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="tl-say" aria-live="polite"><time>{fmt(m.at)}, {m.at.slice(11)}</time> {m.say}</p>
      <div className="tl-key" aria-hidden="true">
        <span><i className="pr" /> merged PR</span>
        <span><i className="pick" /> Colin&apos;s pick</span>
        <span><i className="say" /> what happened</span>
        <span><i className="night" /> night</span>
      </div>
      <div className="pills" role="group" aria-label="Pick a day">
        <div className="track">
          {days.map((d) => (
            <button key={d} type="button" aria-pressed={d === day} onClick={() => setDay(d)}>{fmt(d + " 12:00")}</button>
          ))}
        </div>
      </div>
      <ul className="day">
        {marks.map((k, i) =>
          k.at.startsWith(day) ? (
            <li key={k.at + i} className={`${k.kind ?? ""}${i === sel ? " on" : ""}`}>
              <time>{k.at.slice(11)}</time>
              <span>{k.href ? <a href={k.href}>{k.say}</a> : k.say}</span>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}
