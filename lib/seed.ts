// Builds a simulated first year of trading, relative to today, so the demo always looks current.
import { DEFAULT_SETTINGS, SUBURBS } from "./config";
import { DEFAULT_KB } from "./agent/kb";
import {
  TRUCK_COST,
  cancelBooking,
  completeBooking,
  computeDistribution,
  createHold,
  depreciate,
  payDeposit,
  payDistribution,
  post,
  runJobs,
} from "./domain";
import { returnedClean } from "./ops";
import type { Block, Conversation, Data, Owner, Scenario } from "./types";
import { addDays, addMonths, daysBetween, quarterOf, todayISO } from "./util";

export const DATA_VERSION = 7;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Sophie", "Liam", "Mia", "Jack", "Chloe", "Noah", "Grace", "Oliver", "Isla", "Lachlan", "Ruby", "Tom", "Zara", "Hamish", "Priya", "Ben", "Ella", "Sam", "Hannah", "Josh", "Amelia", "Kai", "Georgia", "Will"];
const LAST = ["Nguyen", "Smith", "Taylor", "Brown", "Wilson", "Kelly", "Murphy", "Chen", "Walker", "Harris", "Ryan", "Patel", "O'Brien", "Clarke", "Hughes", "Ward", "Moore", "Lee", "Fraser", "Baker"];
const EVENTS = ["Wedding", "Wedding", "Wedding", "Birthday", "Engagement", "Corporate", "Run club", "School fete", "Brewery launch", "Christmas party", "Market stall", "Sports club"];

export const OWNERS: Owner[] = [
  { id: "own_aaron", name: "Aaron", email: "aaron@sunrisesunsettapco.com", phone: "0400 111 201", shares: 1, isDirector: true, payoutAccount: "BSB 306-xxx ••• 4410", joined: "" },
  { id: "own_alex", name: "Alex", email: "alex@sunrisesunsettapco.com", phone: "0400 111 202", shares: 1, isDirector: true, payoutAccount: "BSB 016-xxx ••• 2738", joined: "" },
  { id: "own_joe", name: "Joe", email: "joe@sunrisesunsettapco.com", phone: "0400 111 203", shares: 1, isDirector: true, payoutAccount: "BSB 066-xxx ••• 9023", joined: "" },
  { id: "own_ming", name: "Ming", email: "ming@sunrisesunsettapco.com", phone: "0400 111 204", shares: 1, isDirector: true, payoutAccount: "BSB 062-xxx ••• 5164", joined: "" },
  { id: "own_colin", name: "Colin", email: "colin@sunrisesunsettapco.com", phone: "0400 111 205", shares: 1, isDirector: true, payoutAccount: "BSB 016-xxx ••• 1182", joined: "" },
  { id: "own_rhys", name: "Rhys", email: "rhys@sunrisesunsettapco.com", phone: "0400 111 206", shares: 1, isDirector: true, payoutAccount: "BSB 086-xxx ••• 3375", joined: "" },
  { id: "own_adam", name: "Adam", email: "adam@sunrisesunsettapco.com", phone: "0400 111 207", shares: 1, isDirector: true, payoutAccount: "BSB 182-xxx ••• 6651", joined: "" },
  { id: "own_shane", name: "Shane", email: "shane@sunrisesunsettapco.com", phone: "0400 111 208", shares: 1, isDirector: true, payoutAccount: "BSB 033-xxx ••• 8807", joined: "" },
  { id: "own_grant", name: "Grant", email: "grant@sunrisesunsettapco.com", phone: "0400 111 209", shares: 1, isDirector: true, payoutAccount: "BSB 484-xxx ••• 2096", joined: "" },
];

// Each owner puts in the same amount at the start.
export const CAPITAL_PER_OWNER = 3700;

// Demand and the bad luck that comes with it. Bull is the old optimistic year; base is what to plan on.
export const SCENARIOS: Record<Scenario, { label: string; demand: number; lateCancels: number; repair?: { amount: number; notes: string }; cardTrouble: number }> = {
  bear: { label: "Bear", demand: 0.48, lateCancels: 2, repair: { amount: 2500, notes: "Thermo King compressor replaced" }, cardTrouble: 2 },
  base: { label: "Base", demand: 0.78, lateCancels: 1, repair: { amount: 650, notes: "Thermo King fan motor and regas" }, cardTrouble: 1 },
  bull: { label: "Bull", demand: 1, lateCancels: 0, cardTrouble: 1 },
};

