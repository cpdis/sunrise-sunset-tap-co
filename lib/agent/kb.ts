import type { KbPage } from "../types";

// The agent's knowledge base. Owners edit these in /admin/knowledge.
// Use {{price4}} style tokens for numbers that come from Settings.
export const DEFAULT_KB: KbPage[] = [
  {
    slug: "pricing",
    title: "Pricing and what's included",
    body: `- Half day (4 hours): {{price4}}. Full day (8 hours): {{price8}}.
- Includes delivery, setup, line test, pickup, glassware (120 pint and 60 schooner glasses), glass rinser, hand-wash sink with hot water, and the awning.
- Delivery is free within {{travelThresholdMin}} minutes of North Perth. Further out (e.g. Mandurah, Two Rocks) adds {{travelFee}}.
- A {{deposit}} deposit holds the date. The balance is charged automatically to the same card {{balanceDaysBefore}} days before the event.
- A {{bond}} bond is held on the card {{bondHoldDaysBefore}} days before and released after the truck comes back clean and undamaged.
- No hourly extensions on the day. If you need longer than 4 hours, book the 8-hour block.`,
  },
  {
    slug: "how-it-works",
    title: "How dry hire works",
    body: `- We are a dry hire. You supply the drinks, we supply the truck.
- You buy kegs from any brewery, distributor or bottle shop that sells kegs, at wholesale prices. We can recommend suppliers.
- On the day, an owner drives the truck to you, connects your kegs, sets the gas pressure, pours a test from every line, and shows a host how to change a keg. They come back at the end to collect.
- No staff stay for the event. If your venue needs a bartender with an RSA certificate, you organise one. We can recommend local bartenders.`,
  },
  {
    slug: "keg-guide",
    title: "Keg guide",
    body: `- Up to 8 taps. Most events use 4 to 6 lines: e.g. 2 lagers, 1 pale ale, 1 cider, 1 nitro cold brew, 1 soda water.
- Weight limit: the truck carries up to about 6 kegs of 30L or 10 of 19-20L, or 4 kegs of 50L. Mix sizes freely within that.
- Couplers: we carry S-type (most Australian beers, e.g. Gage Roads, Little Creatures, Feral, Swan), A-type (some imports) and G-type (Guinness and some UK beers). Tell us your kegs and we'll check.
- Kegs must be cold before they go in. Collect them the day before and keep them in a cool room or fridge. The truck holds them cold but can't chill warm kegs quickly.
- Rough guide: a 50L keg pours about 100 pints, a 30L about 60, a 20L about 40.
- Nitro cold brew from Filament Coffee comes in 19L kegs and pours on its own nitro line.`,
  },
  {
    slug: "rsa-licensing",
    title: "RSA and liquor licensing (WA)",
    body: `- We don't sell or supply alcohol, so we don't hold a liquor licence for your event.
- A private event where drinks are free for guests (e.g. most weddings and birthdays at a home or private property) usually needs no licence.
- If you sell drinks, charge entry that includes drinks, or hold a public event, you may need an occasional liquor licence from the WA Department of Local Government, Sport and Cultural Industries. Apply at least 14 days before (30 days for 500+ people).
- Many venues require RSA-certified bartenders. Check with your venue.
- This is general information, not legal advice. For anything unusual, ask the team.`,
  },
  {
    slug: "truck-spec",
    title: "The truck",
    body: `- 2018 Suzuki Carry kei truck with an insulated refrigerated box. About 3.4m long and 1.5m wide, so it fits through most garden gates and driveways that a small car fits through.
- 8 stainless flow-control taps, glass rinser, cup holders, hand-wash sink with pump and hot water, and a 2.5m roll-out awning.
- No mains power needed. The fridge runs off the truck.
- Needs flat, firm ground it can drive onto. It can't go on sand or soft lawn after rain.`,
  },
  {
    slug: "booking-policy",
    title: "Booking, changes and cancellations",
    body: `- Book up to {{bookAheadMonths}} months ahead, online or by text, email or phone.
- Holds last {{holdMinutes}} minutes until the deposit is paid.
- Cancel more than {{cancelDays}} days before for a full refund. Within {{cancelDays}} days, the deposit is kept and anything paid on top is refunded.
- Date changes are free more than {{cancelDays}} days out if the new date is free.
- One truck means one booking per day.`,
  },
  {
    slug: "service-area",
    title: "Where we go",
    body: `- Perth metro, the Swan Valley and Perth Hills, north to Two Rocks and south to Mandurah.
- Free delivery within {{travelThresholdMin}} minutes of North Perth. Further out costs {{travelFee}}.
- Not Margaret River, Busselton, Bunbury, Northam or York for now.`,
  },
  {
    slug: "about",
    title: "About us",
    body: `- Sunrise Sunset Tap Co. is owned by a group of Perth runners. It's named after the hill they run over on Wednesday mornings.
- We started because we wanted nitro cold brew after a dawn run and beer after a sunset one.
- Text {{sms}} or email {{email}}. A real person reads anything the agent can't answer.`,
  },
];
