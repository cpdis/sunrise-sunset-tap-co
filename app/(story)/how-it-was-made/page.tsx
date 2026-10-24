import type { Metadata } from "next";
import Link from "next/link";
import { Compare, Gantt, type Img, type Row, Views } from "@/components/story/Made";
import { Note, Term } from "@/components/story/Marks";
import { Sketch } from "@/components/story/Sketch";
import { ASKED, START, bakeoff, diffs, moments, perth, picks, pr, prs, REPO, rules, spend, testsBy, threads } from "./data";
import { growth, setup } from "./diagrams";

export const metadata: Metadata = {
  title: "How this was made · Sunrise Sunset Tap Co.",
  description: "Three days from a first message to a hardened proof of concept: the tools and models, the design changes, the decisions and the timeline.",
};

// Every image on the page, with its size, so the layout doesn't jump while they load.
const SIZES: Record<string, [number, number]> = {
  "v1-home": [1200, 750], "v1-today": [1200, 750], "v1-inbox": [1200, 750], "v2-home": [1200, 750], "v2-today": [1200, 750],
  "white-today": [1200, 750], "pr9-today": [900, 860], "inbox-chat": [1200, 750], "inbox-queue": [1200, 750], "inbox-console": [1200, 750],
  "home-runners": [900, 720], "home-reartaps": [900, 720], "home-handcut": [1200, 750], "handmade-hero": [1200, 1252], "how-it-works": [1000, 1111],
  "dl-a-hero": [1100, 614], "dl-b-hero": [1100, 614], "dl-a-wrap": [1100, 614], "dl-b-wrap": [1100, 614], "dl-a-dusk": [1100, 614],
  "dl-a1-gpt": [700, 1050], "dl-a1-nb": [700, 1043], "photo-wedding": [1200, 675], "photo-wedding-fixed": [1200, 670],
  "photo-runclub": [1200, 675], "photo-runclub-fixed": [1200, 675], "stills-v3": [1400, 281], "upscale-zoom": [1400, 525], "og-a": [1000, 525],
  "truck-raw": [1000, 974], "truck-wrapped": [1000, 974],
  "v-wedding-kling": [800, 445], "v-wedding-gemini-omni": [800, 451], "v-wedding-seedance": [800, 447],
  "v-runclub-kling": [800, 451], "v-runclub-gemini-omni": [800, 451], "v-runclub-seedance": [800, 451],
  "v-gh-am-kling": [800, 445], "v-gh-am-seedance": [800, 447], "v-gh-am-starlight": [800, 447],
};
const im = (name: string, alt: string, cap?: string): Img => ({ src: `/made/${name}.jpg`, alt, cap, w: SIZES[name][0], h: SIZES[name][1] });

const fmtDay = (at: string) => perth(at).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Perth" });

