"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  cancelBooking,
  computeDistribution,
  createHold,
  type NewBooking,
  pay,
  payDeposit,
  payDistribution,
  post,
  runJobs,
} from "./domain";
import { DATA_VERSION, buildSeed } from "./seed";
import type { Snapshot } from "./agent/tools";
import type {
  Account,
  AgentResult,
  Conversation,
  Data,
  KbPage,
  Msg,
  Settings,
  TruckLog,
} from "./types";
import { addDays, quarterOf, todayISO, uid } from "./util";

interface AppState {
  data: Data | null;
  ownerId: string | null;
  hydrated: boolean;
  ensure: () => void;
  reset: () => void;
  login: (ownerId: string) => void;
  logout: () => void;
  mutate: (fn: (d: Data) => void) => void;
  book: (n: NewBooking) => string;
  payDeposit: (bookingId: string, card: string) => void;
  cancel: (bookingId: string) => void;
  startConversation: (c: Pick<Conversation, "channel" | "contact" | "name">) => string;
  sendCustomer: (convId: string, body: string) => Promise<AgentResult | null>;
  ownerReply: (convId: string, body: string) => void;
  setAgentActive: (convId: string, active: boolean) => void;
  markRead: (convId: string) => void;
  claimRun: (bookingId: string, which: "deliver" | "collect") => void;
  captureBond: (bookingId: string, amount: number, note: string) => void;
  releaseBond: (bookingId: string) => void;
  chargeBalanceNow: (bookingId: string) => void;
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

function log(d: Data, text: string) {
  d.jobs.unshift({ at: new Date().toISOString(), text });
  d.jobs = d.jobs.slice(0, 60);
}

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

export function snapshot(d: Data): Snapshot {
  return { settings: d.settings, bookings: d.bookings, customers: d.customers, kb: d.kb, blackouts: d.blackouts, seq: d.seq };
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      data: null,
      ownerId: null,
      hydrated: false,

      ensure: () => {
        const cur = get().data;
        const d = cur && cur.version === DATA_VERSION ? clone(cur) : buildSeed();
        const ran = runJobs(d);
        ran.forEach((t) => log(d, t));
        ensureDistributions(d);
        set({ data: d, hydrated: true });
      },

      reset: () => {
        const d = buildSeed();
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

      book: (n) => {
        let id = "";
        get().mutate((d) => {
          const b = createHold(d, n);
          id = b.id;
          log(d, `New hold ${b.ref} via ${n.via} (${n.name})`);
        });
        return id;
      },

      payDeposit: (bookingId, card) =>
        get().mutate((d) => {
          const b = payDeposit(d, bookingId, card);
          log(d, `Deposit paid for ${b.ref}`);
          for (const c of d.conversations) {
            if (c.customerId === b.customerId && c.agentActive) {
              c.messages.push({
                id: uid("m"),
                from: "agent",
                body: `Payment received, thanks! ${b.ref} is confirmed. I'll text the keg guide and hire agreement shortly.`,
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

      startConversation: (c) => {
        const existing = get().data?.conversations.find((x) => x.contact === c.contact && x.channel === c.channel);
        if (existing) return existing.id;
        const id = uid("conv");
        get().mutate((d) => {
          d.conversations.unshift({ ...c, id, agentActive: true, unread: true, state: {}, messages: [] });
        });
        return id;
      },

      sendCustomer: async (convId, body) => {
        const msg: Msg = { id: uid("m"), from: "customer", body, at: new Date().toISOString() };
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (c) {
            c.messages.push(msg);
            c.unread = true;
          }
        });
        const d0 = get().data;
        const conv = d0?.conversations.find((x) => x.id === convId);
        if (!d0 || !conv || !conv.agentActive) return null;
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot: snapshot(d0), conversation: conv }),
        });
        if (!res.ok) return null;
        const result = (await res.json()) as AgentResult;
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (!c) return;
          for (const a of result.actions) {
            if (a.type === "hold") {
              const isEmail = a.contact.includes("@");
              const b = createHold(d, {
                id: a.bookingId,
                ref: a.ref,
                date: a.date,
                block: a.block,
                suburb: a.suburb,
                name: a.name,
                phone: isEmail ? undefined : a.contact,
                email: isEmail ? a.contact : undefined,
                via: a.channel,
              });
              d.seq = Math.max(d.seq, Number(a.ref.replace("SST-", "")));
              c.customerId = b.customerId;
              if (c.name.startsWith("Caller") || c.name === "New contact") c.name = a.name;
              log(d, `Agent held ${b.ref} for ${a.name} via ${a.channel}`);
            } else if (a.type === "cancel") {
              const b = d.bookings.find((x) => x.id === a.bookingId);
              const pol = cancelBooking(d, a.bookingId);
              if (b && pol) log(d, `Agent cancelled ${b.ref}; refunded $${pol.refund}`);
            } else if (a.type === "escalate") {
              c.escalated = a.reason;
              c.agentActive = false;
              log(d, `Escalated to owners: ${a.reason}`);
            }
          }
          c.state = result.state;
          c.messages.push({ id: uid("m"), from: "agent", body: result.reply, at: new Date().toISOString(), tools: result.tools });
        });
        return result;
      },