export function buildSeed(now = new Date(), scenario: Scenario = "base"): Data {
  const sc = SCENARIOS[scenario];
  const r = rng(20261022);
  const demandDraw = rng(1022);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const today = todayISO(now);
  const start = addDays(today, -365);
  const d: Data = {
    version: DATA_VERSION,
    seededAt: now.toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    owners: OWNERS.map((o) => ({ ...o, joined: start })),
    customers: [],
    bookings: [],
    payments: [],
    ledger: [],
    conversations: [],
    distributions: [],
    truck: [],
    kb: DEFAULT_KB.map((p) => ({ ...p })),
    blackouts: [],
    jobs: [],
    seq: 1000,
    scenario,
  };

  // Capital and setup.
  for (const o of d.owners) post(d, start, "capital", CAPITAL_PER_OWNER, `Capital contribution · ${o.name}`, undefined, o.id);
  post(d, addDays(start, 1), "accounting", -611, "ASIC company registration");
  post(d, addDays(start, 2), "truck", -TRUCK_COST, "2018 Suzuki Carry tap truck (112,215 km)");
  post(d, addDays(start, 9), "setup", -3800, "Box wrap, cab stripe and decals");
  post(d, addDays(start, 5), "setup", -640, "Glassware: 120 pint, 60 schooner");
  post(d, addDays(start, 5), "setup", -520, "Couplers (S, A, G), CO2 cylinder, regulators");
  d.truck.push(
    { id: "tl_1", date: addDays(start, 2), type: "purchase", notes: "Purchased from Wyld Nectar. Pre-purchase inspection passed.", odometer: 112215 },
    { id: "tl_2", date: addDays(start, 9), type: "service", notes: "Wrap installed. Thermo King serviced and regassed.", odometer: 112260 },
  );

  // Monthly fixed costs.
  for (let m = 0; m < 12; m++) {
    const day = addMonths(addDays(start, 3), m);
    post(d, day, "insurance", -150, "Public liability $20M + commercial vehicle");
    post(d, day, "rego", -58, "Rego (monthly)");
    post(d, day, "software", -87, "Twilio number, email, Claude API");
    post(d, day, "software", -32, "Vercel Pro (commercial use)");
    post(d, day, "marketing", -60, "Wedding directory listing");
    if (m % 3 === 2) post(d, day, "accounting", -450, "Accountant: quarterly bookkeeping review");
  }
  post(d, addDays(start, 330), "accounting", -1650, "Accountant: company tax return");
  for (let m = addMonths(start.slice(0, 7) + "-01", 1); m <= today; m = addMonths(m, 1)) depreciate(d, m);

  // Bookings across the year, busier in spring and summer.
  const seasonal = [1.6, 1.3, 1.2, 0.9, 0.6, 0.5, 0.5, 0.6, 0.9, 1.3, 1.5, 1.7]; // Jan..Dec
  const runners = d.owners.map((o) => o.id);
  const horizon = addMonths(today, 6);
  let cur = addDays(start, 21);
  let i = 0;
  let lateCancels = 0;
  while (cur < horizon) {
    const month = Number(cur.slice(5, 7)) - 1;
    const future = cur > today;
    // Future demand thins out further ahead.
    const decay = future ? Math.max(0.15, 1 - daysBetween(today, cur) / 200) : 1;
    const wd = new Date(cur + "T00:00:00Z").getUTCDay();
    const weekendBoost = wd === 6 ? 0.55 : wd === 0 ? 0.35 : wd === 5 ? 0.15 : 0.04;
    // Its own stream, so a busier scenario adds hires without reshuffling everything else.
    if (demandDraw() < weekendBoost * seasonal[month] * decay * sc.demand) {
      i++;
      const sub = r() < 0.08 ? pick(SUBURBS.filter((s) => s.minutes > 45)) : pick(SUBURBS.filter((s) => s.minutes <= 45));
      const block: Block = r() < 0.38 ? 4 : 8;
      const event = pick(EVENTS);
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const leadDays = 20 + Math.floor(r() * 120);
      const createdDay = addDays(cur, -leadDays);
      const created = new Date((createdDay < start ? start : createdDay) + "T09:30:00+08:00");
      // Spread anything that would be created in the future across the last fortnight.
      const createdAt = created > now ? new Date(now.getTime() - 86400000 * (1 + (i % 14))) : created;
      const via = pick(["web", "web", "sms", "sms", "sms", "email", "phone"] as const);
      const b = createHold(
        d,
        {
          date: cur,
          block,
          suburb: sub.name,
          startTime: block === 4 ? pick(["07:00", "10:00", "14:00", "16:00"]) : pick(["11:00", "12:00", "14:00"]),
          name,
          email: `${name.split(" ")[0].toLowerCase()}.${name.split(" ")[1].toLowerCase().replace("'", "")}@example.com`,
          phone: `04${Math.floor(10 + r() * 89)} ${Math.floor(100 + r() * 899)} ${Math.floor(100 + r() * 899)}`,
          eventType: event,
          guests: event === "Wedding" ? 80 + Math.floor(r() * 90) : 30 + Math.floor(r() * 80),
          via,
        },
        createdAt,
      );
      b.deliver.ownerId = pick(runners);
      b.collect.ownerId = pick(runners);
      if (future && daysBetween(today, cur) > 21 && r() < 0.35) {
        b.deliver.ownerId = undefined;
        if (r() < 0.6) b.collect.ownerId = undefined;
      }
      payDeposit(d, b.id, pick(["Visa •• 4242", "Mastercard •• 4444", "Visa •• 1881", "Amex •• 0005"]), createdAt, true);
      // A few cancellations: early ones get everything back, late ones forfeit the deposit.
      if (r() < 0.05 && !future && addDays(cur, -40) > createdAt.toISOString().slice(0, 10)) {
        cancelBooking(d, b.id, new Date(addDays(cur, -40) + "T10:00:00+08:00"));
        b.notes = "Cancelled more than 30 days out · deposit refunded";
      } else if (!future && lateCancels < sc.lateCancels && i % 9 === 4 && addDays(cur, -20) > createdAt.toISOString().slice(0, 10)) {
        lateCancels++;
        cancelBooking(d, b.id, new Date(addDays(cur, -20) + "T10:00:00+08:00"));
        b.notes = "Cancelled 20 days out · deposit kept";
      }
    }
    // Owner personal use, roughly monthly.
    if (!future && wd === 0 && r() < 0.08) {
      const o = pick(d.owners);
      d.bookings.push({
        id: `bk_p${i}${cur}`,
        ref: `OWN-${cur.slice(5).replace("-", "")}`,
        kind: "personal",
        ownerId: o.id,
        date: cur,
        block: 8,
        startTime: "06:00",
        suburb: "Mount Lawley",
        travelMinutes: 8,
        km: 4,
        price: 0,
        travelFee: 0,
        total: 0,
        deposit: 0,
        bond: 0,
        state: "completed",
        bondStatus: "none",
        createdAt: addDays(cur, -10) + "T08:00:00+08:00",
        createdVia: "admin",
        eventType: "Owner use",
        notes: `${o.name}: Wednesday hill run · cold brew for the club`,
        agreementSigned: true,
        deliver: { ownerId: o.id, done: true },
        collect: { ownerId: o.id, done: true },
      });
    }
    cur = addDays(cur, 1);
  }

  // Saved cards that will decline the balance, on hires whose balance falls due around now.
  // The first has already declined three times by today, so it shows up for an owner.
  d.bookings
    .filter((b) => b.kind === "paid" && b.state === "confirmed" && daysBetween(today, b.date) > 8)
    .sort((a, b) => Math.abs(daysBetween(today, a.date) - 10) - Math.abs(daysBetween(today, b.date) - 10))
    .slice(0, sc.cardTrouble)
    .forEach((b, n) => {
      b.cardDeclines = true;
      b.notes = n === 0 ? "Card on file expired" : "Card on file declines off-session charges";
    });

  // Replay scheduled jobs day by day for the past, so balances, bonds and closes post on the right dates.
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const at = new Date(day + "T07:00:00+08:00");
    for (const b of d.bookings) {
      if (b.state === "balance_paid" && b.date < day) completeBooking(d, b, b.date);
      // The owner who collected the truck checked it back clean, so past bonds are released.
      if (b.state === "completed" && b.bondStatus === "held") returnedClean(d, b.id, b.collect.ownerId ?? d.owners[0].id, at);
    }
    runJobs(d, at > now ? now : at);
  }

  // Two services and odometer readings.
  const totalKm = d.bookings.filter((b) => b.state === "completed").reduce((s, b) => s + b.km * 4, 0);
  post(d, addDays(start, 140), "maintenance", -480, "Service: oil, filters, brake check");
  post(d, addDays(start, 300), "maintenance", -520, "Service + tap rebuild kit");
  if (sc.repair) {
    post(d, addDays(start, 95), "maintenance", -sc.repair.amount, sc.repair.notes);
    d.truck.push({ id: "tl_r", date: addDays(start, 95), type: "incident", notes: `${sc.repair.notes} (${"$" + sc.repair.amount.toLocaleString()})` });
  }
  d.truck.push(
    { id: "tl_3", date: addDays(start, 140), type: "service", notes: "Logbook service. Front pads at 60%.", odometer: 112215 + Math.round(totalKm * 0.4) },
    { id: "tl_4", date: addDays(start, 300), type: "service", notes: "Logbook service. Rebuilt taps 3 and 6 (sticky).", odometer: 112215 + Math.round(totalKm * 0.85) },
    { id: "tl_5", date: addDays(today, -6), type: "clean", notes: "Full line clean, caustic + acid rinse. All 8 lines.", odometer: 112215 + Math.round(totalKm) },
  );

  // Quarterly distributions: completed quarters paid, the latest one awaiting approval.
  const quarters: string[] = [];
  let qd = quarterOf(start).end;
  while (qd < today) {
    const q = quarterOf(qd);
    if (q.start >= start || q.end > addDays(start, 45)) quarters.push(q.key);
    qd = addDays(q.end, 1);
    qd = quarterOf(qd).end;
  }
  quarters.forEach((key, idx) => {
    const dist = computeDistribution(d, key);
    d.distributions.push(dist);
    if (idx < quarters.length - 1) {
      dist.approvals = ["own_colin", "own_aaron"];
      payDistribution(d, dist.id, new Date(addDays(dist.end, 12) + "T10:00:00+08:00"));
    }
  });

  d.conversations = seedConversations(d, now);
  d.jobs = [{ at: now.toISOString(), text: `Demo data generated: one simulated year of trading (${sc.label.toLowerCase()} case)` }];
  return d;
}