export default function HowItWasMade() {
  const merged = prs.filter((p) => p.merged).length;
  const hours = Math.round((perth(ASKED).getTime() - perth(START).getTime()) / 36e5);
  const yours = picks.filter((p) => p.rec).length;
  const carded = picks.filter((p) => !p.own).length;
  const maxTests = Math.max(...testsBy.map((x) => x.n));
  const maxDiff = Math.max(...diffs.map((d) => d.add + d.del));
  const rows: Row[] = threads.map((t) => ({
    ...t,
    prs: (t.prs ?? []).map((n) => {
      const p = prs.find((x) => x.n === n);
      const note = !p ? "open, this PR" : p.closed ? "closed" : p.into ? `merged into #${p.into}` : undefined;
      return { n, title: p?.title ?? "How this was made page", at: p?.merged, href: pr(n), note };
    }),
  }));
  const days = [...new Set(moments.map((m) => m.at.slice(0, 10)))];

  // Token spend: totals, the biggest threads, then the rest and the coordinator as sums.
  const sum = (xs: typeof spend, k: "cacheRead" | "cacheWrite" | "input" | "output" | "cost") => xs.reduce((a, x) => a + x[k], 0);
  const cost = sum(spend, "cost"), out = sum(spend, "output");
  const read = sum(spend, "cacheRead") + sum(spend, "cacheWrite") + sum(spend, "input");
  const cached = Math.round((sum(spend, "cacheRead") / read) * 100);
  const work = spend.filter((x) => !x.coord).sort((a, b) => b.cost - a.cost);
  const top = work.slice(0, 10), rest = work.slice(10), coords = spend.filter((x) => x.coord);
  const maxCost = Math.max(top[0].cost, sum(rest, "cost"), sum(coords, "cost"));
  const byModel = (["opus", "fable"] as const).map((m) => {
    const xs = spend.filter((x) => x.model === m);
    return { m, n: xs.length, cost: sum(xs, "cost"), out: sum(xs, "output") };
  });
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const mil = (n: number) => `${(n / 1e6).toFixed(n < 1e7 ? 2 : 0)}M`;

  return (
    <article className="col">
      <h1>How this was made</h1>
      <p className="byline">For review · proof of concept · 24 October 2026</p>

      <p>The tap truck&apos;s demo, its explainer and its business plan were made in {hours} hours, from the first message on the morning of 22 October to this page. Nobody wrote code by hand. Colin asked for things in plain words and made the calls. Claude wrote the code, the copy and the plan, and other models made the pictures and reviewed the work.</p>
      <p>This page is the record. It shows how the work is set up, which tools and models did what, how the look changed, how the system grew, how it was hardened, and every decision made on the way.</p>

      <ul className="stats">
        <li><b className="num">{hours} h</b><span>first message to this page</span></li>
        <li><b className="num">{prs.length}</b><span>pull requests, {merged} merged</span></li>
        <li><b className="num">{maxTests}</b><span>tests, from none on day one</span></li>
        <li><b className="num">{picks.length}</b><span>decisions, {carded} of them on a card</span></li>
      </ul>

      <h2 id="timeline">Timeline</h2>
      <p>Each piece of work ran in its own thread, and many ran side by side. Every bar is one thread, from its first message to its last, in Perth time. Gold dots are pull requests merging. Press a row to see what it made.</p>
      <div className="wide">
        <Gantt rows={rows} from="2026-10-22T00:00:00Z" to="2026-10-24T14:00:00Z" />
      </div>
      <details className="long log">
        <summary>The full log, hour by hour</summary>
        {days.map((d) => (
          <div key={d}>
            <h4>{perth(d + " 12:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Perth" })}</h4>
            <ul className="day">
              {moments.filter((m) => m.at.startsWith(d)).map((m, k) => (
                <li key={k} className={m.kind ?? ""}>
                  <time>{m.at.slice(11)}</time>
                  <span>{m.pr ? <a href={pr(m.pr)}>{m.say}</a> : m.say}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>

      <h2 id="setup">How the work is set up</h2>
      <div className="blk out">
        <Sketch cfg={setup} />
      </div>
      <p>Everything happens in one Claude project. Requests go to a <Term sketch="setup" nodes="coord" edges="colin>coord">coordinator</Term> in the project chat. The coordinator starts a <Term sketch="setup" nodes="threads" edges="coord>threads">thread</Term> for each job, and each thread is a Claude Code session in its own cloud container with the repo cloned. Threads run in parallel, often several at once, and each one only knows what its brief and project memory tell it.</p>
      <p>Each thread works the same way. It posts a checklist, does the work, runs <code>npm run typecheck &amp;&amp; npm test &amp;&amp; npm run build</code>, takes screenshots at 375, 768 and 1440 px for any UI change, and opens a <Term sketch="setup" nodes="pr,preview" edges="threads>pr,pr>preview">pull request</Term>. A person opens the preview and merges. Nothing reaches main any other way.</p>
      <p>When a choice changes the goal, a person makes it. The thread posts a <Term sketch="setup" nodes="cards" edges="threads>cards">decision card</Term> with a recommended option and keeps working on that option while it waits. Picks go into <Term sketch="setup" nodes="memory" edges="threads>memory">project memory</Term>, so the next thread starts with them. The repo&apos;s own rules are in <a href={`${REPO}/blob/main/AGENTS.md`}>AGENTS.md</a>, added in <a href={pr(2)}>#2</a> on the first day.</p>

      <h2 id="tools">Tools and models</h2>
      <div className="blk out">
        <div className="panel scrollx">
          <table className="tbl">
            <thead><tr><th>Tool or model</th><th>What it did here</th></tr></thead>
            <tbody>
              <tr><td><b>Claude projects</b></td><td>The coordinator, the threads, project memory and the shared files folder. Decision cards and checklists in the Claude app.</td></tr>
              <tr><td><b>Claude Code on the web</b></td><td>Every thread: reading the repo, writing code, running tests, shooting screenshots with Playwright, opening PRs.</td></tr>
              <tr><td><b>Claude Opus</b></td><td>The builder in every thread, and the second of the first two reviews. Extra High effort for the hard hardening units, Medium for small ones.</td></tr>
              <tr><td><b>Claude Fable 5.1</b></td><td>The reviewer: the first design and build review (20 findings), the inbox review (19), the white admin review (26) and the migration review before #20 merged.</td></tr>
              <tr><td><b>Remote Control</b></td><td>Threads that need a local machine run there: the red team and the auth review.</td></tr>
              <tr><td><b>/counselors</b></td><td>One prompt to three models from three labs: Fable 5.1, Codex Astra 6 and Gemini 4 Argon (through the Antigravity CLI). They review on their own, then the findings are merged and checked.</td></tr>
              <tr><td><b>Artifacts</b></td><td>Long results as pages: the reviews, the 428-string copy deck, the business plan with in-place editing, the answer engine research.</td></tr>
              <tr><td><b>Figma (GPT Image)</b></td><td>The first photoreal stills.</td></tr>
              <tr><td><b>Fal, by MCP</b></td><td>Every other image and video. GPT Image 2 and Nano Banana 2.1 for stills and edits. Kling v3 Pro, Gemini Omni Flash 1.1 and Seedance 2.5 for video. Topaz Starlight Precise 2.6 to restore the soft loops.</td></tr>
              <tr><td><b>ffmpeg</b></td><td>Loops: H.264 for browsers, seamless ends, posters.</td></tr>
              <tr><td><b>Next.js 15, React 19</b></td><td>The site, the admin and these pages. Drizzle on Postgres: PGlite in WASM locally and in tests, Neon (Sydney) in production.</td></tr>
              <tr><td><b>Anthropic SDK</b></td><td>The two agents, booking and owner, on the Messages API with tools. A rules engine answers when there is no key.</td></tr>
              <tr><td><b>GitHub, Vercel</b></td><td>PRs, previews, production, Cron for the daily jobs, Web Analytics.</td></tr>
              <tr><td><b>Fonts</b></td><td>Big Shoulders, Josefin Sans and Instrument Sans on the site. Geist in the admin. Shantell Sans for these diagrams.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p>Two tools were looked at and left out. <Note note="tldraw's SDK needs a licence key in production. The hobby licence adds a watermark, and a commercial licence is a sales quote.">tldraw</Note> lost to a small hand-drawn engine written for the explainer, and the diagrams on this page use it too. Claude Managed Agents was more than this needs: a booking agent does not need a managed sandbox per session, so it stays a Messages API loop with a daily Vercel Cron.</p>
      <p>Fal cost real money. The account ran to <strong>−$36</strong> on the first afternoon, so the rule since then is a cost estimate before every batch. The rear-tap loops cost about $15, the truck wrap about $2 and the Starlight restore about $1.70.</p>
      <p>Claude cost more, in tokens. Each session keeps a usage record. Across {spend.length} of them the bill comes to <strong>{usd(cost)}</strong> at API list prices. Almost all of it is reading: each turn reads the whole conversation again, and the prompt cache serves {cached}% of that.</p>
      <div className="blk out">
        <div className="panel">
          <ul className="stats">
            <li><b className="num">${Math.round(cost)}</b><span>{spend.length} sessions, at list prices</span></li>
            <li><b className="num">{mil(read)}</b><span>tokens read, {cached}% from the cache</span></li>
            <li><b className="num">{mil(out)}</b><span>tokens written</span></li>
            <li><b className="num">{Math.round(read / out)} : 1</b><span>read to written</span></li>
          </ul>
          <p className="small">Cost per thread, the ten biggest first:</p>
          <div className="spend">
            {top.map((x) => (
              <div key={x.t} className={`wf-row ${x.model}`}>
                <span className="wf-l">{x.t}</span>
                <span className="wf-bar"><i style={{ width: `${(x.cost / maxCost) * 100}%` }} /></span>
                <span className="wf-v num">{usd(x.cost)}</span>
              </div>
            ))}
            <div className="wf-row sum">
              <span className="wf-l">{rest.length} other threads</span>
              <span className="wf-bar"><i style={{ width: `${(sum(rest, "cost") / maxCost) * 100}%` }} /></span>
              <span className="wf-v num">{usd(sum(rest, "cost"))}</span>
            </div>
            <div className="wf-row sum">
              <span className="wf-l">The coordinator, {coords.length} sessions</span>
              <span className="wf-bar"><i style={{ width: `${(sum(coords, "cost") / maxCost) * 100}%` }} /></span>
              <span className="wf-v num">{usd(sum(coords, "cost"))}</span>
            </div>
          </div>
          <div className="gt-key spend-key" aria-hidden="true">
            <span><i className="opus" /> Opus</span>
            <span><i className="fable" /> Fable</span>
            <span><i className="all" /> sums</span>
          </div>
          <div className="scrollx">
            <table className="tbl">
              <thead><tr><th>Model</th><th className="num">Sessions</th><th className="num">Cost</th><th className="num">Out</th><th className="num">Per 1M out</th></tr></thead>
              <tbody>
                {byModel.map((b) => (
                  <tr key={b.m}><td><b>{b.m === "opus" ? "Opus" : "Fable"}</b></td><td className="num">{b.n}</td><td className="num">{usd(b.cost)}</td><td className="num">{mil(b.out)}</td><td className="num">${Math.round(b.cost / (b.out / 1e6))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p>Fable costs more per token, and a review reads a lot of code to write short findings, so the review threads cost the most for what they wrote. The coordinator ran at Low effort, so all its sessions together cost less than the biggest thread. The biggest threads, the explainer and the business plan, ran for hours and read their history again on every turn.</p>
      <p className="small">Not counted: the red team on the local Mac, one other thread and one coordinator session with no usage record, and the Codex and Gemini counselors. The figure for this page&apos;s thread stops when the data was taken.</p>

      <h2 id="design">How the look changed</h2>
      <p>The look changed five times in two days, each time after a plain note on what was wrong with the last one. Pick a stage, then drag the handle on the before and after pairs.</p>
      <div className="wide">
        <Views
          views={[
            { label: "Night Run", say: "22 Oct, 10:37. The first build, in a dark \"Night Run\" look. It worked, but \"the design leaves a lot to be desired\".", imgs: [im("v1-home", "First build home page, dark theme"), im("v1-today", "First build owner admin"), im("v1-inbox", "First build inbox")], cols: 3 },
            { label: "Two directions", say: "Two directions from three references (golden age travel posters, contemporary flat, Shelf Edge charts). A: Golden Hour, a 1930s railway lithograph. B: Hill Repeats. The pick: A for the site and B for the admin.", imgs: [im("dl-a-hero", "Direction A, Golden Hour hero", "A · Golden Hour"), im("dl-b-hero", "Direction B, Hill Repeats hero", "B · Hill Repeats"), im("dl-a-wrap", "Direction A truck wrap"), im("dl-b-wrap", "Direction B truck wrap")], cols: 2 },
            { label: "Golden Hour", say: "22 Oct, 11:33. The restyle: Golden Hour on the site.", cmp: { a: im("v1-home", "Night Run home"), b: im("v2-home", "Golden Hour home"), labels: ["Night Run", "Golden Hour"] } },
            { label: "Rear taps", say: "Dry hire means nobody pours from inside the truck, and the taps are on the back. So: no runners in the hero, and all 8 taps on the rear.", cmp: { a: im("home-runners", "Hero with runners"), b: im("home-reartaps", "Hero with the rear taps"), labels: ["Runners", "Rear taps"] } },
            { label: "Hand-cut", say: "\"It feels more AI generated.\" Three hand-made treatments of the same hero: the base, A Ticket, B Hand-cut, C Luggage label. B won.", imgs: [im("handmade-hero", "The hero four ways: base, Ticket, Hand-cut, Luggage label", "Base, A, B, C"), im("home-handcut", "Home page in the Hand-cut style", "B · Hand-cut, as shipped in #6")], cols: 2 },
            { label: "White console", say: "23 Oct. The Hill Repeats admin was \"too playful\". The white console in #17, in Geist with the inks as accents only. Verdict: \"That's 100x better.\"", cmp: { a: im("v2-today", "Hill Repeats admin"), b: im("white-today", "White console admin"), labels: ["Hill Repeats", "White"] } },
            { label: "Inbox", say: "The inbox went from a list of chats to a decision queue with drafted replies (#10, option C), then into the white console.", imgs: [im("inbox-chat", "Inbox as a chat list", "A list of chats"), im("inbox-queue", "Inbox as a decision queue", "#10 · the queue"), im("inbox-console", "Inbox in the white console", "#17 · the console")], cols: 3 },
            { label: "Explainer", say: "23 and 24 Oct. The explainer and the plan, in the style of Ben's Bites' pipeline post: white paper, Golden Hour inks, hand-drawn diagrams.", imgs: [im("how-it-works", "The How it works page")], cols: 1 },
          ]}
        />
      </div>
      <p>Some rules came out of this and still hold: no left accent bars on rounded boxes, Emil Kowalski&apos;s motion guidance, Golden Hour tokens only, and no play and pause button on the loops.</p>

      <h2 id="imagery">Pictures and video</h2>
      <p>The first stills were photoreal. Each had a fault a model could fix with an edit: a brand badge, a staff member pouring, the wrong shirt. Nano Banana 2.1 fixed the wedding at 2K: an unbranded fridge and a chalkboard. GPT Image 2 fixed the run club: the Suzuki badge, the club shirt, self-serve taps and nobody in the truck.</p>
      <div className="wide duo">
        <Compare a={im("photo-wedding", "Wedding still, first try")} b={im("photo-wedding-fixed", "Wedding still, fixed")} labels={["First", "Nano Banana 2.1"]} />
        <Compare a={im("photo-runclub", "Run club still, first try")} b={im("photo-runclub-fixed", "Run club still, fixed")} labels={["First", "GPT Image 2"]} />
      </div>
      <p>Then three video models animated the same two stills. Veo was retired on Fal by then, so Google&apos;s entry was Gemini Omni.</p>
      <div className="blk out">
        <div className="panel">
          <div className="vgrid">
            <span className="corner" />
            {bakeoff.models.map((m) => <span key={m} className="h">{m}</span>)}
            {bakeoff.rows.flatMap((r) => [
              <span key={r.shot} className="shot">{r.shot}</span>,
              ...r.imgs.map((src, k) => (
                <figure key={src}>
                  <img src={`/made/${src}.jpg`} alt={`${r.shot}, ${bakeoff.models[k]}`} width={SIZES[src][0]} height={SIZES[src][1]} loading="lazy" />
                  <figcaption className={r.say[k].includes("vanishes") ? "bad" : undefined}>{r.say[k]}</figcaption>
                </figure>
              )),
            ])}
          </div>
        </div>
      </div>
      <p>The photoreal clips were retired with the move to Golden Hour. For flat, cut-paper motion <strong>Seedance</strong> beat Kling: the sun rises cleanly and the festoon lights come on. Video then went on hold until the stills were right. The third round of stills went to A2 for the hero and B1 for the truck.</p>
      <div className="wide">
        <figure className="photo">
          <img src="/made/stills-v3.jpg" alt="Third round of hero stills: the current hero, option A1 and option A2" width={1400} height={281} loading="lazy" />
          <figcaption>Stills, round 3: the old hero, A1 and A2. A2 is the hero now.</figcaption>
        </figure>
      </div>
      <p>The Seedance loops came back soft, at 0.24 Mbps. Topaz Starlight Precise 2.6 at 1x restored them without changing the approved motion (<a href={pr(13)}>#13</a>):</p>
      <div className="wide">
        <figure className="photo">
          <img src="/made/upscale-zoom.jpg" alt="Loop frame before and after the Starlight restore, zoomed" width={1400} height={525} loading="lazy" />
          <figcaption>Zoomed: Seedance as delivered (left), after Starlight (right).</figcaption>
        </figure>
      </div>
      <p>Two models also tried the Golden Hour poster, and the business plan got the seller&apos;s Marketplace photo with the wrap edited on:</p>
      <div className="wide duo">
        <figure className="m-pic"><img src="/made/dl-a1-gpt.jpg" alt="Golden Hour poster by GPT Image" width={700} height={1050} loading="lazy" /><figcaption>The poster, GPT Image</figcaption></figure>
        <figure className="m-pic"><img src="/made/dl-a1-nb.jpg" alt="Golden Hour poster by Nano Banana" width={700} height={1043} loading="lazy" /><figcaption>The same prompt, Nano Banana</figcaption></figure>
      </div>
      <div className="blk" style={{ maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
        <Compare a={im("truck-raw", "The seller's truck as listed")} b={im("truck-wrapped", "The same truck with the Golden Hour wrap")} labels={["Listed", "Wrapped"]} />
      </div>

      <h2 id="growth">How the system grew</h2>
      <p>The first build already did a lot. Each later step added a part, or took one away. Step through the pull requests: new parts draw in blue, and retired parts are struck out.</p>
      <div className="blk out">
        <Sketch cfg={growth} />
      </div>
      <p>The tests grew with it. There were none on the first build. Each bar is the suite as that PR merged:</p>
      <div className="blk out">
        <div className="panel">
          <div className="bars">
            {testsBy.map((x) => (
              <div key={x.label} className="wf-row">
                <span className="wf-l">{x.label}</span>
                <span className="wf-bar"><i style={{ width: `${(x.n / maxTests) * 100}%` }} /></span>
                <span className="wf-v num">{x.n}</span>
              </div>
            ))}
          </div>
          <p className="small">The biggest pull requests, lines added and removed:</p>
          <div className="bars">
            {diffs.map((d) => (
              <div key={d.n} className="wf-row out">
                <span className="wf-l"><a href={pr(d.n)}>#{d.n}</a></span>
                <span className="wf-bar"><i style={{ width: `${((d.add + d.del) / maxDiff) * 100}%` }} /></span>
                <span className="wf-v num">+{d.add.toLocaleString("en-AU")}{d.del ? ` −${d.del.toLocaleString("en-AU")}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2 id="hardening">Hardening</h2>
      <p>On 23 October the goal changed: the agent and booking system should be <strong>production grade and bulletproof</strong>, and built so it could serve other businesses later. A demo for other businesses stayed out of scope.</p>
      <p>So the system was attacked first. A red team ran on a local Mac through /counselors, with three models from three labs reading the code on their own. They found <strong>3 critical and 12 high</strong> problems. The three critical ones, in plain words:</p>
      <ol className="plain">
        <li>The server believed the browser. The data lived in the browser, so anyone could edit it.</li>
        <li>A phone number was an owner&apos;s password. A faked caller ID got the owner agent.</li>
        <li>A stranger could take over a booking by quoting its reference.</li>
      </ol>
      <p>The fix plan went through 5 reviewers, who raised 33 findings and 13 corrections to the plan itself. Then two pull requests:</p>
      <ul className="plain">
        <li><a href={pr(19)}><strong>#19, phase 1</strong></a>: six quick units in an afternoon. A cancel needs a clear yes to a quote, a stranger&apos;s reference gets no details, and money settings move to the admin. Each attack it covers was run 3 times before and after: it now fails every time.</li>
        <li><a href={pr(20)}><strong>#20, phase 2</strong></a>: nine units, {(12572).toLocaleString("en-AU")} lines added across 99 files. Data on the server in Postgres, texts signed the way Twilio signs them, owners signed in by a one-time link, every owner change staged and run only on YES with a code, and the jobs on Vercel Cron. Midway came the point that &ldquo;we built our own auth&rdquo;. Three models reviewed it and found 17 holes, all fixed before merge. 8 attacks fail, and the 16 owner flows pass.</li>
      </ul>
      <p>Before #20 merged, Fable reviewed the database migrations and the fixes went in the same PR. A deploy now migrates its own database before the new code goes live.</p>

      <h2 id="decisions">Decisions</h2>
      <p>These are the calls Colin made, in the threads and on the cards and artifacts the threads sent. An <span className="tbl"><span className="yours">override</span></span> mark means the pick went against the recommendation. That happened {yours} times. Every other card went with the default, and the rest were decided without being asked.</p>
      <div className="blk out">
        <div className="panel scrollx">
          <table className="tbl">
            <thead><tr><th>When</th><th>Question</th><th>Pick</th></tr></thead>
            <tbody>
              {picks.map((p, k) => (
                <tr key={k}>
                  <td className="when">{fmtDay(p.at)} {p.at.slice(11)}</td>
                  <td>{p.q}</td>
                  <td>
                    {p.pick}
                    {p.rec && <span className="yours">override</span>}
                    {p.rec && <span className="rec">Recommended: {p.rec}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p>The business rules came first, from three rounds of questions on the first morning. They are still the rules the code runs on:</p>
      <ul className="plain">
        {rules.map((r) => <li key={r}>{r}.</li>)}
      </ul>
      <p>The artifacts carried decisions too. In the <a href="https://claude.ai/artifact/Uax8atKWxuSJZdZhvgMq76">copy deck</a> six edits came back: Perth metro, delivery from the Perth CBD and a dry-hire voice (<a href={pr(4)}>#4</a>). The business plan was edited in place. Every recommendation in the two design reviews was accepted, and the red team&apos;s answer was &ldquo;plan the fixes&rdquo;.</p>

      <h2 id="lessons">What worked</h2>
      <ul className="plain">
        <li><strong>One thread per job.</strong> Threads ran in parallel without stepping on each other, and each ended in one PR that was easy to read.</li>
        <li><strong>A default on every question.</strong> Work never waited for an answer, and {picks.length - yours} of {picks.length} calls went with the default or needed no card.</li>
        <li><strong>Reviews by other models.</strong> Each review found things the builder missed. The red team found the three that mattered most.</li>
        <li><strong>Say what is wrong.</strong> &ldquo;Feels AI generated&rdquo; and &ldquo;too playful&rdquo; each led to a better look within hours.</li>
        <li><strong>Cost first.</strong> After the Fal overrun, an estimate before each batch kept spend to a few dollars a round.</li>
      </ul>
      <p>Back to <Link href="/how-it-works">how the truck runs itself</Link>, or the <Link href="/plan">business plan</Link>.</p>

      <hr />
      <section className="credits">
        <p className="cr-h">Sources</p>
        <ul className="cr">
          <li><b>Record:</b> the project&apos;s threads, <a href={`${REPO}/pulls?q=is%3Apr`}>the pull requests</a> and project memory. Times are Perth time</li>
          <li><b>Pictures:</b> screenshots and stills from the project folder, resized for the web</li>
          <li><b>Diagrams:</b> the same hand-drawn engine as the explainer</li>
        </ul>
      </section>
    </article>
  );
}