      ownerReply: (convId, body) =>
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (!c) return;
          c.messages.push({ id: uid("m"), from: "owner", body, at: new Date().toISOString(), ownerId: get().ownerId ?? undefined });
          c.unread = false;
        }),

      setAgentActive: (convId, active) =>
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (!c) return;
          c.agentActive = active;
          if (active) c.escalated = undefined;
          c.messages.push({
            id: uid("m"),
            from: "system",
            body: active ? "Handed back to the agent" : "An owner took over this conversation",
            at: new Date().toISOString(),
          });
        }),

      markRead: (convId) =>
        get().mutate((d) => {
          const c = d.conversations.find((x) => x.id === convId);
          if (c) c.unread = false;
        }),

      claimRun: (bookingId, which) =>
        get().mutate((d) => {
          const b = d.bookings.find((x) => x.id === bookingId);
          const me = get().ownerId;
          if (b && me) {
            b[which].ownerId = me;
            log(d, `${d.owners.find((o) => o.id === me)?.name} claimed the ${which} run for ${b.ref}`);
          }
        }),

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

      releaseBond: (bookingId) =>
        get().mutate((d) => {
          const b = d.bookings.find((x) => x.id === bookingId);
          if (!b) return;
          pay(d, b, "bond_release", b.bond, new Date().toISOString());
          b.bondStatus = "released";
        }),

      chargeBalanceNow: (bookingId) =>
        get().mutate((d) => {
          const b = d.bookings.find((x) => x.id === bookingId);
          if (b && b.state === "confirmed") {
            pay(d, b, "balance", b.total - b.deposit, new Date().toISOString());
            b.state = "balance_paid";
            log(d, `Charged balance early for ${b.ref}`);
          }
        }),

      addExpense: (date, account, amount, memo) =>
        get().mutate((d) => {
          post(d, date, account, -Math.abs(amount), memo);
        }),

      approveDistribution: (distId) =>
        get().mutate((d) => {
          const dist = d.distributions.find((x) => x.id === distId);
          const me = get().ownerId;
          if (dist && me && !dist.approvals.includes(me)) dist.approvals.push(me);
        }),

      payDistribution: (distId) =>
        get().mutate((d) => {
          payDistribution(d, distId);
          log(d, `Paid ${distId.replace("dist_", "")} dividends via bank API (simulated)`);
        }),

      updateSettings: (s) =>
        get().mutate((d) => {
          d.settings = { ...d.settings, ...s };
        }),

      saveKb: (page) =>
        get().mutate((d) => {
          const i = d.kb.findIndex((p) => p.slug === page.slug);
          if (i >= 0) d.kb[i] = page;
          else d.kb.push(page);
        }),

      toggleBlackout: (date) =>
        get().mutate((d) => {
          d.blackouts = d.blackouts.includes(date) ? d.blackouts.filter((x) => x !== date) : [...d.blackouts, date];
        }),

      addPersonalUse: (date, note) =>
        get().mutate((d) => {
          const me = get().ownerId ?? d.owners[0].id;
          d.bookings.push({
            id: uid("bk"),
            ref: `OWN-${date.slice(5).replace("-", "")}`,
            kind: "personal",
            ownerId: me,
            date,
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
            state: "confirmed",
            bondStatus: "none",
            createdAt: new Date().toISOString(),
            createdVia: "admin",
            eventType: "Owner use",
            notes: note,
            agreementSigned: true,
            deliver: { ownerId: me, done: false },
            collect: { ownerId: me, done: false },
          });
        }),

      addTruckLog: (l) =>
        get().mutate((d) => {
          d.truck.push({ ...l, id: uid("tl") });
        }),

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
      name: "sunrise-sunset-demo",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ data: s.data, ownerId: s.ownerId }),
      skipHydration: true,
    },
  ),
);
