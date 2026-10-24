"use client";

// Widgets for the making-of page: a before/after slider, a stepper through images, and the threads as a Gantt chart.
import { useState } from "react";

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
      <span className={`cmp-l l${x < 10 ? " hide" : ""}`}>{labels[0]}</span>
      <span className={`cmp-l r${x > 90 ? " hide" : ""}`}>{labels[1]}</span>
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
  return (
    <div className="m-views">
      <div className="pills" role="group" aria-label="Pick a stage">
        <div className="track">
          {views.map((s, k) => (
            <button key={s.label} type="button" aria-pressed={k === i} onClick={() => setI(k)}>{s.label}</button>
          ))}
        </div>
      </div>
      {/* Every stage stays mounted, so a switch shows images that are already loaded. */}
      <div className="m-stack">
        {views.map((w, k) => (
          <div key={w.label} className={`m-view${k === i ? " on" : ""}`} aria-hidden={k !== i} inert={k !== i}>
            {w.cmp && <Compare {...w.cmp} />}
            {w.imgs && (
              <div className="m-grid" style={{ ["--cols" as string]: w.cols ?? w.imgs.length }}>
                {w.imgs.map((m) => <Pic key={m.src} img={m} />)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="m-stack" aria-live="polite">
        {views.map((w, k) => <p key={w.label} className={`m-say m-view${k === i ? " on" : ""}`} aria-hidden={k !== i}>{w.say}</p>)}
      </div>
    </div>
  );
}

// ---------- the threads, as a Gantt chart ----------

export interface Row {
  t: string;
  kind: "build" | "review" | "media" | "plan";
  from: string;
  to: string;
  made: string;
  prs: { n: number; title: string; at?: string; href: string; note?: string }[];
}

const HOUR = 36e5;
const perthHour = (ms: number) => new Date(ms + 8 * HOUR).getUTCHours();
const when = (ms: number, withDay = true) =>
  new Date(ms).toLocaleString("en-AU", { ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}), hour: "numeric", minute: "2-digit", timeZone: "Australia/Perth" });
function span(ms: number) {
  const m = Math.max(1, Math.round(ms / 6e4));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r && h < 10 ? `${h} h ${r} min` : `${Math.round(m / 60)} h`;
}

export function Gantt({ rows, from, to }: { rows: Row[]; from: string; to: string }) {
  const t0 = Date.parse(from), t1 = Date.parse(to);
  const x = (ms: number) => ((ms - t0) / (t1 - t0)) * 100;
  const [sel, setSel] = useState(0);
  const r = rows[sel];

  // Night in Perth, 22:00 to 07:00, and a tick every six hours of Perth time.
  const nights: [number, number][] = [];
  const ticks: { at: number; label: string; day: boolean }[] = [];
  for (let ms = Math.ceil(t0 / HOUR) * HOUR; ms <= t1; ms += HOUR) {
    const h = perthHour(ms);
    if (h === 22) nights.push([x(ms), Math.min(100, x(ms + 9 * HOUR))]);
    if (h % 6 === 0) ticks.push({ at: x(ms), day: h === 0, label: h === 0 ? new Date(ms).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Perth" }) : `${h}:00` });
  }

  return (
    <div className="gt">
      <div className="gt-scroll">
        <div className="gt-chart" role="list" aria-label="Project threads, start to finish">
          <div className="gt-axis" aria-hidden="true">
            <span className="gt-name" />
            <span className="gt-track">
              {ticks.map((k) => <i key={k.at} className={k.day ? "day" : ""} style={{ left: `${k.at}%` }}>{k.label !== "6:00" && <b>{k.label}</b>}</i>)}
            </span>
          </div>
          <div className="gt-body">
            <span className="gt-bg" aria-hidden="true">
              {nights.map(([l, rr]) => <i key={l} className="night" style={{ left: `${l}%`, width: `${rr - l}%` }} />)}
              {ticks.filter((k) => k.day).map((k) => <i key={k.at} className="rule" style={{ left: `${k.at}%` }} />)}
            </span>
            {rows.map((row, i) => {
              const a = Date.parse(row.from), b = Date.parse(row.to);
              const late = x(b) > 82;
              const nums = row.prs.map((p) => `#${p.n}`).join(" ");
              return (
                <button
                  key={row.t}
                  type="button"
                  role="listitem"
                  className={`gt-row${i === sel ? " on" : ""}`}
                  aria-pressed={i === sel}
                  aria-label={`${row.t}, ${when(a)} for ${span(b - a)}${nums ? `, ${nums}` : ""}`}
                  onClick={() => setSel(i)}
                >
                  <span className="gt-name">{row.t}</span>
                  <span className="gt-track">
                    <i className={`gt-bar ${row.kind}`} style={{ left: `${x(a)}%`, width: `max(4px, ${x(b) - x(a)}%)` }} />
                    {row.prs.filter((p) => p.at).map((p) => <i key={p.n} className="gt-pr" style={{ left: `${x(Date.parse(p.at!))}%` }} />)}
                    {nums && (
                      <b className={`gt-nums${late ? " before" : ""}`} style={late ? { right: `calc(${100 - x(a)}% + 8px)` } : { left: `calc(${x(b)}% + 10px)` }}>{nums}</b>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="gt-key" aria-hidden="true">
        <span><i className="build" /> build</span>
        <span><i className="review" /> review</span>
        <span><i className="media" /> pictures and video</span>
        <span><i className="plan" /> plan and research</span>
        <span><i className="pr" /> PR merged</span>
        <span><i className="night" /> night in Perth</span>
      </div>
      <div className="gt-say" aria-live="polite">
        <p className="gt-h"><b>{r.t}</b> <time>{when(Date.parse(r.from))} to {when(Date.parse(r.to), new Date(Date.parse(r.from) + 8 * HOUR).getUTCDate() !== new Date(Date.parse(r.to) + 8 * HOUR).getUTCDate())}, {span(Date.parse(r.to) - Date.parse(r.from))}</time></p>
        <p>{r.made}</p>
        {r.prs.length > 0 && (
          <ul>
            {r.prs.map((p) => <li key={p.n}><a href={p.href}>#{p.n}</a> {p.title}{p.note ? ` (${p.note})` : ""}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
