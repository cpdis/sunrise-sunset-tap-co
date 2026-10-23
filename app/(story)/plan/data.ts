// The business plan's numbers, from the demo's seeded year (one per scenario) at the explainer's fixed date.
// v1 of the plan (22 Oct 2026) was written from the same seeds, so these reproduce it until lib/ changes.
import { DEFAULT_SETTINGS } from "@/lib/config";
import { TRUCK_DEPRECIATION_MONTHLY, cashAt, balance, periodTotals } from "@/lib/domain";
import { CAPITAL_PER_OWNER, buildSeed } from "@/lib/seed";
import type { Account, Scenario } from "@/lib/types";
import { todayISO } from "@/lib/util";
import { STORY_NOW } from "../how-it-works/data";

const PER_HIRE: Account[] = ["runner_fees", "co2", "fuel", "cleaning", "breakage", "stripe_fees", "refunds", "bond"];
const FIXED: Account[] = ["insurance", "rego", "software", "marketing", "accounting"];

function year(sc: Scenario) {
  const d = buildSeed(STORY_NOW, sc);
  const start = d.ledger[0].date;
  const end = todayISO(STORY_NOW);
  const inYear = d.ledger.filter((e) => e.date >= start && e.date <= end);
  const sum = (accts: Account[]) => -Math.round(inYear.filter((e) => accts.includes(e.account)).reduce((s, e) => s + e.amount, 0));
  const hires = d.bookings.filter((b) => b.kind === "paid" && b.state === "completed");
  const t = periodTotals(d, start, end);
  return {
    hires: hires.length,
    h4: hires.filter((b) => b.block === 4).length,
    h8: hires.filter((b) => b.block === 8).length,
    revenue: Math.round(t.revenue),
    perHire: sum(PER_HIRE),
    fixed: sum(FIXED),
    repairs: sum(["maintenance"]),
    depreciation: sum(["depreciation"]),
    profit: Math.round(t.profit),
    cash: Math.round(cashAt(d)),
    held: Math.round(balance(d, "deposits")),
    // dividends paid or proposed for the year, per owner
    payoutEach: d.distributions.reduce((s, x) => s + (x.lines[0]?.amount ?? 0), 0),
  };
}

export function planData() {
  const d = buildSeed(STORY_NOW);
  const s = DEFAULT_SETTINGS;
  const owners = d.owners.length;
  const capital = CAPITAL_PER_OWNER * owners;
  // The start-up spend is the first fortnight of the ledger: company registration, the truck and the fit-out.
  const startup = d.ledger
    .filter((e) => e.account === "truck" || e.account === "setup" || e.memo.startsWith("ASIC"))
    .filter((e) => e.amount < 0 && e.memo !== "Truck depreciation (8-year straight line)")
    .map((e) => ({ item: e.memo, amount: -e.amount }));
  const spent = startup.reduce((x, e) => x + e.amount, 0);
  const sc = { bear: year("bear"), base: year("base"), bull: year("bull") };
  const b = sc.base;
  // Break-even: hires needed for each hire's margin to cover the year's fixed costs, repairs and depreciation.
  const margin = (b.revenue - b.perHire) / b.hires;
  const breakEven = Math.round((b.fixed + b.repairs + b.depreciation) / margin);
  // Capital back: cash the year generates (after tax, depreciation added back as it is not spent).
  const yearsBack = capital / (b.profit * (1 - s.taxRate) + b.depreciation);
  return {
    s,
    owners,
    names: d.owners.map((o) => o.name),
    perOwner: CAPITAL_PER_OWNER,
    capital,
    startup,
    spent,
    left: capital - spent,
    sc,
    breakEven,
    yearsBack: Math.round(yearsBack),
    runnerEach: Math.round((b.hires * 2 * s.runnerFee) / owners),
    depreciationYear: Math.round(TRUCK_DEPRECIATION_MONTHLY * 12),
  };
}
