import { useId } from "react";

// Shelf Edge chart structure: finding as the title, step lines with hollow dots at each change,
// direct labels at the line ends, and a gold strip along the bottom carrying the one number.
const C = { ink: "#16264A", ink2: "#4B5674", azure: "#2B6CB0", sunset: "#E2612B", gold: "#F2B33D", grid: "#E6E1D6", white: "#FFFFFF" };
const DISPLAY = "var(--font-display), 'Big Shoulders Display', sans-serif";
const LABEL = "var(--font-label), 'Josefin Sans', sans-serif";
const BODY = "var(--font-body), 'Instrument Sans', sans-serif";

export interface Series {
  name: string;
  values: number[];
  color: "ink" | "azure" | "sunset";
  note: string;
}

type Props = {
  title: string;
  sub: string;
  periods: string[];
  series: Series[];
  fmt: (n: number) => string;
  strip: { label: string; lines: string[]; hero: string };
  /** the panel's width in px; the chart draws at this width so one SVG unit is one CSS pixel */
  width: number;
};

// The finding and its description are HTML at the admin type scale (card text 15, note 13); the
// section label sits outside the panel, from the page's Section. The SVG is drawn at the panel's
// own width rather than scaled from a fixed viewBox, so its type stays at the sizes written here
// on any screen: axis 12, direct labels 13 and 12, strip label 11 caps, strip number 34 like a stat.
export function StepChart(props: Props) {
  const id = useId();
  return (
    <figure className="chart" aria-labelledby={id}>
      <figcaption className="chart-head">
        <span id={id} className="chart-title">{props.title}</span>
        <span className="note">{props.sub}</span>
      </figcaption>
      {props.width < 720 ? <CompactPlot {...props} /> : <WidePlot {...props} />}
    </figure>
  );
}

function WidePlot({ periods, series, fmt, strip, width: W }: Props) {
  const x0 = 64, x1 = W - 196, y0 = 28, y1 = 268;
  const stripTop = y1 + 56, stripH = 92, H = stripTop + stripH;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const X = (i: number) => x0 + ((x1 - x0) * i) / periods.length;
  const Y = (v: number) => y1 - ((y1 - y0) * Math.max(0, v)) / top;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  // keep direct labels from colliding
  const ends = series.map((s) => ({ s, y: Y(s.values.at(-1) ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 40) ends[i].y = ends[i - 1].y + 40;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={legend(series, fmt)}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke={C.grid} />
          <text x={x0 - 10} y={Y(v) + 4} textAnchor="end" fontFamily={BODY} fontSize={12} fontWeight={500} fill={C.ink2}>{short(v)}</text>
        </g>
      ))}
      <line x1={x0} x2={x1} y1={y1} y2={y1} stroke={C.ink} strokeWidth={1.5} />
      {periods.map((p, i) => (
        <g key={i}>
          <line x1={X(i)} x2={X(i)} y1={y1} y2={y1 + 5} stroke={C.ink} strokeWidth={1.5} />
          <text x={(X(i) + X(i + 1)) / 2} y={y1 + 22} textAnchor="middle" fontFamily={BODY} fontSize={12} fontWeight={600} letterSpacing={1} fill={C.ink2}>{p.toUpperCase()}</text>
        </g>
      ))}
      <line x1={X(periods.length)} x2={X(periods.length)} y1={y1} y2={y1 + 5} stroke={C.ink} strokeWidth={1.5} />

      {series.map((s) => (
        <g key={s.name}>
          <path d={stepPath(s.values, X, Y)} fill="none" stroke={C[s.color]} strokeWidth={3} strokeLinejoin="miter" strokeLinecap="square" />
          {s.values.map((v, i) => (i && v !== s.values[i - 1] ? <circle key={i} cx={X(i)} cy={Y(v)} r={4.5} fill={C.white} stroke={C[s.color]} strokeWidth={2.5} /> : null))}
        </g>
      ))}
      {ends.map(({ s, y }) => (
        <g key={s.name}>
          <rect x={x1 + 12} y={y - 15} width={4} height={22} fill={C[s.color]} />
          <text x={x1 + 24} y={y - 1} fontFamily={BODY} fontSize={13} fontWeight={700} fill={C.ink}>{s.name}</text>
          <text x={x1 + 24} y={y + 14} fontFamily={BODY} fontSize={12} fontWeight={500} fill={C.ink2}>{fmt(s.values.at(-1) ?? 0)} · {s.note}</text>
        </g>
      ))}

      <rect x={0} y={stripTop} width={W} height={stripH} fill={C.gold} />
      <rect x={0} y={stripTop} width={W} height={4} fill={C.ink} />
      <text x={20} y={stripTop + 32} fontFamily={LABEL} fontWeight={700} fontSize={11} letterSpacing={1.8} fill={C.ink}>{strip.label.toUpperCase()}</text>
      {strip.lines.map((l, i) => (
        <text key={i} x={20} y={stripTop + 56 + i * 18} fontFamily={BODY} fontWeight={i === 0 ? 700 : 400} fontSize={i === 0 ? 15 : 13} fill={C.ink}>{l}</text>
      ))}
      <text x={W - 20} y={stripTop + 62} textAnchor="end" fontFamily={DISPLAY} fontWeight={800} fontSize={34} fill={C.ink} style={{ fontVariantNumeric: "tabular-nums" }}>{strip.hero}</text>
    </svg>
  );
}

