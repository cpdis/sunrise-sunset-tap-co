// The record of how the proof of concept was made: the project threads, the pull requests and Colin's picks.
// This is history, not settings, so it is written down here. Times are Perth time (AWST, UTC+8).

export type Ref = { pr?: number; href?: string };

export interface Moment {
  at: string; // "2026-10-22 08:55", Perth time
  say: string;
  kind?: "pr" | "pick" | "start";
  pr?: number;
}

export const REPO = "https://github.com/cpdis/sunrise-sunset-tap-co";
export const pr = (n: number) => `${REPO}/pull/${n}`;

// Perth time to a Date
export const perth = (at: string) => new Date(at.replace(" ", "T") + ":00+08:00");

export const START = "2026-10-22 08:55";
export const ASKED = "2026-10-24 20:10";

export const moments: Moment[] = [
  { at: "2026-10-22 08:55", kind: "start", say: "Colin starts the project: a co-owned tap truck for Perth, hired out dry. Three rounds of questions set the business rules." },
  { at: "2026-10-22 09:52", kind: "pick", say: "The name: Sunrise Sunset Tap Co., after the hill the run club runs over on Wednesdays. Cold brew in the morning, beer at night." },
  { at: "2026-10-22 10:12", kind: "pick", say: "Buy nothing and set up nothing yet. The domain waits, and every payment, text and bank transfer is simulated." },
  { at: "2026-10-22 10:37", say: "The first build: the site, booking, the agent, a simulated checkout and the owners' admin. 45 files, 5,830 lines." },
  { at: "2026-10-22 10:43", say: "Fal connects through MCP, so threads can make images and video without an API key." },
  { at: "2026-10-22 10:55", say: "The first stills are fixed with image edits, and three video models make the first loops." },
  { at: "2026-10-22 11:09", say: "\"The design leaves a lot to be desired.\" Two directions come back: Golden Hour and Hill Repeats." },
  { at: "2026-10-22 11:21", kind: "pick", say: "Golden Hour for the site, with Hill Repeats for the admin." },
  { at: "2026-10-22 11:33", say: "The restyle lands. Seedance makes the Golden Hour loops." },
  { at: "2026-10-22 11:41", kind: "pick", say: "Video goes on hold. Two reviews start in parallel: one by Fable, one by Opus." },
  { at: "2026-10-22 12:13", say: "The copy deck: every string on the site, 428 of them, with 117 flagged for a look." },
  { at: "2026-10-22 12:55", kind: "pick", say: "11 judgement calls from the reviews. All owners are directors, the promised texts are cut, the rest take the default." },
  { at: "2026-10-22 13:56", kind: "pr", pr: 1, say: "#1 merges the review fixes: money held until the hire, runner fees, the agent's routing. 28 tests." },
  { at: "2026-10-22 13:57", kind: "pr", pr: 2, say: "#2 adds the repo's agent rules (AGENTS.md)." },
  { at: "2026-10-22 14:02", kind: "pr", pr: 5, say: "#4 and #5: Colin's copy edits, and delivery measured from the Perth CBD." },
  { at: "2026-10-22 14:46", kind: "pick", say: "Stills only for now: no runners in the hero, and all 8 taps on the truck's rear." },
  { at: "2026-10-22 15:20", kind: "pick", say: "Hero A2 and truck B1 from the third round of stills." },
  { at: "2026-10-22 15:55", say: "The new stills become Seedance loops." },
  { at: "2026-10-22 16:22", say: "Every owner goes into the demo as a director, with equal shares." },
  { at: "2026-10-22 16:43", say: "\"It feels more AI generated.\" Three hand-made options: Ticket, Hand-cut and Luggage label." },
  { at: "2026-10-22 17:20", kind: "pick", say: "Hand-cut." },
  { at: "2026-10-22 21:11", say: "Polish round 3. \"Text us\" becomes \"Chat\". An article on agent-native apps leads to an agent for the owners." },
  { at: "2026-10-22 21:42", kind: "pick", say: "The play and pause button comes off the loops. Colin accepts the WCAG 2.2.2 miss." },
  { at: "2026-10-22 21:46", kind: "pr", pr: 6, say: "#6 merges the polish pass and the rear-tap loops, with #7 Hand-cut inside it." },
  { at: "2026-10-22 22:34", kind: "pr", pr: 8, say: "#8: the owner SMS agent, with everything the admin can do. 40 tests." },
  { at: "2026-10-22 22:36", kind: "pr", pr: 9, say: "#9: the admin's type scale and sections." },
  { at: "2026-10-22 22:31", kind: "pick", say: "The inbox becomes a decision queue (option C)." },
  { at: "2026-10-22 23:19", kind: "pr", pr: 12, say: "#12: the hero and the Chat button line up with the page. Every CTA says Book." },
  { at: "2026-10-22 23:21", kind: "pr", pr: 13, say: "#13: Topaz Starlight restores the soft loops." },
  { at: "2026-10-23 12:21", say: "The demo moves to sunrisesunsettapco.cpd.dev, a subdomain. Still no domain bought." },
  { at: "2026-10-23 13:01", kind: "pr", pr: 14, say: "#14: the logo on the share image (option A)." },
  { at: "2026-10-23 13:22", kind: "pr", pr: 15, say: "#15: Vercel Web Analytics." },
  { at: "2026-10-23 14:01", say: "\"Too playful.\" The white console starts as a comparison." },
  { at: "2026-10-23 14:27", kind: "pick", say: "\"That's 100x better.\" The white console stays." },
  { at: "2026-10-23 14:48", kind: "pick", say: "Every recommendation in the reviews is accepted." },
  { at: "2026-10-23 14:51", kind: "pr", pr: 10, say: "#10: the inbox as a decision queue, with drafted replies." },
  { at: "2026-10-23 15:06", kind: "pr", pr: 11, say: "#11: the owner agent reads the same queue." },
  { at: "2026-10-23 15:22", kind: "pr", pr: 17, say: "#17: the owner admin as a white console." },
  { at: "2026-10-23 15:28", kind: "pick", say: "Shantell Sans for the diagrams on a new explainer." },
  { at: "2026-10-23 16:19", kind: "pick", say: "Claude Managed Agents: more than this needs. Keep the Messages API loop and Vercel Cron." },
  { at: "2026-10-23 16:38", kind: "pick", say: "Answer engine research. Keep the demo out of search until there is a real domain." },
  { at: "2026-10-23 17:09", kind: "pick", say: "The new goal: production grade and bulletproof, built so it could serve other businesses later." },
  { at: "2026-10-23 17:36", say: "The red team, run on Colin's Mac by three models: 3 critical and 12 high findings." },
  { at: "2026-10-23 18:03", say: "The fix plan: 5 reviewers, 33 findings, 13 corrections to the first plan." },
  { at: "2026-10-23 18:22", kind: "pick", say: "A demo for other businesses is out of scope. DEMO_MODE turns the demo parts on and off." },
  { at: "2026-10-23 20:42", kind: "pr", pr: 19, say: "#19, phase 1: the quick fixes. 173 tests. The 6 attacks it covers now fail." },
  { at: "2026-10-23 23:36", kind: "pick", say: "Neon for Postgres, not Supabase." },
  { at: "2026-10-23 23:38", say: "\"We built our own auth.\" Three models review it and find 17 holes, all fixed in the same PR." },
  { at: "2026-10-24 09:51", kind: "pick", say: "Production secrets made with openssl. Neon in Sydney, with Neon Auth off." },
  { at: "2026-10-24 14:24", say: "Each deploy runs its own database migrations first." },
  { at: "2026-10-24 14:45", kind: "pr", pr: 20, say: "#20, phase 2: data on the server, signed texts, owner sign-in and approvals. 360 tests." },
  { at: "2026-10-24 15:07", kind: "pr", pr: 18, say: "#18: the explainer and the business plan pages." },
  { at: "2026-10-24 20:10", kind: "start", say: "Colin asks for this page." },
].sort((a, b) => a.at.localeCompare(b.at)) as Moment[];

