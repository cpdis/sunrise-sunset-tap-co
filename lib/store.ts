"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  balance,
  cancelBooking,
  chargeBalance,
  computeDistribution,
  createHold,
  freeCash,
  type NewBooking,
  pay,
  payDeposit,
  runJobs,
} from "./domain";
import * as ops from "./ops";
import { DATA_VERSION, buildSeed } from "./seed";
import { ownerByContact, ownerSnapshot, snapshot } from "./snapshot";
import type {
  Account,
  AgentResult,
  Conversation,
  Data,
  KbPage,
  Msg,
  Scenario,
  Settings,
  TruckLog,
} from "./types";
import { addDays, quarterOf, sameContact, todayISO, uid } from "./util";

export const STORAGE_KEY = "sunrise-sunset-demo";

interface AppState {
  data: Data | null;
  ownerId: string | null;
  hydrated: boolean;
  ensure: () => void;
  reset: (scenario?: Scenario) => void;
  login: (ownerId: string) => void;
  logout: () => void;
  mutate: (fn: (d: Data) => void) => void;
  book: (n: NewBooking) => string;
  payDeposit: (bookingId: string, card: string, checkout?: { email?: string; agreed?: boolean }) => void;
  cancel: (bookingId: string) => void;
  customerCancel: (bookingId: string) => ReturnType<typeof ops.customerCancel>;
  startConversation: (c: Pick<Conversation, "channel" | "contact" | "name">) => string;
  sendCustomer: (convId: string, body: string) => Promise<AgentResult | null>;
  ownerReply: (convId: string, body: string) => void;
  setAgentActive: (convId: string, active: boolean) => void;
  handBack: (convId: string, force?: boolean) => void;
  setDraft: (convId: string, draft: string) => void;
  markRead: (convId: string) => void;
  claimRun: (bookingId: string, which: "deliver" | "collect") => void;
  captureBond: (bookingId: string, amount: number, note: string) => void;
  returnedClean: (bookingId: string) => void;
  chargeBalanceNow: (bookingId: string) => void;
  payBalance: (bookingId: string, card: string) => void;
  addExpense: (date: string, account: Account, amount: number, memo: string) => void;
  approveDistribution: (distId: string) => void;
  payDistribution: (distId: string) => void;
  updateSettings: (s: Partial<Settings>) => void;
  saveKb: (page: KbPage) => void;
  toggleBlackout: (date: string) => void;
  addPersonalUse: (date: string, note: string) => void;
  addTruckLog: (log: Omit<TruckLog, "id">) => void;
  transferShares: (fromId: string, toId: string, shares: number) => void;
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

const log = ops.log;

// Keeps a distribution record for the most recent completed quarter.
function ensureDistributions(d: Data) {
  const lastEnd = addDays(quarterOf(todayISO()).start, -1);
  const q = quarterOf(lastEnd);
  if (!d.distributions.some((x) => x.quarter === q.key) && q.start >= d.ledger[0]?.date) {
    d.distributions.push(computeDistribution(d, q.key));
  }
  for (const dist of d.distributions) {
    if (dist.status === "awaiting" && dist.approvals.length === 0) {
      Object.assign(dist, computeDistribution(d, dist.quarter), { approvals: [] });
    }
  }
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      data: null,
      ownerId: null,
      hydrated: false,

      // Writes only when a job changed something, so an idle tab never overwrites another tab's bookings.
      ensure: () => {
        const cur = get().data;
        const fresh = !cur || cur.version !== DATA_VERSION;
        const d = fresh ? buildSeed() : clone(cur);
        const ran = runJobs(d);
        ran.forEach((t) => log(d, t));
        const before = fresh ? "" : JSON.stringify(cur.distributions);
        ensureDistributions(d);
        if (fresh || ran.length > 0 || JSON.stringify(d.distributions) !== before) set({ data: d, hydrated: true });
        else if (!get().hydrated) set({ hydrated: true });
      },

      reset: (scenario) => {
        const d = buildSeed(new Date(), scenario ?? get().data?.scenario ?? "base");
        set({ data: d });
      },

      login: (ownerId) => set({ ownerId }),
      logout: () => set({ ownerId: null }),

      mutate: (fn) => {
        const cur = get().data;
        if (!cur) return;
        const d = clone(cur);
        fn(d);
        set({ data: d });
      },

      // "" when createHold refuses (the date was taken since the page checked it).
      book: (n) => {
        let id = "";
        get().mutate((d) => {
          try {
            const b = createHold(d, n);
            id = b.id;
            log(d, `New hold ${b.ref} via ${n.via} (${n.name})`);
          } catch (err) {
            log(d, `Hold refused for ${n.date} via ${n.via}: ${(err as Error).message}`);
          }
        });
        return id;
      },

      payDeposit: (bookingId, card, checkout = {}) =>
        get().mutate((d) => {
          const b = payDeposit(d, bookingId, card, new Date(), checkout.agreed, checkout.email);
          log(d, `Deposit paid for ${b.ref}`);
          for (const c of d.conversations) {
            if (c.customerId === b.customerId && c.agentActive) {
              c.messages.push({
                id: uid("m"),
                from: "agent",
                body: `Payment received, thanks! ${b.ref} is confirmed.`,
                at: new Date().toISOString(),
                tools: ["stripe:webhook"],
              });
            }
          }
        }),

      cancel: (bookingId) =>
        get().mutate((d) => {
          const pol = cancelBooking(d, bookingId);
          const b = d.bookings.find((x) => x.id === bookingId);
          if (pol && b) log(d, `Cancelled ${b.ref}; refunded $${pol.refund}`);
        }),

      customerCancel: (bookingId) => {
        let r: ReturnType<typeof ops.customerCancel> = null;
        get().mutate((d) => {
          r = ops.customerCancel(d, bookingId);
        });
        return r;
      },

      startConversation: (c) => {
        const existing = get().data?.conversations.find((x) => x.contact === c.contact && x.channel === c.channel);
        if (existing) return existing.id;
        const id = uid("conv");
        get().mutate((d) => {
          const owner = ownerByContact(d, c.contact);
          d.conversations.unshift({ ...c, ...(owner && { name: owner.name, ownerId: owner.id }), id, agentActive: true, unread: !owner, state: {}, messages: [] });
        });
        return id;
      },

      sendCustomer: async (convId, body) => {
        const msg: Msg = { id: uid("m"), from: "customer", body, at: new Date().toISOString() };
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (c) {
            c.messages.push(msg);
            c.unread = !c.ownerId;
          }
        });
        const d0 = get().data;
        const conv = d0?.conversations.find((x) => x.id === convId);
        // An owner who took over answers alone; a hand-over the owners haven't picked up yet still gets general answers.
        if (!d0 || !conv || (!conv.agentActive && !conv.escalated)) return null;
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot: conv.ownerId ? ownerSnapshot(d0) : snapshot(d0, conv.contact), conversation: conv }),
        });
        if (!res.ok) return null;
        const result = (await res.json()) as AgentResult;
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (!c) return;
          // The reply goes in first so a hand-over row reads after what the agent told the customer.
          c.messages.push({ id: uid("m"), from: "agent", body: result.reply, at: new Date().toISOString(), tools: result.tools });
          for (const a of result.actions) {
            if (a.type === "hold") {
              const isEmail = a.contact.includes("@");
              let b;
              try {
                b = createHold(d, {
                  id: a.bookingId,
                  ref: a.ref,
                  date: a.date,
                  block: a.block,
                  startTime: a.startTime,
                  suburb: a.suburb,
                  name: a.name,
                  phone: isEmail ? undefined : a.contact,
                  email: isEmail ? a.contact : undefined,
                  via: a.channel,
                });
              } catch (err) {
                // The date went between the agent's check and now. The link it sent won't open, so the owners take it.
                c.escalated = `Hold ${a.ref} for ${a.name} refused: ${(err as Error).message}`;
                c.messages.push({ id: uid("m"), from: "system", body: `Hold refused: ${(err as Error).message}`, at: new Date().toISOString() });
                log(d, `Agent hold ${a.ref} refused: ${(err as Error).message}`);
                continue;
              }
              d.seq = Math.max(d.seq, Number(a.ref.replace("SST-", "")));
              c.customerId = b.customerId;
              if (c.name.startsWith("Caller") || c.name === "New contact") c.name = a.name;
              log(d, `Agent held ${b.ref} for ${a.name} via ${a.channel}`);
            } else if (a.type === "cancel") {
              const b = d.bookings.find((x) => x.id === a.bookingId);
              const pol = cancelBooking(d, a.bookingId);
              if (b && pol) log(d, `${c.ownerId ? `${c.name} cancelled ${b.ref} by SMS` : `Agent cancelled ${b.ref}`}; refunded $${pol.refund}`);
            } else if (a.type === "escalate") {
              if (c.escalated && !c.agentActive) continue;
              const repeat = c.escalated === a.reason;
              c.escalated = a.reason;
              if (!a.keepAgent) c.agentActive = false;
              if (a.draft) c.draft = a.draft;
              // The reason stays in the thread after an owner replies and the flag clears. Written once per reason.
              if (!repeat) c.messages.push({ id: uid("m"), from: "system", body: `Agent handed over: ${a.reason}`, at: new Date().toISOString() });
              log(d, `Escalated to owners: ${a.reason}`);
            } else if (c.ownerId) {
              ops.applyOwnerAction(d, a, c.ownerId);
            }
          }
          c.state = result.state;
        });
        return result;
      },

      ownerReply: (convId, body) => {
        const me = get().ownerId;
        if (me) get().mutate((d) => ops.ownerReply(d, convId, body, me));
      },

      setAgentActive: (convId, active) => get().mutate((d) => ops.setAgentActive(d, convId, active, get().ownerId ?? undefined)),

      handBack: (convId, force) => get().mutate((d) => ops.handBack(d, convId, get().ownerId ?? undefined, force)),

      setDraft: (convId, draft) => get().mutate((d) => ops.setDraft(d, convId, draft)),

      markRead: (convId) =>
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (c) c.unread = false;
        }),

      claimRun: (bookingId, which) => {
        const me = get().ownerId;
        if (me) get().mutate((d) => ops.claimRun(d, bookingId, which, me));
      },

      captureBond: (bookingId, amount, note) =>
        get().mutate((d) => {
          const b = d.bookings.find((x) => x.id === bookingId);
          if (!b) return;
          pay(d, b, "bond_capture", amount, new Date().toISOString());
          b.bondStatus = "captured";
          b.bondCaptured = amount;
          b.condition = note;
          log(d, `Captured $${amount} of the bond on ${b.ref}`);
        }),

      returnedClean: (bookingId) => {
        const me = get().ownerId;
        if (me) get().mutate((d) => ops.returnedClean(d, bookingId, me));
      },

      chargeBalanceNow: (bookingId) =>
        get().mutate((d) => {
          const b = d.bookings.find((x) => x.id === bookingId);
          if (!b) return;
          const r = chargeBalance(d, b);
          if (r === "paid") log(d, `Charged balance for ${b.ref}`);
          else if (r === "declined") log(d, `Balance for ${b.ref} declined again`);
        }),

      // The customer put in a new card for a balance that kept declining.
      payBalance: (bookingId, card) =>
        get().mutate((d) => {
          const b = d.bookings.find((x) => x.id === bookingId);
          if (!b || b.state !== "confirmed") return;
          b.cardDeclines = false;
          pay(d, b, "balance", b.total - b.deposit, new Date().toISOString(), card);
          b.state = "balance_paid";
          b.balanceFailedAt = undefined;
          log(d, `${b.ref} balance paid with a new card`);
        }),

      addExpense: (date, account, amount, memo) => get().mutate((d) => ops.addExpense(d, date, account, amount, memo)),

      approveDistribution: (distId) => {
        const me = get().ownerId;
        if (me) get().mutate((d) => ops.approveDistribution(d, distId, me));
      },

      payDistribution: (distId) => {
        const me = get().ownerId;
        if (me) get().mutate((d) => ops.payOut(d, distId, me));
      },

      updateSettings: (s) => get().mutate((d) => ops.updateSettings(d, s)),

      saveKb: (page) => get().mutate((d) => ops.saveKb(d, page)),

      toggleBlackout: (date) => get().mutate((d) => ops.toggleBlackout(d, date)),

      addPersonalUse: (date, note) => get().mutate((d) => ops.addPersonalUse(d, date, note, get().ownerId ?? d.owners[0].id)),

      addTruckLog: (l) => get().mutate((d) => ops.addTruckLog(d, l)),

      transferShares: (fromId, toId, shares) =>
        get().mutate((d) => {
          const a = d.owners.find((o) => o.id === fromId);
          const b = d.owners.find((o) => o.id === toId);
          if (!a || !b || a.shares < shares) return;
          a.shares -= shares;
          b.shares += shares;
          log(d, `Transferred ${shares} share(s) from ${a.name} to ${b.name}`);
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ data: s.data, ownerId: s.ownerId }),
      skipHydration: true,
    },
  ),
);