function seedConversations(d: Data, now: Date): Conversation[] {
  const t = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60000).toISOString();
  const upcoming = d.bookings
    .filter((b) => b.kind === "paid" && b.state !== "cancelled" && b.date > todayISO(now))
    .sort((a, b) => a.date.localeCompare(b.date));
  const soon = upcoming[0];
  const soonCust = d.customers.find((c) => c.id === soon?.customerId);
  const convs: Conversation[] = [
    {
      id: "conv_1",
      channel: "sms",
      contact: soonCust?.phone ?? "0412 555 019",
      name: soonCust?.name ?? "Sophie Nguyen",
      customerId: soonCust?.id,
      agentActive: true,
      unread: false,
      state: {},
      messages: [
        { id: "m1", from: "customer", body: "Hey! What couplers do we need? Getting kegs from Gage Roads", at: t(300) },
        {
          id: "m2",
          from: "agent",
          body: "Gage Roads kegs use a standard Australian S-type coupler. We carry those, so you're sorted. Pick them up the day before and keep them cold.",
          at: t(299),
          tools: ["lookup_booking", "kb:keg-guide"],
        },
      ],
    },
    {
      id: "conv_2",
      channel: "email",
      contact: "events@harbourcollective.com.au",
      name: "Harbour Collective (events)",
      agentActive: false,
      escalated: "Asked for a 3-day festival rate and a sponsor wrap. Outside policy, so handed to a person.",
      draft: "Hi, thanks for thinking of us for the festival. We don't put sponsor branding on the truck, sorry. A three-day hire is one for the owners to work out, so tell me the dates, the site and the crowd you expect and I'll come back to you.",
      unread: true,
      state: {},
      messages: [
        { id: "m1", from: "customer", body: "Hi team, we're running a 3-day festival in Fremantle in March. Could we hire the truck for all three days, and could a sponsor's logo go on it?", at: t(180) },
        { id: "m2", from: "agent", body: "Thanks! Multi-day hire and sponsor branding need a person to approve. I've passed this to the owners with your dates, and someone will reply by tomorrow.", at: t(179), tools: ["check_availability", "escalate_to_owner"] },
        { id: "m3", from: "system", body: "Agent handed over: Asked for a 3-day festival rate and a sponsor wrap. Outside policy, so handed to a person.", at: t(179) },
      ],
    },
    {
      id: "conv_3",
      channel: "phone",
      contact: "0433 210 877",
      name: "Caller · 0433 210 877",
      agentActive: true,
      unread: false,
      state: {},
      messages: [
        { id: "m1", from: "system", body: "Voice call · 2m 41s · transcribed", at: t(1500) },
        { id: "m2", from: "customer", body: "Do you need power at the venue? We're on a farm in Baskerville.", at: t(1500) },
        { id: "m3", from: "agent", body: "No mains power needed. The fridge runs off the truck, and we just need flat ground the truck can drive onto. Baskerville is within the free delivery area.", at: t(1499), tools: ["kb:truck-spec", "quote"] },
      ],
    },
  ];
  return convs;
}
