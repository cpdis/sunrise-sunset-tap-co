"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/util";

// Admin money chart, console style: cumulative profit as an azure line with a flat tint under it,
// capital paid in as a dashed ink rule, hairline grid, and a hover readout per month.
// It draws at the panel's own width (measured), so type stays 12px at every size.

type Props = {
  months: string[]; // short labels, oldest first
  profit: number[]; // cumulative, same length as months
  capital: number;
};

const H = 240;
const PAD = { t: 16, r: 20, b: 28, l: 56 };

export function PaybackChart({ months, profit, capital }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = w < 520;
  const pad = narrow ? { ...PAD, l: 44, r: 12 } : PAD;
  const max = Math.max(1, capital, ...profit);
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const min = Math.min(0, ...profit);
  const bottom = min < 0 ? -Math.ceil(-min / step) * step : 0;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + 1e-6; v += step) ticks.push(v);
  // one point per month end, spread edge to edge
  const X = (i: number) => pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, months.length - 1);
  const Y = (v: number) => pad.t + ((H - pad.t - pad.b) * (top - v)) / (top - bottom);
  const line = profit.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(profit.length - 1).toFixed(1)},${Y(Math.max(0, bottom))} L${X(0)},${Y(Math.max(0, bottom))} Z`;
  const every = narrow ? 2 : 1;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.round(((x - pad.l) / (w - pad.l - pad.r)) * (months.length - 1));
    setHover(Math.max(0, Math.min(months.length - 1, i)));
  }

  const hx = hover === null ? 0 : X(hover);
  return (
    <div className="ch-plot" ref={box}>
      <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Cumulative profit by month against ${money(capital)} capital paid in`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--a-line)" />
            <text x={pad.l - 10} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="var(--a-text-2)" style={{ fontVariantNumeric: "tabular-nums" }}>{short(v)}</text>
          </g>
        ))}
        {months.map((m, i) => (i % every === (months.length - 1) % every ? (
          <text key={i} x={X(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"} fontSize={12} fill="var(--a-text-2)">{m}</text>
        ) : null))}
        <line x1={pad.l} x2={w - pad.r} y1={Y(capital)} y2={Y(capital)} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 4" />
        <path d={area} fill="color-mix(in srgb, var(--azure) 8%, white)" />
        <path d={line} pathLength={1} className="draw" fill="none" stroke="var(--azure)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(profit.length - 1)} cy={Y(profit.at(-1) ?? 0)} r={3.5} fill="var(--azure)" stroke="#fff" strokeWidth={1.5} />
        {hover !== null && (
          <g>
            <line x1={hx} x2={hx} y1={pad.t} y2={H - pad.b} stroke="var(--a-line-2)" />
            <circle cx={hx} cy={Y(profit[hover])} r={4} fill="#fff" stroke="var(--azure)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(Math.min(Math.max(hx, 90), w - 90) / w) * 100}%` }}>
          <span className="meta">{months[hover]}</span>
          <span className="row"><span>Profit to date</span><b>{money(profit[hover])}</b></span>
          <span className="row"><span>Still to recover</span><b>{money(Math.max(0, capital - profit[hover]))}</b></span>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function short(v: number) {
  const a = Math.abs(v);
  const s = a === 0 ? "$0" : a >= 1000 ? `$${Math.round(a / 100) / 10}k` : `$${a}`;
  return v < 0 ? `−${s}` : s;
}