// Every pull request, as GitHub records it (UTC).
export interface PR {
  n: number;
  title: string;
  merged?: string;
  into?: number; // merged into another PR's branch
  closed?: boolean;
  tests?: number;
}

export const prs: PR[] = [
  { n: 1, title: "Review fixes: accounting, agent routing, accessibility", merged: "2026-10-22T05:56:11Z", tests: 28 },
  { n: 2, title: "Repo agent rules (AGENTS.md)", merged: "2026-10-22T05:57:11Z" },
  { n: 3, title: "Copy edits from the copy deck", merged: "2026-10-22T05:56:28Z", into: 1 },
  { n: 4, title: "Copy edits to main", merged: "2026-10-22T05:58:57Z" },
  { n: 5, title: "Delivery measured from the Perth CBD", merged: "2026-10-22T06:02:18Z" },
  { n: 6, title: "Site and admin polish, rear-tap loops", merged: "2026-10-22T13:46:31Z" },
  { n: 7, title: "Hand-cut form for the public site", merged: "2026-10-22T13:17:03Z", into: 6 },
  { n: 8, title: "Owner SMS agent", merged: "2026-10-22T14:34:27Z", tests: 40 },
  { n: 9, title: "Admin type scale and sections", merged: "2026-10-22T14:36:00Z" },
  { n: 12, title: "Hero and Chat to page width, CTAs say Book", merged: "2026-10-22T15:19:49Z" },
  { n: 13, title: "Hero and Truck loops restored with Starlight", merged: "2026-10-22T15:21:27Z" },
  { n: 14, title: "Logo on the share image", merged: "2026-10-23T05:01:43Z" },
  { n: 15, title: "Vercel Web Analytics", merged: "2026-10-23T05:22:10Z" },
  { n: 16, title: "Payback chart type", closed: true },
  { n: 10, title: "Inbox as a decision queue", merged: "2026-10-23T06:51:35Z", tests: 49 },
  { n: 11, title: "Owner SMS mirrors the queue", merged: "2026-10-23T07:06:24Z", tests: 57 },
  { n: 17, title: "Owner admin as a white console", merged: "2026-10-23T07:22:34Z" },
  { n: 19, title: "Hardening, phase 1", merged: "2026-10-23T12:42:10Z", tests: 173 },
  { n: 20, title: "Server-owned state, signed inbound, owner approvals", merged: "2026-10-24T06:45:41Z", tests: 360 },
  { n: 18, title: "How it works and business plan pages", merged: "2026-10-24T07:07:31Z" },
];

