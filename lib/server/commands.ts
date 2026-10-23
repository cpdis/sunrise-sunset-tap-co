// Every change to a business's data runs here, as a named command on the server (R14). Each command says who may
// run it, checks its arguments (lib/server/args.ts), and runs the same lib/domain.ts or lib/ops.ts function the
// browser store used to run, inside repo.mutateOnce: one compare-and-swap save per command, at most once per
// idempotency key. An inbound message and the agent's turn on it run in lib/server/agent.ts, not here: the model
// call is too slow for a write (KTD10).
import { DEFAULT_SETTINGS, SUBURBS } from "@/lib/config";
import { ACCOUNT_LABEL, cancelBooking, chargeBalance, createHold, pay, payDeposit } from "@/lib/domain";
import * as ops from "@/lib/ops";
import { SCENARIOS, buildSeed } from "@/lib/seed";
import type { Account, Data, Owner, Scenario, Settings, TruckLog } from "@/lib/types";
import { uid } from "@/lib/util";
import { bookingByToken } from "@/lib/views";
import { CommandError, type Raw, bad, date, flag, id, isObj, match, maybeNum, maybeText, num, obj, oneOf, text } from "./args";
import { sessionOwner } from "./auth";
import type { Repo } from "./db/repo";
import { publicLimited } from "./limits";

export { CommandError };

// Who is asking. The tenant and owner come from a verified session cookie; a visitor gets the site's business.
export interface Caller {
  tenant: string;
  ownerId?: string;
  // The owner's session version the cookie carries (lib/server/auth.ts sessionOwner). Left out, it is 0.
  sv?: number;
  // demoFor() (KTD12, A1): DEMO_MODE and the business's demo flag. The demo-only commands check the flag again.
  demo: boolean;
  // The client IP (lib/server/limits.ts clientIp), for the public commands' limit. Left out, only the per-contact
  // limit applies.
  ip?: string;
  now?: Date;
}

// Who may run a command:
// - public: anyone, such as the /book form;
// - customer: whoever holds the booking's link token (checked by `linked`);
// - owner: a signed-in owner of the business; director: one who is a director now.
type Role = "public" | "customer" | "owner" | "director";

interface Ctx {
  now: Date;
  // The signed-in owner, when the session names one of this business's owners.
  owner?: Owner;
}

interface Command<A> {
  role: Role;
  demoOnly?: boolean;
  // A public command's phone numbers and emails, each limited per hour (A6).
  contacts?(a: A): (string | undefined)[];
  // Parses the arguments, throwing a 400 on anything malformed.
  args(raw: Raw): A;
  // Runs inside the save, so it must be synchronous (KTD10). A plain Error is a refusal: nothing is saved (409).
  run(d: Data, a: A, ctx: Ctx): unknown;
}

const command = <A>(c: Command<A>) => c as Command<unknown>;

const TRUCK_LOGS: TruckLog["type"][] = ["service", "clean", "odometer", "incident", "purchase"];
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

// ---------- lookups ----------

function conv(d: Data, convId: string) {
  const c = d.conversations.find((x) => x.id === convId);
  if (!c) throw new CommandError(404, "No such conversation.");
  return c;
}

// The booking a customer's link opens. An unknown id and a wrong token get the same answer.
function linked(d: Data, bookingId: string, token: string) {
  const b = bookingByToken(d, bookingId, token);
  if (!b) throw new CommandError(403, "That link doesn't open this booking.");
  return b;
}

const me = (ctx: Ctx) => ctx.owner as Owner;

// ---------- the commands ----------

