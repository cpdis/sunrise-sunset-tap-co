import type { Settings } from "./types";

export const BUSINESS = {
  name: "Sunrise Sunset Tap Co.",
  short: "Sunrise Sunset",
  sms: "0480 016 450",
  email: "hello@sunrisesunsettapco.com",
  base: "North Perth",
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

// Approximate one-way drive time from the base (North Perth) at weekend traffic.
// Anything not listed is assumed to be outside the service area.
export const SUBURBS: { name: string; minutes: number; km: number }[] = [
  { name: "Perth CBD", minutes: 10, km: 5 },
  { name: "Northbridge", minutes: 8, km: 4 },
  { name: "Leederville", minutes: 8, km: 4 },
  { name: "Mount Lawley", minutes: 8, km: 4 },
  { name: "Highgate", minutes: 6, km: 3 },
  { name: "West Perth", minutes: 8, km: 4 },
  { name: "Kings Park", minutes: 12, km: 6 },
  { name: "Crawley", minutes: 16, km: 9 },
  { name: "Wembley", minutes: 12, km: 6 },
  { name: "Floreat", minutes: 16, km: 9 },
  { name: "Inglewood", minutes: 8, km: 4 },
  { name: "Morley", minutes: 12, km: 7 },
  { name: "Subiaco", minutes: 14, km: 8 },
  { name: "Nedlands", minutes: 20, km: 12 },
  { name: "Claremont", minutes: 22, km: 14 },
  { name: "Cottesloe", minutes: 25, km: 16 },
  { name: "Mosman Park", minutes: 26, km: 17 },
  { name: "Fremantle", minutes: 30, km: 21 },
  { name: "East Fremantle", minutes: 28, km: 19 },
  { name: "South Perth", minutes: 15, km: 9 },
  { name: "Victoria Park", minutes: 15, km: 9 },
  { name: "Como", minutes: 18, km: 11 },
  { name: "Applecross", minutes: 22, km: 14 },
  { name: "Scarborough", minutes: 20, km: 13 },
  { name: "City Beach", minutes: 20, km: 12 },
  { name: "Joondalup", minutes: 30, km: 26 },
  { name: "Hillarys", minutes: 28, km: 22 },
  { name: "Bayswater", minutes: 12, km: 7 },
  { name: "Maylands", minutes: 10, km: 6 },
  { name: "Bassendean", minutes: 18, km: 12 },
  { name: "Guildford", minutes: 22, km: 15 },
  { name: "Midland", minutes: 25, km: 18 },
  { name: "Caversham", minutes: 26, km: 20 },
  { name: "Henley Brook", minutes: 32, km: 25 },
  { name: "Swan Valley", minutes: 32, km: 25 },
  { name: "Herne Hill", minutes: 30, km: 23 },
  { name: "Baskerville", minutes: 34, km: 27 },
  { name: "Kalamunda", minutes: 35, km: 26 },
  { name: "Mundaring", minutes: 42, km: 34 },
  { name: "Armadale", minutes: 40, km: 32 },
  { name: "Cannington", minutes: 22, km: 14 },
  { name: "Canning Vale", minutes: 28, km: 22 },
  { name: "Cockburn Central", minutes: 30, km: 25 },
  { name: "Rockingham", minutes: 48, km: 46 },
  { name: "Baldivis", minutes: 52, km: 52 },
  { name: "Mandurah", minutes: 65, km: 72 },
  { name: "Falcon", minutes: 72, km: 80 },
  { name: "Yanchep", minutes: 55, km: 58 },
  { name: "Two Rocks", minutes: 62, km: 64 },
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