function stepPath(values: number[], X: (i: number) => number, Y: (v: number) => number) {
  let d = `M${X(0)},${Y(values[0])}`;
  values.forEach((v, i) => {
    if (i) d += ` V${Y(v)}`;
    d += ` H${X(i + 1)}`;
  });
  return d;
}

// Narrow layout (360 to 720 px): the gold strip sits above the plot, and the direct labels move under it.
function CompactPlot({ periods, series, fmt, strip, width }: Props) {
  const W = Math.max(360, width);
  const stripTop = 20, stripH = 80;
  const y0 = stripTop + stripH + 28, y1 = y0 + 200, x0 = 48, x1 = W - 20;
  const legendTop = y1 + 44;
  const H = legendTop + series.length * 40 + 8;
  const max = Math.max(1, ...series.flatMap((x) => x.values));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const X = (i: number) => x0 + ((x1 - x0) * i) / periods.length;
  const Y = (v: number) => y1 - ((y1 - y0) * Math.max(0, v)) / top;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={legend(series, fmt)}>
      <rect x={0} y={stripTop} width={W} height={stripH} fill={C.gold} />
      <rect x={0} y={stripTop} width={W} height={4} fill={C.ink} />
      <text x={20} y={stripTop + 28} fontFamily={LABEL} fontWeight={700} fontSize={11} letterSpacing={1.8} fill={C.ink}>{strip.label.toUpperCase()}</text>
      <text x={20} y={stripTop + 64} fontFamily={DISPLAY} fontWeight={800} fontSize={28} fill={C.ink} style={{ fontVariantNumeric: "tabular-nums" }}>{strip.hero}</text>
      <text x={W - 20} y={stripTop + 42} textAnchor="end" fontFamily={BODY} fontWeight={700} fontSize={15} fill={C.ink}>{strip.lines[0]}</text>
      <text x={W - 20} y={stripTop + 62} textAnchor="end" fontFamily={BODY} fontSize={12} fill={C.ink}>{strip.lines[1]?.split(" · ")[0]}</text>

      {ticks.map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke={C.grid} />
          <text x={x0 - 6} y={Y(v) + 4} textAnchor="end" fontFamily={BODY} fontSize={11} fontWeight={500} fill={C.ink2}>{short(v)}</text>
        </g>
      ))}
      <line x1={x0} x2={x1} y1={y1} y2={y1} stroke={C.ink} strokeWidth={1.5} />
      {periods.map((p, i) => (X(1) - X(0) >= 34 || i % 2 === 0 ? <text key={i} x={(X(i) + X(i + 1)) / 2} y={y1 + 18} textAnchor="middle" fontFamily={BODY} fontSize={11} fontWeight={600} fill={C.ink2}>{p.toUpperCase()}</text> : null))}
      {series.map((x) => (
        <path key={x.name} d={stepPath(x.values, X, Y)} fill="none" stroke={C[x.color]} strokeWidth={3} strokeLinecap="square" />
      ))}
      {series.map((x, i) => (
        <g key={x.name}>
          <rect x={20} y={legendTop + i * 40 - 14} width={4} height={30} fill={C[x.color]} />
          <text x={32} y={legendTop + i * 40} fontFamily={BODY} fontSize={13} fontWeight={700} fill={C.ink}>{x.name} · {fmt(x.values.at(-1) ?? 0)}</text>
          <text x={32} y={legendTop + i * 40 + 15} fontFamily={BODY} fontSize={12} fill={C.ink2}>{x.note}</text>
        </g>
      ))}
    </svg>
  );
}

function legend(series: Series[], fmt: (n: number) => string) {
  return series.map((s) => `${s.name} ${fmt(s.values.at(-1) ?? 0)}, ${s.note}`).join("; ");
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function short(v: number) {
  return v === 0 ? "$0" : v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${v}`;
}