// Tests in the suite as each PR merged.
export const testsBy = prs.filter((p) => p.tests).map((p) => ({ label: `#${p.n}`, n: p.tests! }));

// Diff size of the larger PRs, from GitHub.
export const diffs = [
  { n: 1, add: 3306, del: 693 },
  { n: 8, add: 1215, del: 0 },
  { n: 17, add: 1227, del: 839 },
  { n: 19, add: 2442, del: 371 },
  { n: 20, add: 12572, del: 1904 },
  { n: 18, add: 2186, del: 0 },
];

// The decision cards Colin answered, with what was recommended. "own" means he chose it without a card.
export interface Pick {
  at: string;
  q: string;
  pick: string;
  rec?: string; // set when Colin went another way
  own?: boolean;
  area: "Business" | "Design" | "Imagery" | "Build" | "Hosting";
}

export const picks: Pick[] = [
  { at: "2026-10-22 09:52", area: "Business", q: "The name", pick: "Sunrise Sunset Tap Co." , own: true },
  { at: "2026-10-22 10:12", area: "Hosting", q: "Buy the domain now?", pick: "Buy nothing and set up nothing yet", rec: "Buy the domain" },
  { at: "2026-10-22 10:38", area: "Hosting", q: "Where to put the demo", pick: "Deploy to a vercel.app address" },
  { at: "2026-10-22 11:21", area: "Design", q: "Golden Hour or Hill Repeats", pick: "Golden Hour for the site, Hill Repeats for the admin", rec: "A, Golden Hour" },
  { at: "2026-10-22 11:41", area: "Imagery", q: "More video now?", pick: "Put all video on hold", own: true },
  { at: "2026-10-22 12:55", area: "Business", q: "Who can approve a payout", pick: "Every owner is a director", rec: "Three directors" },
  { at: "2026-10-22 12:55", area: "Business", q: "Texts the site promises but never sends", pick: "Cut the lines", rec: "Simulate them" },
  { at: "2026-10-22 12:55", area: "Business", q: "The other 9 judgement calls", pick: "Defaults: 7 days' notice, 11 pm finish, one hire a day, money held until the hire, runner fees paid quarterly, retry a failed balance for 3 days" },
  { at: "2026-10-22 14:46", area: "Imagery", q: "Stills first, or stills and video together?", pick: "Stills only, then video once they are approved" },
  { at: "2026-10-22 14:46", area: "Imagery", q: "What the hero shows", pick: "No runners in the hero, 8 taps on the rear", own: true },
  { at: "2026-10-22 15:20", area: "Imagery", q: "Which stills", pick: "A2 for the hero, B1 for the truck" },
  { at: "2026-10-22 17:20", area: "Design", q: "Ticket, Hand-cut or Luggage label", pick: "Hand-cut", rec: "Ticket" },
  { at: "2026-10-22 21:11", area: "Design", q: "The site's chat button", pick: "\"Chat\", which opens the SMS demo. No web chat.", own: true },
  { at: "2026-10-22 21:42", area: "Design", q: "Play and pause on the loops", pick: "Remove it, and accept the WCAG 2.2.2 miss", own: true },
  { at: "2026-10-22 21:51", area: "Imagery", q: "Wrap the Marketplace photos for the plan (about $2)", pick: "Go" },
  { at: "2026-10-22 22:31", area: "Design", q: "Inbox: tidy, split or queue", pick: "C, a decision queue with drafted replies" },
  { at: "2026-10-22 23:06", area: "Imagery", q: "How to fix the soft loops", pick: "Topaz Starlight Precise 2.6 (about $1.70)" },
  { at: "2026-10-23 12:55", area: "Design", q: "Share image", pick: "Option A, the logo on the hero" },
  { at: "2026-10-23 14:10", area: "Design", q: "Font for the white admin", pick: "Geist" },
  { at: "2026-10-23 14:27", area: "Design", q: "White console or Hill Repeats admin", pick: "The white console", own: true },
  { at: "2026-10-23 14:48", area: "Build", q: "The design reviews' findings", pick: "Accept every recommendation", own: true },
  { at: "2026-10-23 15:28", area: "Design", q: "Font for the diagrams", pick: "Shantell Sans, for diagrams and margin notes only" },
  { at: "2026-10-23 16:32", area: "Business", q: "How the explainer talks about owners", pick: "Never state how many. The byline says \"For review\".", own: true },
  { at: "2026-10-23 16:38", area: "Hosting", q: "Search engines", pick: "Keep the demo out of search until a real domain" },
  { at: "2026-10-23 17:09", area: "Build", q: "How good the system has to be", pick: "Production grade, built so it could serve other businesses later", own: true },
  { at: "2026-10-23 18:22", area: "Build", q: "A demo for other businesses", pick: "Out of scope, and out of the business plan", own: true },
  { at: "2026-10-23 18:24", area: "Build", q: "Effort per unit of work", pick: "Extra High for the hard units, Medium for the small ones", own: true },
  { at: "2026-10-23 23:36", area: "Hosting", q: "Hosted Postgres", pick: "Neon, not Supabase" },
  { at: "2026-10-24 09:51", area: "Hosting", q: "Database set-up", pick: "Neon in Sydney, Neon Auth off", own: true },
];

