// Shelf Edge chart structure: finding as the title, step lines with hollow dots at each change,
// direct labels at the line ends, and a gold strip along the bottom carrying the one number.
const W = 960;
const H = 560;
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
  eyebrow: string;
  title: string;
  sub: string;
  periods: string[];
  series: Series[];
  fmt: (n: number) => string;
  strip: { label: string; lines: string[]; hero: string };
  /** draw the narrow layout at this width (px) instead of the 960-wide one */
  compact?: number;
};

export function StepChart(props: Props) {
  if (props.compact) return <CompactStepChart {...props} />;
  const { periods, series, fmt } = props;
  // the subtitle wraps to two lines at most; the plot drops by one line when it does
  const sub = wrap(props.sub, 108);
  const x0 = 86, x1 = 760, y0 = 150 + (sub.length - 1) * 20, y1 = 380;
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
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${props.title}. ${props.sub}`}>
      <rect width={W} height={H} fill={C.white} />
      <rect x={56} y={36} width={10} height={10} fill={C.gold} stroke={C.ink} strokeWidth={1.5} />
      <text x={74} y={46} fontFamily={LABEL} fontWeight={700} fontSize={12} letterSpacing={2.2} fill={C.ink}>{props.eyebrow.toUpperCase()}</text>
      <text x={56} y={88} fontFamily={DISPLAY} fontWeight={800} fontSize={36} letterSpacing={0.2} fill={C.ink}>{props.title.toUpperCase()}</text>
      {sub.map((l, i) => <text key={i} x={56} y={114 + i * 20} fontFamily={BODY} fontSize={15} fill={C.ink2}>{l}</text>)}

      {ticks.map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke={C.grid} />
          <text x={x0 - 10} y={Y(v) + 4} textAnchor="end" fontFamily={BODY} fontSize={12.5} fontWeight={500} fill={C.ink2}>{short(v)}</text>
        </g>
      ))}
      <line x1={x0} x2={x1} y1={y1} y2={y1} stroke={C.ink} strokeWidth={1.5} />
      {periods.map((p, i) => (
        <g key={i}>
          <line x1={X(i)} x2={X(i)} y1={y1} y2={y1 + 5} stroke={C.ink} strokeWidth={1.5} />
          <text x={(X(i) + X(i + 1)) / 2} y={y1 + 22} textAnchor="middle" fontFamily={BODY} fontSize={11.5} fontWeight={600} letterSpacing={1} fill={C.ink2}>{p.toUpperCase()}</text>
        </g>
      ))}
      <line x1={X(periods.length)} x2={X(periods.length)} y1={y1} y2={y1 + 5} stroke={C.ink} strokeWidth={1.5} />

      {series.map((s) => {
        const col = C[s.color];
        let d = `M${X(0)},${Y(s.values[0])}`;
        s.values.forEach((v, i) => {
          if (i) d += ` V${Y(v)}`;
          d += ` H${X(i + 1)}`;
        });
        return (
          <g key={s.name}>
            <path d={d} fill="none" stroke={col} strokeWidth={3} strokeLinejoin="miter" strokeLinecap="square" />
            {s.values.map((v, i) => (i && v !== s.values[i - 1] ? <circle key={i} cx={X(i)} cy={Y(v)} r={4.5} fill={C.white} stroke={col} strokeWidth={2.5} /> : null))}
          </g>
        );
      })}
      {ends.map(({ s, y }) => (
        <g key={s.name}>
          <rect x={x1 + 12} y={y - 15} width={4} height={22} fill={C[s.color]} />
          <text x={x1 + 24} y={y - 1} fontFamily={BODY} fontSize={13} fontWeight={700} fill={C.ink}>{s.name}</text>
          <text x={x1 + 24} y={y + 14} fontFamily={BODY} fontSize={12} fontWeight={500} fill={C.ink2}>{fmt(s.values.at(-1) ?? 0)} · {s.note}</text>
        </g>
      ))}

      <rect x={0} y={430} width={W} height={130} fill={C.gold} />
      <rect x={0} y={430} width={W} height={4} fill={C.ink} />
      <text x={56} y={468} fontFamily={LABEL} fontWeight={700} fontSize={11.5} letterSpacing={2} fill={C.ink}>{props.strip.label.toUpperCase()}</text>
      {props.strip.lines.map((l, i) => (
        <text key={i} x={56} y={496 + i * 22} fontFamily={BODY} fontWeight={i === 0 ? 700 : 400} fontSize={i === 0 ? 20 : 13.5} fill={C.ink}>{l}</text>
      ))}
      <text x={W - 56} y={530} textAnchor="end" fontFamily={DISPLAY} fontWeight={800} fontSize={96} fill={C.ink} style={{ fontVariantNumeric: "tabular-nums" }}>{props.strip.hero}</text>
    </svg>
  );
}

function wrap(text: string, max: number) {
  const out: string[] = [];
  for (const w of text.split(" ")) {
    const last = out.at(-1);
    if (last !== undefined && (last + " " + w).length <= max) out[out.length - 1] = last + " " + w;
    else out.push(w);
  }
  return out;
}

function stepPath(values: number[], X: (i: number) => number, Y: (v: number) => number) {
  let d = `M${X(0)},${Y(values[0])}`;
  values.forEach((v, i) => {
    if (i) d += ` V${Y(v)}`;
    d += ` H${X(i + 1)}`;
  });
  return d;
}

// Narrow layout, drawn at the panel's width (360 to 720) rather than scrolled or scaled: title
// wrapped to fit, the gold strip and its number above the plot, and the direct labels under it.
function CompactStepChart(props: Props) {
  const { periods, series, fmt } = props;
  const W = props.compact ?? 400;
  // characters per line, from the average glyph width of each face at its size here
  const title = wrap(props.title.toUpperCase(), Math.floor((W - 40) / 16));
  const sub = wrap(props.sub, Math.floor((W - 40) / 6.9));
  let y = 40;
  const tTop = y + 34;
  y = tTop + (title.length - 1) * 30 + 22;
  const subTop = y;
  y = subTop + (sub.length - 1) * 17 + 24;
  const stripTop = y;
  const stripH = 126;
  y = stripTop + stripH + 34;
  const y0 = y, y1 = y + 200, x0 = 48, x1 = W - 20;
  const legendTop = y1 + 44;
  const H = legendTop + series.length * 40 + 8;
  const max = Math.max(1, ...series.flatMap((x) => x.values));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const X = (i: number) => x0 + ((x1 - x0) * i) / periods.length;
  const Y = (v: number) => y1 - ((y1 - y0) * Math.max(0, v)) / top;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${props.title}. ${props.sub}`}>
      <rect width={W} height={H} fill={C.white} />
      <rect x={20} y={28} width={10} height={10} fill={C.gold} stroke={C.ink} strokeWidth={1.5} />
      <text x={38} y={38} fontFamily={LABEL} fontWeight={700} fontSize={12} letterSpacing={2} fill={C.ink}>{props.eyebrow.toUpperCase()}</text>
      {title.map((l, i) => <text key={i} x={20} y={tTop + i * 30} fontFamily={DISPLAY} fontWeight={800} fontSize={29} fill={C.ink}>{l}</text>)}
      {sub.map((l, i) => <text key={i} x={20} y={subTop + i * 17} fontFamily={BODY} fontSize={13} fill={C.ink2}>{l}</text>)}

      <rect x={0} y={stripTop} width={W} height={stripH} fill={C.gold} />
      <rect x={0} y={stripTop} width={W} height={4} fill={C.ink} />
      <text x={20} y={stripTop + 30} fontFamily={LABEL} fontWeight={700} fontSize={11.5} letterSpacing={2} fill={C.ink}>{props.strip.label.toUpperCase()}</text>
      <text x={20} y={stripTop + 100} fontFamily={DISPLAY} fontWeight={800} fontSize={60} fill={C.ink} style={{ fontVariantNumeric: "tabular-nums" }}>{props.strip.hero}</text>
      <text x={W - 20} y={stripTop + 72} textAnchor="end" fontFamily={BODY} fontWeight={700} fontSize={15} fill={C.ink}>{props.strip.lines[0]}</text>
      <text x={W - 20} y={stripTop + 94} textAnchor="end" fontFamily={BODY} fontSize={12} fill={C.ink}>{props.strip.lines[1]?.split(" · ")[0]}</text>

      {ticks.map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke={C.grid} />
          <text x={x0 - 6} y={Y(v) + 4} textAnchor="end" fontFamily={BODY} fontSize={11} fontWeight={500} fill={C.ink2}>{short(v)}</text>
        </g>
      ))}
      <line x1={x0} x2={x1} y1={y1} y2={y1} stroke={C.ink} strokeWidth={1.5} />
      {periods.map((p, i) => (X(1) - X(0) >= 34 || i % 2 === 0 ? <text key={i} x={(X(i) + X(i + 1)) / 2} y={y1 + 18} textAnchor="middle" fontFamily={BODY} fontSize={10.5} fontWeight={600} fill={C.ink2}>{p.toUpperCase()}</text> : null))}
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

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function short(v: number) {
  return v === 0 ? "$0" : v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${v}`;
}
