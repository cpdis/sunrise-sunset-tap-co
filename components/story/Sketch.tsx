"use client";

// A hand-drawn system diagram: cards on a table, joined by inked arrows. Tap a card to read its note,
// drag cards around, play a flow to watch something move through the system, or flick between steps.
// Text on the page can point at it (see Term): its cards and lines then light up in the accent.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Box, arrow, fillBox, sketchBox } from "./ink";

export interface SketchNode {
  id: string;
  t: string;
  s?: string;
  // Centre of the card: x as a fraction of the table width, y in px.
  at: [number, number];
  note?: string;
  hub?: boolean;
  w?: number;
  // Steps (by index) in which this card is struck out, e.g. the tools the agent can't use after a hand-over.
  off?: number[];
}

export interface SketchEdge {
  f: string;
  t: string;
  l?: string;
  dash?: boolean;
  off?: number[];
}

export interface FlowStep {
  say: string;
  // A path of card ids a dot travels along, or several that travel at once.
  go?: string[];
  par?: string[][];
  tag?: string;
  // Pause on one card, showing tag above it.
  wait?: number;
  at?: string;
}

export interface SketchConfig {
  id: string;
  h: number;
  mh: number;
  nodes: SketchNode[];
  edges: SketchEdge[];
  flows?: { label: string; steps: FlowStep[] }[];
  steps?: { label: string; say: string }[];
  // This diagram is a zoom on one part: these start lit, the rest dimmed.
  focus?: { nodes: string[]; edges: string[] };
  idle?: string;
  // Card width on phones. Cards keep their desktop places there, x pulled in a little and y stretched to mh.
  mw?: number;
}

interface Hot {
  nodes: string[];
  edges: string[];
}

const NARROW = 520;
const CARD_W = 132;
const CARD_H = 58;
const key = (e: { f: string; t: string }) => `${e.f}>${e.t}`;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Terms in the text call this to light up part of a diagram (null puts it back).
export function pointAt(id: string, hot: Hot | null) {
  window.dispatchEvent(new CustomEvent("sketch:hot", { detail: { id, hot } }));
}

