// Path maths for the hand-drawn diagrams. Every wobble comes from a seed, so a box or an arrow
// looks the same on every render and only moves when its cards move.

export interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
  cx: number;
  cy: number;
}

const f = (n: number) => n.toFixed(1);

// A small deterministic random stream in -1..1, keyed by a string.
export function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
  };
}

// A rounded box drawn with a pen: each side bows a little, and the stroke overshoots where it started.
// passes = 2 goes over the box twice, for the hub of a diagram.
export function sketchBox(w: number, h: number, seed: string, passes = 1) {
  let d = "";
  for (let p = 0; p < passes; p++) {
    const j = rng(`${seed}#${p}`);
    const r = 9;
    const i = 1.5 + p * 0.8;
    const L = i + j() * 0.7, T = i + j() * 0.7, R = w - i + j() * 0.7, B = h - i + j() * 0.7;
    const bow = () => j() * 1.4;
    d +=
      `M${f(L + r + j() * 2)} ${f(T + j() * 0.5)}` +
      ` C${f(L + (R - L) * 0.33)} ${f(T + bow())} ${f(L + (R - L) * 0.66)} ${f(T + bow())} ${f(R - r)} ${f(T + j() * 0.5)}` +
      ` Q${f(R)} ${f(T)} ${f(R + j() * 0.5)} ${f(T + r)}` +
      ` C${f(R + bow())} ${f(T + (B - T) * 0.33)} ${f(R + bow())} ${f(T + (B - T) * 0.66)} ${f(R + j() * 0.5)} ${f(B - r)}` +
      ` Q${f(R)} ${f(B)} ${f(R - r)} ${f(B + j() * 0.5)}` +
      ` C${f(L + (R - L) * 0.66)} ${f(B + bow())} ${f(L + (R - L) * 0.33)} ${f(B + bow())} ${f(L + r)} ${f(B + j() * 0.5)}` +
      ` Q${f(L)} ${f(B)} ${f(L + j() * 0.5)} ${f(B - r)}` +
      ` C${f(L + bow())} ${f(T + (B - T) * 0.66)} ${f(L + bow())} ${f(T + (B - T) * 0.33)} ${f(L + j() * 0.5)} ${f(T + r * 0.4 + j())} `;
  }
  return d.trim();
}

// The paper behind a card's ink, so lines that pass under a card stop at its edge.
export function fillBox(w: number, h: number) {
  const r = 9, i = 2;
  return `M${i + r} ${i}H${w - i - r}Q${w - i} ${i} ${w - i} ${i + r}V${h - i - r}Q${w - i} ${h - i} ${w - i - r} ${h - i}H${i + r}Q${i} ${h - i} ${i} ${h - i - r}V${i + r}Q${i} ${i} ${i + r} ${i}Z`;
}

// An arrow from the facing side of one card to the facing side of another, as a soft S-curve,
// with a two-stroke head. mid is where a label sits.
export function arrow(a: Box, b: Box, seed: string) {
  const gap = 6;
  const j = rng(seed);
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  let p, q, c1, c2;
  if (Math.abs(dx) * 0.62 >= Math.abs(dy)) {
    const s = dx > 0 ? 1 : -1;
    p = { x: (s > 0 ? a.r : a.l) + gap * s, y: a.cy };
    q = { x: (s > 0 ? b.l : b.r) - gap * s, y: b.cy };
    const k = Math.max(24, Math.abs(q.x - p.x) * 0.5);
    c1 = { x: p.x + k * s, y: p.y + j() * 3 };
    c2 = { x: q.x - k * s, y: q.y + j() * 3 };
  } else {
    const s = dy > 0 ? 1 : -1;
    p = { x: a.cx, y: (s > 0 ? a.b : a.t) + gap * s };
    q = { x: b.cx, y: (s > 0 ? b.t : b.b) - gap * s };
    const k = Math.max(24, Math.abs(q.y - p.y) * 0.5);
    c1 = { x: p.x + j() * 3, y: p.y + k * s };
    c2 = { x: q.x + j() * 3, y: q.y - k * s };
  }
  const ang = Math.atan2(q.y - c2.y, q.x - c2.x);
  const head = (spread: number, len: number) => `${f(q.x - len * Math.cos(ang + spread))} ${f(q.y - len * Math.sin(ang + spread))}`;
  return {
    d: `M${f(p.x)} ${f(p.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(q.x)} ${f(q.y)}`,
    head: `M${head(-0.52 - j() * 0.05, 7.5 + j())} L${f(q.x)} ${f(q.y)} L${head(0.52 + j() * 0.05, 7.5 + j())}`,
    // the curve's point at t = 0.5
    mid: { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 },
    len: Math.hypot(q.x - p.x, q.y - p.y),
  };
}