const COMMANDS: Record<string, Command<unknown>> = {
  book: command({
    role: "public",
    args: (r) => ({
      date: date(r, "date"),
      block: oneOf(r, "block", [4, 8] as const),
      startTime: maybeText(r, "startTime", 5),
      suburb: oneOf(r, "suburb", SUBURBS.map((s) => s.name)),
      name: text(r, "name", 80),
      email: maybeText(r, "email", 120),
      phone: maybeText(r, "phone", 30),
      eventType: maybeText(r, "eventType", 40),
      guests: maybeNum(r, "guests", 0, 5000),
      notes: maybeText(r, "notes", 1000),
      agreed: flag(r, "agreed"),
    }),
    contacts: (n) => [n.phone, n.email],
    run(d, n, ctx) {
      try {
        const b = createHold(d, { ...n, via: "web" }, ctx.now);
        ops.log(d, `New hold ${b.ref} via web (${n.name})`);
        return { id: b.id, token: b.token };
      } catch (err) {
        // The date was taken since the page checked it.
        ops.log(d, `Hold refused for ${n.date} via web: ${(err as Error).message}`);
        return { refused: (err as Error).message };
      }
    },
  }),

  payDeposit: command({
    role: "customer",
    args: (r) => ({ bookingId: id(r, "bookingId"), token: text(r, "token", 100), card: text(r, "card", 40), email: maybeText(r, "email", 120), agreed: flag(r, "agreed") }),
    run(d, a, ctx) {
      const was = linked(d, a.bookingId, a.token).state;
      const b = payDeposit(d, a.bookingId, a.card, ctx.now, a.agreed, a.email);
      if (was !== "held") return {};
      ops.log(d, `Deposit paid for ${b.ref}`);
      for (const c of d.conversations) {
        if (c.customerId === b.customerId && c.agentActive) {
          c.messages.push({ id: uid("m"), from: "agent", body: `Payment received, thanks! ${b.ref} is confirmed.`, at: ctx.now.toISOString(), tools: ["stripe:webhook"] });
        }
      }
      return {};
    },
  }),

  // The customer put in a new card for a balance that kept declining.
  payBalance: command({
    role: "customer",
    args: (r) => ({ bookingId: id(r, "bookingId"), token: text(r, "token", 100), card: text(r, "card", 40) }),
    run(d, a, ctx) {
      const b = linked(d, a.bookingId, a.token);
      if (b.state !== "confirmed") return {};
      b.cardDeclines = false;
      pay(d, b, "balance", b.total - b.deposit, ctx.now.toISOString(), a.card);
      b.state = "balance_paid";
      b.balanceFailedAt = undefined;
      ops.log(d, `${b.ref} balance paid with a new card`);
      return {};
    },
  }),

  customerCancel: command({
    role: "customer",
    args: (r) => ({ bookingId: id(r, "bookingId"), token: text(r, "token", 100) }),
    run(d, a, ctx) {
      linked(d, a.bookingId, a.token);
      return ops.customerCancel(d, a.bookingId, ctx.now) ?? {};
    },
  }),

  cancel: command({
    role: "owner",
    args: (r) => ({ bookingId: id(r, "bookingId") }),
    run(d, a, ctx) {
      const b = d.bookings.find((x) => x.id === a.bookingId) ?? bad("bookingId");
      const pol = cancelBooking(d, b.id, ctx.now);
      if (pol) ops.log(d, `Cancelled ${b.ref}; refunded $${pol.refund}`);
      return { refund: pol?.refund ?? 0 };
    },
  }),

  ownerReply: command({
    role: "owner",
    args: (r) => ({ convId: id(r, "convId"), body: text(r, "body", 2000) }),
    run: (d, a, ctx) => ops.ownerReply(d, a.convId, a.body, me(ctx).id),
  }),
  setAgentActive: command({
    role: "owner",
    args: (r) => ({ convId: id(r, "convId"), active: flag(r, "active") ?? bad("active") }),
    run: (d, a, ctx) => ops.setAgentActive(d, a.convId, a.active, me(ctx).id),
  }),
  handBack: command({
    role: "owner",
    args: (r) => ({ convId: id(r, "convId"), force: flag(r, "force") }),
    run: (d, a, ctx) => ops.handBack(d, a.convId, me(ctx).id, a.force),
  }),
  setDraft: command({
    role: "owner",
    args: (r) => ({ convId: id(r, "convId"), draft: maybeText(r, "draft", 2000) ?? "" }),
    run: (d, a) => ops.setDraft(d, a.convId, a.draft),
  }),
  markRead: command({
    role: "owner",
    args: (r) => ({ convId: id(r, "convId") }),
    run(d, a) {
      conv(d, a.convId).unread = false;
    },
  }),

  claimRun: command({
    role: "owner",
    args: (r) => ({ bookingId: id(r, "bookingId"), which: oneOf(r, "which", ["deliver", "collect"] as const) }),
    run: (d, a, ctx) => ops.claimRun(d, a.bookingId, a.which, me(ctx).id),
  }),
  captureBond: command({
    role: "owner",
    args: (r) => ({ bookingId: id(r, "bookingId"), amount: num(r, "amount", 0.01, 100_000), note: text(r, "note", 300) }),
    run(d, a, ctx) {
      const b = d.bookings.find((x) => x.id === a.bookingId);
      if (!b) return;
      if (a.amount > b.bond) throw new Error(`The bond on ${b.ref} is ${b.bond}.`);
      pay(d, b, "bond_capture", a.amount, ctx.now.toISOString());
      b.bondStatus = "captured";
      b.bondCaptured = a.amount;
      b.condition = a.note;
      ops.log(d, `Captured $${a.amount} of the bond on ${b.ref}`);
    },
  }),
  returnedClean: command({
    role: "owner",
    args: (r) => ({ bookingId: id(r, "bookingId") }),
    run: (d, a, ctx) => ops.returnedClean(d, a.bookingId, me(ctx).id, ctx.now),
  }),
  chargeBalanceNow: command({
    role: "owner",
    args: (r) => ({ bookingId: id(r, "bookingId") }),
    run(d, a, ctx) {
      const b = d.bookings.find((x) => x.id === a.bookingId);
      if (!b) return;
      const r = chargeBalance(d, b, ctx.now);
      if (r === "paid") ops.log(d, `Charged balance for ${b.ref}`);
      else if (r === "declined") ops.log(d, `Balance for ${b.ref} declined again`);
    },
  }),
  addExpense: command({
    role: "owner",
    args: (r) => ({ date: date(r, "date"), account: oneOf(r, "account", Object.keys(ACCOUNT_LABEL) as Account[]), amount: num(r, "amount", 0.01, 1_000_000), memo: text(r, "memo", 200) }),
    run: (d, a) => ops.addExpense(d, a.date, a.account, a.amount, a.memo),
  }),

  approveDistribution: command({
    role: "director",
    args: (r) => ({ distId: id(r, "distId") }),
    run: (d, a, ctx) => ops.approveDistribution(d, a.distId, me(ctx).id),
  }),
  payDistribution: command({
    role: "director",
    args: (r) => ({ distId: id(r, "distId") }),
    run: (d, a, ctx) => ops.payOut(d, a.distId, me(ctx).id, ctx.now),
  }),

  updateSettings: command({
    role: "owner",
    args(r) {
      const patch = obj(r, "patch");
      if (!Object.keys(patch).every((k) => SETTING_KEYS.includes(k as keyof Settings) && typeof patch[k] === "number")) bad("patch");
      return { patch: patch as Partial<Settings> };
    },
    run: (d, a) => ({ dropped: ops.updateSettings(d, a.patch) }),
  }),
  saveKb: command({
    role: "owner",
    args: (r) => {
      const p = obj(r, "page");
      return { page: { slug: match(p, "slug", /^[a-z0-9-]{1,60}$/), title: text(p, "title", 120), body: maybeText(p, "body", 20_000) ?? "" } };
    },
    run: (d, a) => ops.saveKb(d, a.page),
  }),
  toggleBlackout: command({
    role: "owner",
    args: (r) => ({ date: date(r, "date") }),
    run: (d, a) => ops.toggleBlackout(d, a.date),
  }),
  addPersonalUse: command({
    role: "owner",
    args: (r) => ({ date: date(r, "date"), note: text(r, "note", 200) }),
    run: (d, a, ctx) => ops.addPersonalUse(d, a.date, a.note, me(ctx).id),
  }),
  addTruckLog: command({
    role: "owner",
    args: (r) => {
      const l = obj(r, "log");
      return { log: { date: date(l, "date"), type: oneOf(l, "type", TRUCK_LOGS), notes: text(l, "notes", 500), odometer: maybeNum(l, "odometer", 0, 10_000_000) } };
    },
    run: (d, a) => ops.addTruckLog(d, a.log),
  }),
  transferShares: command({
    role: "director",
    args: (r) => ({ fromId: id(r, "fromId"), toId: id(r, "toId"), shares: num(r, "shares", 1, 1000) }),
    run(d, a) {
      const from = d.owners.find((o) => o.id === a.fromId);
      const to = d.owners.find((o) => o.id === a.toId);
      if (!from || !to || from === to || !Number.isInteger(a.shares) || from.shares < a.shares) return;
      from.shares -= a.shares;
      to.shares += a.shares;
      ops.log(d, `Transferred ${a.shares} share(s) from ${from.name} to ${to.name}`);
    },
  }),

  // Regenerates the demo year. The data is shared by everyone using the demo, so it resets for them too. Sign-outs
  // carry over, so a cookie that was ended stays ended (A7).
  reset: command({
    role: "owner",
    demoOnly: true,
    args: (r) => ({ scenario: r.scenario === undefined ? undefined : oneOf(r, "scenario", Object.keys(SCENARIOS) as Scenario[]) }),
    run(d, a, ctx) {
      const signOuts = new Map(d.owners.map((o) => [o.id, o.sessionVersion]));
      Object.assign(d, buildSeed(ctx.now, a.scenario ?? d.scenario));
      for (const o of d.owners) if (signOuts.get(o.id)) o.sessionVersion = signOuts.get(o.id);
      ops.runScheduled(d, ctx.now);
    },
  }),

  // The demo's "Run daily jobs now": the same jobs the daily cron runs (app/api/jobs), so a demo can move on
  // without waiting for it. Returns what ran.
  runJobs: command({ role: "owner", demoOnly: true, args: () => ({}), run: (d, _a, ctx) => ({ ran: ops.runScheduled(d, ctx.now) }) }),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

function authorise(role: Role, ctx: Ctx) {
  if (role !== "owner" && role !== "director") return;
  if (!ctx.owner) throw new CommandError(401, "Sign in again.");
  if (role === "director" && !ctx.owner.isDirector) throw new CommandError(403, "Only directors can do that.");
}

// Domain functions refuse with a plain Error (a date already taken, terms not accepted). Anything else is a bug.
const refusal = (err: unknown) => (err instanceof Error && err.constructor === Error ? new CommandError(409, err.message) : err);

export interface CommandBody {
  command?: unknown;
  args?: unknown;
  key?: unknown;
}

// Runs one command for a caller. Returns { result }, or throws a CommandError.
export async function runCommand(repo: Repo, caller: Caller, body: CommandBody) {
  const name = typeof body.command === "string" ? body.command : "";
  const def = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  const tenant = await repo.tenant(caller.tenant);
  if (!tenant) throw new CommandError(404, "No such business.");
  // A demo-only command needs the business's own demo flag whatever the caller says, so a reset never reaches a
  // real business (A1).
  if (!def || (def.demoOnly && !(caller.demo && tenant.demo))) throw new CommandError(404, "No such command.");
  if (typeof body.key !== "string" || !/^[\w:-]{8,100}$/.test(body.key)) throw new CommandError(400, "Every command needs an idempotency key.");
  if ((def.role === "owner" || def.role === "director") && !caller.ownerId) throw new CommandError(401, "Sign in first.");
  const args = def.args(isObj(body.args) ? body.args : {});
  const now = caller.now ?? new Date();
  if (def.role === "public" && (await publicLimited(repo, caller.tenant, caller.ip, def.contacts?.(args) ?? [], now))) {
    throw new CommandError(429, "Too many booking requests from here this hour. Try again later.");
  }
  const ctxFor = (d: Data): Ctx => {
    const ctx = { now, owner: sessionOwner(d, caller.ownerId, caller.sv) };
    authorise(def.role, ctx);
    return ctx;
  };
  let r;
  try {
    r = await repo.mutateOnce(caller.tenant, body.key, name, (d) => def.run(d, args, ctxFor(d)));
  } catch (err) {
    throw refusal(err);
  }
  if (!r.ok) throw r.reason === "not_found" ? new CommandError(404, "No such business.") : new CommandError(409, "Too many changes at once. Try again.");
  if (r.replay && r.command !== name) throw new CommandError(422, "That idempotency key was used for another command.");
  // The key stores {} for a command that returns nothing, so a first run answers the same as its replay.
  const result = r.value ?? {};
  if (r.replay) {
    // A replay is authorised like a first run, then answered from the stored result.
    const doc = await repo.load(caller.tenant);
    if (!doc) throw new CommandError(404, "No such business.");
    ctxFor(doc.data);
  }
  return { result };
}