export function Sketch({ cfg }: { cfg: SketchConfig }) {
  const table = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const cardEls = useRef<Record<string, HTMLDivElement | null>>({});
  const [W, setW] = useState(0);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [lit, setLit] = useState<string | null>(null);
  const [step, setStep] = useState(cfg.steps ? 0 : -1);
  const [term, setTerm] = useState<Hot | null>(null);
  const [anim, setAnim] = useState(0);
  const [running, setRunning] = useState(false);
  const [say, setSay] = useState("");
  const [dots, setDots] = useState<{ k: number; x: number; y: number; tag?: string }[]>([]);
  const [wide, setWide] = useState(false);
  const narrow = W > 0 && W < NARROW;

  // follow the table's width, and whether there is room for margin notes beside the diagram
  useLayoutEffect(() => {
    const el = table.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    const mq = window.matchMedia("(min-width: 1280px)");
    const onMq = () => setWide(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);

  // measure cards (a title can wrap to two lines), so arrows meet their real edges
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      const next: Record<string, { w: number; h: number }> = {};
      for (const n of cfg.nodes) {
        const el = cardEls.current[n.id];
        if (el) next[n.id] = { w: el.offsetWidth, h: el.offsetHeight };
      }
      setSizes(next);
    });
    for (const n of cfg.nodes) {
      const el = cardEls.current[n.id];
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [cfg.nodes]);

  // a phone and a laptop get different layouts, so a drag only lasts until the layout changes
  useEffect(() => setMoved({}), [narrow]);

  // terms on the page point here
  useEffect(() => {
    const on = (e: Event) => {
      const { id, hot } = (e as CustomEvent<{ id: string; hot: Hot | null }>).detail;
      if (id !== cfg.id) return;
      setTerm(hot);
      if (hot) setAnim((n) => n + 1);
    };
    window.addEventListener("sketch:hot", on);
    return () => window.removeEventListener("sketch:hot", on);
  }, [cfg.id]);

  // a focused diagram draws its lines in once, when it first scrolls into view
  useEffect(() => {
    if (!cfg.focus || !table.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) {
        setAnim((n) => n + 1);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(table.current);
    return () => io.disconnect();
  }, [cfg.focus]);

  const H = narrow ? cfg.mh : cfg.h;
  const cardW = (n: SketchNode) => (narrow && cfg.mw ? cfg.mw : n.w ?? CARD_W);
  const size = useCallback((id: string) => sizes[id] ?? { w: narrow && cfg.mw ? cfg.mw : cfg.nodes.find((n) => n.id === id)?.w ?? CARD_W, h: CARD_H }, [sizes, cfg.nodes, cfg.mw, narrow]);

  const pos = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of cfg.nodes) {
      const [fx, y] = narrow ? [0.5 + (n.at[0] - 0.5) * 0.96, (n.at[1] * cfg.mh) / cfg.h] : n.at;
      const z = size(n.id);
      const m = moved[n.id];
      const x = m ? m.x : fx * W;
      const yy = m ? m.y : y;
      out[n.id] = {
        x: Math.max(z.w / 2 + 4, Math.min(W - z.w / 2 - 4, x)),
        y: Math.max(z.h / 2 + 4, Math.min(H - z.h / 2 - 4, yy)),
      };
    }
    return out;
  }, [cfg.nodes, cfg.mh, cfg.h, narrow, W, H, moved, size]);

  const box = useCallback((id: string): Box => {
    const p = pos[id], z = size(id);
    return { l: p.x - z.w / 2, r: p.x + z.w / 2, t: p.y - z.h / 2, b: p.y + z.h / 2, cx: p.x, cy: p.y };
  }, [pos, size]);

  const isOff = (o: { off?: number[] }) => step >= 0 && !!o.off?.includes(step);
  const hot: Hot = term ?? cfg.focus ?? { nodes: [], edges: [] };
  // While something is pointed at, everything else in a focused diagram stays dimmed.
  const dimmed = (id: string) => !!cfg.focus && !term && !cfg.focus.nodes.includes(id) && !running;

  // ---------- flows ----------

  function ride(a: string, b: string, tag: string | undefined, k: number) {
    return new Promise<void>((done) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", arrow(box(a), box(b), a + b).d);
      svg.current!.appendChild(path);
      const len = path.getTotalLength();
      const ms = reduced() ? 0 : 720;
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = ms ? Math.min(1, (now - t0) / ms) : 1;
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const pt = path.getPointAtLength(len * e);
        setDots((ds) => [...ds.filter((d) => d.k !== k), { k, x: pt.x, y: pt.y, tag }]);
        if (t < 1) requestAnimationFrame(tick);
        else {
          path.remove();
          setDots((ds) => ds.filter((d) => d.k !== k));
          const el = cardEls.current[b];
          if (el) {
            el.classList.remove("ping");
            void el.offsetWidth;
            el.classList.add("ping");
          }
          done();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async function play(steps: FlowStep[]) {
    if (running) return;
    setLit(null);
    setTerm(null);
    setRunning(true);
    let k = 0;
    for (const s of steps) {
      setSay(s.say);
      if (s.wait && s.at) {
        const r = box(s.at);
        const id = ++k;
        setDots((ds) => [...ds, { k: id, x: r.cx, y: r.t - 4, tag: s.tag }]);
        await sleep(reduced() ? 900 : s.wait);
        setDots((ds) => ds.filter((d) => d.k !== id));
        continue;
      }
      const paths = s.par ?? (s.go ? [s.go] : []);
      await Promise.all(
        paths.map(async (p) => {
          for (let i = 0; i < p.length - 1; i++) await ride(p[i], p[i + 1], s.tag, ++k);
        }),
      );
      await sleep(reduced() ? 900 : 650);
    }
    setSay("");
    setRunning(false);
  }

  // ---------- dragging ----------

  const dragging = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  function down(e: React.PointerEvent, id: string) {
    if (running || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = { id, sx: e.clientX, sy: e.clientY, ox: pos[id].x, oy: pos[id].y, moved: false };
  }
  function move(e: React.PointerEvent) {
    const g = dragging.current;
    if (!g) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    g.moved = true;
    setLit(null);
    setMoved((m) => ({ ...m, [g.id]: { x: g.ox + dx, y: g.oy + dy } }));
  }
  function up() {
    const g = dragging.current;
    dragging.current = null;
    if (g && !g.moved) setLit((l) => (l === g.id ? null : g.id));
  }

  // a tap anywhere else closes the open note
  useEffect(() => {
    if (!lit) return;
    const close = (e: PointerEvent) => {
      if (!table.current?.parentElement?.contains(e.target as Node)) setLit(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [lit]);

  // ---------- drawing ----------

  const ready = W > 0;
  const lines: React.ReactNode[] = [];
  const traces: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  if (ready) {
    for (const e of cfg.edges) {
      const nf = cfg.nodes.find((n) => n.id === e.f)!, nt = cfg.nodes.find((n) => n.id === e.t)!;
      const off = isOff(e) || isOff(nf) || isOff(nt);
      const k = arrow(box(e.f), box(e.t), e.f + e.t);
      const isLit = !!lit && (e.f === lit || e.t === lit);
      const dim = off || ((dimmed(e.f) || dimmed(e.t)) && !hot.edges.includes(key(e)));
      const c = [e.dash ? "dash" : "", isLit ? "lit" : "", dim ? "dim" : ""].join(" ").trim();
      lines.push(<path key={key(e)} className={c} d={k.d} />, <path key={key(e) + "h"} className={c.replace("dash", "")} d={k.head} />);
      if (hot.edges.includes(key(e)) && !off) {
        traces.push(
          <path key={`${key(e)}t${anim}`} className="trace" d={k.d} pathLength={1} />,
          <path key={`${key(e)}th${anim}`} className="trace head" d={k.head} />,
        );
      }
      // A label goes at the curve's middle, unless a card sits there.
      const lw = e.l ? e.l.length * 7 + 16 : 0;
      const covered = cfg.nodes.some((n) => {
        const r = box(n.id);
        return k.mid.x + lw / 2 > r.l && k.mid.x - lw / 2 < r.r && k.mid.y - 4 > r.t - 10 && k.mid.y - 4 < r.b + 10;
      });
      if (e.l && k.len > lw && !covered) {
        labels.push(
          <text key={key(e) + "l"} className={`lbl${dim ? " dim" : ""}`} x={k.mid.x} y={k.mid.y - 7} textAnchor="middle">
            {e.l}
          </text>,
        );
      }
    }
  }

  const litNode = cfg.nodes.find((n) => n.id === lit);
  const litBox = litNode && ready ? box(litNode.id) : null;
  const stepSay = step >= 0 && cfg.steps ? cfg.steps[step].say : "";
  const idle = cfg.idle ?? "Tap a card to read it. Drag them around if you like.";
  const note = say || stepSay || idle;

  return (
    <div className="sk-holder">
      <figure className="sk" aria-label={`Diagram: ${cfg.nodes.map((n) => n.t).join(", ")}`}>
        <div ref={table} className="sk-table" style={{ height: H }}>
          <svg ref={svg} className="sk-edges" aria-hidden="true">
            {lines}
            {traces}
            {labels}
          </svg>
          {cfg.nodes.map((n) => {
            const p = pos[n.id], z = size(n.id);
            const off = isOff(n);
            const c = [
              "sk-card",
              n.hub ? "hub" : "",
              lit === n.id ? "lit" : "",
              hot.nodes.includes(n.id) && !off ? "hot" : "",
              off ? "off" : dimmed(n.id) ? "dim" : "",
              moved[n.id] ? "moved" : "",
              ready ? "" : "pending",
            ].join(" ");
            return (
              <div
                key={n.id}
                ref={(el) => { cardEls.current[n.id] = el; }}
                className={c}
                role="button"
                tabIndex={0}
                aria-expanded={lit === n.id}
                aria-label={`${n.t}${n.s ? `, ${n.s}` : ""}${off ? ", not available in this step" : ""}`}
                style={{ width: cardW(n), transform: ready ? `translate(${p.x - z.w / 2}px, ${p.y - z.h / 2}px)` : undefined }}
                onPointerDown={(e) => down(e, n.id)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => (dragging.current = null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLit((l) => (l === n.id ? null : n.id));
                  }
                }}
              >
                <svg className="sk-ink" width={z.w} height={z.h} aria-hidden="true">
                  <path className="fill" d={fillBox(z.w, z.h)} />
                  <path className="line" d={sketchBox(z.w, z.h, `${cfg.id}:${n.id}`, n.hub ? 2 : 1)} />
                </svg>
                <span className="t">{n.t}</span>
                {n.s && <span className="s">{n.s}</span>}
              </div>
            );
          })}
          {dots.map((d) =>
            d.x !== undefined ? (
              <span key={d.k}>
                <i className="sk-dot" style={{ transform: `translate(${d.x}px, ${d.y}px)` }} />
                {d.tag && <span className="sk-tag" style={{ transform: `translate(${d.x}px, ${d.y}px) translate(-50%, -150%)` }}>{d.tag}</span>}
              </span>
            ) : null,
          )}
          <i className="sk-grain" aria-hidden="true" />
          {litNode && litBox && !wide && (
            <div
              className="sk-pop"
              style={{
                left: Math.max(8, Math.min(W - Math.min(260, W - 16) - 8, litBox.cx - Math.min(260, W - 16) / 2)),
                top: litBox.b + 10,
                width: Math.min(260, W - 16),
                ["--arrow" as string]: `${litBox.cx - Math.max(8, Math.min(W - Math.min(260, W - 16) - 8, litBox.cx - Math.min(260, W - 16) / 2))}px`,
              }}
            >
              {litNode.note ?? litNode.t}
            </div>
          )}
        </div>
        <div className="sk-foot">
          <p className={`sk-note${note === idle ? " idle" : ""}`} aria-live="polite">{note}</p>
          {(cfg.flows?.length || Object.keys(moved).length > 0) && (
            <div className="sk-btns">
              <div className="sk-flows">
                {cfg.flows?.map((f) => (
                  <button key={f.label} type="button" className="sk-play" disabled={running} onClick={() => play(f.steps)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>
                    {f.label}
                  </button>
                ))}
              </div>
              <button type="button" className="sk-reset" aria-label="Put the cards back" title="Put the cards back" disabled={!Object.keys(moved).length || running} onClick={() => setMoved({})}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L20 8" /><path d="M20 3.5V8h-4.5" /><path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L4 16" /><path d="M4 20.5V16h4.5" /></svg>
              </button>
            </div>
          )}
        </div>
      </figure>
      {litNode && litBox && wide && (
        <MarginNote side={litBox.cx > W / 2 ? "right" : "left"} top={litBox.t} text={litNode.note ?? litNode.t} />
      )}
      {cfg.steps && (
        <div className="pills" role="group" aria-label="Pick a moment">
          <div className="track">
            {cfg.steps.map((s, i) => (
              <button key={s.label} type="button" aria-pressed={i === step} disabled={running} onClick={() => { setStep(i); setLit(null); }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A note written in the margin beside the diagram, with a pen arrow pointing at it. Wide screens only.
function MarginNote({ side, top, text }: { side: "left" | "right"; top: number; text: string }) {
  return (
    <div className={`sk-mnote ${side}`} style={{ top }} aria-hidden="true">
      <span>{text}</span>
      <svg viewBox="0 0 48 20" width="48" height="20">
        {side === "left" ? (
          <path d="M2 11 C 16 7, 30 13, 44 9 M37 4 L44 9 L38 15" />
        ) : (
          <path d="M46 11 C 32 7, 18 13, 4 9 M11 4 L4 9 L10 15" />
        )}
      </svg>
    </div>
  );
}