// The business rules from the first three rounds of questions.
export const rules = [
  "A Pty Ltd, and every owner is a director",
  "Dry hire: the client buys the drinks, we bring the truck",
  "No staff. Owners run deliveries and are paid a runner fee for each",
  "4 or 8 hours, a deposit now, the balance before, a bond hold",
  "A travel fee more than an hour from the Perth CBD",
  "7 days' notice, up to 6 months ahead, one hire a day, done by 11 pm",
  "More than 30 days out, a full refund. Inside 30, the deposit is kept",
  "A paid booking beats an owner's own use",
  "Payouts each quarter. Every owner sees everything",
  "The agent may confirm a booking and take payment by text",
  "Texts first, then email, phone and the web form. No web chat",
  "Glassware included, no add-ons",
];

// Video models, side by side on the same two stills (22 Oct).
export const bakeoff = {
  models: ["Kling v3 Pro", "Gemini Omni Flash 1.1", "Seedance 2.5"],
  rows: [
    { shot: "Wedding", imgs: ["v-wedding-kling", "v-wedding-gemini-omni", "v-wedding-seedance"], say: ["Strongest overall", "Best on this shot", "Solid"] },
    { shot: "Run club", imgs: ["v-runclub-kling", "v-runclub-gemini-omni", "v-runclub-seedance"], say: ["Strongest overall", "The truck's box vanishes mid-clip", "Solid"] },
  ],
};
