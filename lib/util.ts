// Dates are stored as YYYY-MM-DD (Perth local) or ISO timestamps.

export const TZ = "Australia/Perth";

export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function perthHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
}

// A real calendar date in YYYY-MM-DD form. "2026-12-32" and "2026-11-21 " are not, and string compares on them
// would lie (a trailing space sorts after the plain date).
export function isISODate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Minutes after midnight for a real 24-hour "HH:MM", else undefined ("14:99", "7pm", "9:00").
export function timeMinutes(t: unknown): number | undefined {
  const m = typeof t === "string" ? t.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
}

export function weekday(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(date: string, opts: { dow?: boolean; year?: boolean } = {}): string {
  const d = new Date(date.slice(0, 10) + "T00:00:00Z");
  const s = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  const y = opts.year ? ` ${d.getUTCFullYear()}` : "";
  return opts.dow ? `${DOW[d.getUTCDay()]} ${s}${y}` : `${s}${y}`;
}

export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Short relative time for lists: "now", "12 min", "3 h", "2 d", then the date. The thread keeps absolute times.
export function fmtAgo(iso: string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return fmtDate(todayISO(new Date(iso)));
}

export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
}

export function money(n: number, cents = false): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}

export function quarterOf(date: string): { key: string; start: string; end: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  const sm = (q - 1) * 3 + 1;
  const start = `${y}-${String(sm).padStart(2, "0")}-01`;
  const end = addDays(addMonths(start, 3), -1);
  return { key: `${y}-Q${q}`, start, end };
}

export function quarterLabel(key: string): string {
  const [y, q] = key.split("-Q");
  const names = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];
  return `Q${q} ${y} (${names[Number(q) - 1]})`;
}

export function stripeFee(amount: number): number {
  // Stripe AU domestic card: 1.7% + 30c
  return Math.round((amount * 0.017 + 0.3) * 100) / 100;
}

// Random ids from the platform CSPRNG, so one id can't be guessed from another.
export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// A bearer secret for a link: 122 random bits, URL-safe.
export function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

// Compares two secrets in time that depends only on their length, so a wrong guess learns nothing from timing.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// One phone or email against another, ignoring spaces and case. A blank value matches nothing, so a
// customer with no email on file is never "the customer whose email is empty".
export function sameContact(a?: string, b?: string): boolean {
  const n = (x?: string) => (x ?? "").replace(/\s+/g, "").toLowerCase();
  return n(a) !== "" && n(a) === n(b);
}

export function cls(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
