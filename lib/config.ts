import type { Settings } from "./types";

export const BUSINESS = {
  name: "Sunrise Sunset Tap Co.",
  short: "Sunrise Sunset",
  sms: "0480 016 450",
  email: "hello@sunrisesunsettapco.com",
  // Delivery is measured from here. The truck itself is kept at Filament (Osborne Park) or in North Perth.
  base: "Perth CBD",
  abn: "[ABN pending]",
};

export const DEFAULT_SETTINGS: Settings = {
  price4: 600,
  price8: 1000,
  deposit: 250,
  bond: 300,
  travelFee: 150,
  travelThresholdMin: 60,
  runnerFee: 60,
  balanceDaysBefore: 14,
  bondHoldDaysBefore: 2,
  cancelDays: 30,
  holdMinutes: 30,
  minNoticeDays: 7,
  bookAheadMonths: 6,
  reserveMonths: 3,
  fixedMonthly: 295,
  maintPerKm: 0.12,
  taxRate: 0.25,
  refundLimit: 250,
  approvalsRequired: 2,
};

// The settings an owner can edit, grouped as on /admin/settings. The owner SMS agent uses the same labels.
export const SETTING_GROUPS: { title: string; fields: { k: keyof Settings; label: string; unit?: string }[] }[] = [
  {
    title: "Prices",
    fields: [
      { k: "price4", label: "4-hour block", unit: "$" },
      { k: "price8", label: "8-hour block", unit: "$" },
      { k: "deposit", label: "Deposit", unit: "$" },
      { k: "bond", label: "Bond", unit: "$" },
      { k: "travelFee", label: "Travel fee", unit: "$" },
      { k: "travelThresholdMin", label: "Travel fee applies beyond", unit: "min" },
    ],
  },
  {
    title: "Booking rules",
    fields: [
      { k: "bookAheadMonths", label: "Book ahead up to", unit: "months" },
      { k: "holdMinutes", label: "Unpaid holds expire after", unit: "min" },
      { k: "minNoticeDays", label: "Online bookings need at least", unit: "days notice" },
      { k: "balanceDaysBefore", label: "Charge balance", unit: "days before" },
      { k: "bondHoldDaysBefore", label: "Hold bond", unit: "days before" },
      { k: "cancelDays", label: "Full refund if cancelled more than", unit: "days out" },
      { k: "refundLimit", label: "Agent can refund up to", unit: "$" },
    ],
  },
  {
    title: "Owners and payouts",
    fields: [
      { k: "runnerFee", label: "Runner fee per delivery or pickup", unit: "$" },
      { k: "approvalsRequired", label: "Approvals to pay a distribution", unit: "owners" },
      { k: "taxRate", label: "Tax provision", unit: "0–1" },
      { k: "reserveMonths", label: "Reserve: fixed costs", unit: "months" },
      { k: "fixedMonthly", label: "Fixed costs per month", unit: "$" },
      { k: "maintPerKm", label: "Maintenance reserve", unit: "$/km" },
    ],
  },
];

// Guardrails stay in the logged-in admin: over SMS, one owner could otherwise lower the approvals needed or raise the
// agent's refund limit and then act alone.
export const ADMIN_ONLY_SETTINGS: (keyof Settings)[] = ["approvalsRequired", "refundLimit"];

// Approximate one-way drive time from the Perth CBD at weekend traffic.
// Anything not listed is assumed to be outside the service area.
export const SUBURBS: { name: string; minutes: number; km: number }[] = [
  { name: "Perth CBD", minutes: 5, km: 2 },
  { name: "Northbridge", minutes: 5, km: 2 },
  { name: "Leederville", minutes: 8, km: 4 },
  { name: "Mount Lawley", minutes: 8, km: 4 },
  { name: "Highgate", minutes: 6, km: 3 },
  { name: "West Perth", minutes: 5, km: 2 },
  { name: "Kings Park", minutes: 7, km: 3 },
  { name: "Crawley", minutes: 10, km: 6 },
  { name: "Wembley", minutes: 12, km: 7 },
  { name: "Floreat", minutes: 15, km: 10 },
  { name: "Inglewood", minutes: 11, km: 7 },
  { name: "Morley", minutes: 15, km: 10 },
  { name: "Subiaco", minutes: 10, km: 5 },
  { name: "Nedlands", minutes: 14, km: 8 },
  { name: "Claremont", minutes: 17, km: 11 },
  { name: "Cottesloe", minutes: 20, km: 14 },
  { name: "Mosman Park", minutes: 22, km: 15 },
  { name: "Fremantle", minutes: 25, km: 19 },
  { name: "East Fremantle", minutes: 23, km: 17 },
  { name: "South Perth", minutes: 10, km: 6 },
  { name: "Victoria Park", minutes: 10, km: 6 },
  { name: "Como", minutes: 13, km: 8 },
  { name: "Applecross", minutes: 16, km: 10 },
  { name: "Scarborough", minutes: 22, km: 15 },
  { name: "City Beach", minutes: 18, km: 12 },
  { name: "Joondalup", minutes: 33, km: 29 },
  { name: "Hillarys", minutes: 30, km: 25 },
  { name: "Bayswater", minutes: 13, km: 8 },
  { name: "Maylands", minutes: 10, km: 6 },
  { name: "Bassendean", minutes: 19, km: 12 },
  { name: "Guildford", minutes: 22, km: 15 },
  { name: "Midland", minutes: 25, km: 18 },
  { name: "Caversham", minutes: 27, km: 20 },
  { name: "Henley Brook", minutes: 34, km: 26 },
  { name: "Swan Valley", minutes: 34, km: 26 },
  { name: "Herne Hill", minutes: 32, km: 24 },
  { name: "Baskerville", minutes: 36, km: 28 },
  { name: "Kalamunda", minutes: 33, km: 24 },
  { name: "Mundaring", minutes: 42, km: 35 },
  { name: "Armadale", minutes: 36, km: 29 },
  { name: "Cannington", minutes: 17, km: 12 },
  { name: "Canning Vale", minutes: 23, km: 18 },
  { name: "Cockburn Central", minutes: 24, km: 21 },
  { name: "Rockingham", minutes: 44, km: 43 },
  { name: "Baldivis", minutes: 48, km: 48 },
  { name: "Mandurah", minutes: 61, km: 70 },
  { name: "Falcon", minutes: 68, km: 77 },
  { name: "Yanchep", minutes: 59, km: 62 },
  { name: "Two Rocks", minutes: 66, km: 68 },
];

export function findSuburb(name: string) {
  const n = name.trim().toLowerCase();
  return SUBURBS.find((s) => s.name.toLowerCase() === n);
}

export const START_TIMES = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];

// Taps close by this hour (24h clock), so the latest start depends on the block.
export const LATEST_FINISH = 23;

export function startTimesFor(block: 4 | 8) {
  return START_TIMES.filter((t) => Number(t.slice(0, 2)) + block <= LATEST_FINISH);
}

// A requested start time if it fits the block, otherwise the latest one that does.
export function fitStart(block: 4 | 8, t: string) {
  const h = Number(t.slice(0, 2));
  const latest = LATEST_FINISH - block;
  if (h < 6) return "06:00";
  return h > latest ? `${String(latest).padStart(2, "0")}:00` : t;
}
