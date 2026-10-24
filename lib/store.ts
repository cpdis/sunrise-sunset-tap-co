"use client";

// The browser's copy of what the server lets this visitor see (R14). It never changes data itself: each action is a
// named server command (lib/server/commands.ts), and the copy is read again from /api/state after it.
import { create } from "zustand";
import type { NewBooking } from "./domain";
import type { Account, ApprovalCode, Conversation, Data, KbPage, Scenario, Settings, TruckLog } from "./types";
import type { BookingView, ChatView, PublicView, StateView } from "./views";

type Booked = { id: string; token: string };
// A web booking the server refused, and why (lib/domain.ts createHold).
type Refused = { refused: string };

// Where a simulated inbound message comes from: the sender's conversation on that channel (made if new).
export type To = Pick<Conversation, "channel" | "contact"> & { name?: string };

interface AppState {
  // A signed-in owner's whole business document, and who they are.
  data: Data | null;
  ownerId: string | null;
  // The one-time codes for changes this owner texted, for the admin header (KTD6).
  codes: ApprovalCode[];
  // What anyone may see: availability, settings and the knowledge base.
  pub: PublicView | null;
  // A customer's booking link, and the booking it opened (bookingFor says which link that answer was for).
  link: Booked | null;
  booking: BookingView | null;
  bookingFor: string | null;
  // The SMS widget's number, and its conversation.
  chatWith: string | null;
  chat: ChatView | null;
  // What this browser's simulated phone shows for the messages it sent and got, by message id, where the stored copy
  // masks a code (B2): the confirmation's nonce, the code it was answered with.
  handset: Record<string, string>;
  hydrated: boolean;
  // Why the last command failed, for the page to show.
  error: string | null;
  refresh: () => Promise<void>;
  openLink: (id: string, token: string) => Promise<void>;
  watchChat: (contact: string) => Promise<void>;
  logout: () => Promise<void>;
  dismissError: () => void;
  reset: (scenario?: Scenario) => Promise<void>;
  // The demo's "Run daily jobs now". What ran, or null when it failed.
  runJobs: () => Promise<string[] | null>;
  book: (n: Omit<NewBooking, "via" | "id" | "ref" | "token">) => Promise<Booked | Refused | null>;
  payDeposit: (bookingId: string, card: string, checkout?: { email?: string; agreed?: boolean }) => Promise<boolean>;
  payBalance: (bookingId: string, card: string) => Promise<boolean>;
  customerCancel: (bookingId: string) => Promise<{ refund: number } | { needsOwner: string } | null>;
  cancel: (bookingId: string) => Promise<void>;
  sendCustomer: (to: To, body: string) => Promise<string>;
  ownerReply: (convId: string, body: string) => Promise<void>;
  setAgentActive: (convId: string, active: boolean) => Promise<void>;
  handBack: (convId: string, force?: boolean) => Promise<void>;
  setDraft: (convId: string, draft: string) => Promise<void>;
  markRead: (convId: string) => Promise<void>;
  claimRun: (bookingId: string, which: "deliver" | "collect") => Promise<void>;
  captureBond: (bookingId: string, amount: number, note: string) => Promise<void>;
  returnedClean: (bookingId: string) => Promise<void>;
  chargeBalanceNow: (bookingId: string) => Promise<void>;
  addExpense: (date: string, account: Account, amount: number, memo: string) => Promise<void>;
  approveDistribution: (distId: string) => Promise<void>;
  payDistribution: (distId: string) => Promise<void>;
  updateSettings: (s: Partial<Settings>) => Promise<void>;
  saveKb: (page: KbPage) => Promise<void>;
  toggleBlackout: (date: string) => Promise<void>;
  addPersonalUse: (date: string, note: string) => Promise<void>;
  addTruckLog: (log: Omit<TruckLog, "id">) => Promise<void>;
  // Share transfers and lowering the payout approvals wait for a second director (B5).
  transferShares: (fromId: string, toId: string, shares: number) => Promise<void>;
  approveRequest: (id: string) => Promise<void>;
  declineRequest: (id: string) => Promise<void>;
}

// What /api/commands answers.
type CommandOut = { result?: unknown };

function post(body: string, url = "/api/commands") {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
}

// One command under a fresh idempotency key. A dropped connection may still have reached the server, so it is
// retried once with the same key: the server runs it at most once.
async function call(command: string, args: object): Promise<CommandOut> {
  const body = JSON.stringify({ command, args, key: crypto.randomUUID() });
  const res = await post(body).catch(() => post(body));
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Something went wrong (${res.status}).`);
  return out;
}

// Only the newest read lands, so a slow one never overwrites a newer answer.
let reads = 0;

// The simulated phone's texts last for the browser tab, like texts on a phone outlast a page reload. Storage can be
// missing or full; the phone then forgets on reload.
const HANDSET_KEY = "sst-handset";
const HANDSET_MAX = 200;

function savedHandset(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(HANDSET_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveHandset(h: Record<string, string>) {
  try {
    sessionStorage.setItem(HANDSET_KEY, JSON.stringify(h));
  } catch {
    // Kept in memory only.
  }
}

export const useApp = create<AppState>()((set, get) => {
  // Runs a command and reads the state again. A failure is kept in `error`; the caller gets undefined.
  async function run(command: string, args: object = {}): Promise<CommandOut | undefined> {
    try {
      return await call(command, args);
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      await get().refresh();
    }
  }
  // The token for a booking this visitor opened by its link.
  const tokenFor = (bookingId: string) => (get().link?.id === bookingId ? get().link!.token : "");
  const done = async (command: string, args: object) => void (await run(command, args));

  return {
    data: null,
    ownerId: null,
    codes: [],
    pub: null,
    link: null,
    booking: null,
    bookingFor: null,
    chatWith: null,
    chat: null,
    handset: savedHandset(),
    hydrated: false,
    error: null,

    refresh: async () => {
      const mine = ++reads;
      const { link, chatWith } = get();
      const q = new URLSearchParams();
      if (link) {
        q.set("booking", link.id);
        q.set("t", link.token);
      }
      if (chatWith) q.set("chat", chatWith);
      const res = await fetch(`/api/state?${q}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok || mine !== reads) return;
      const s = (await res.json()) as StateView;
      if (mine !== reads) return;
      set({ pub: s.pub, data: s.owner?.data ?? null, ownerId: s.owner?.id ?? null, codes: s.owner?.codes ?? [], booking: s.booking ?? null, bookingFor: link?.id ?? null, chat: s.chat ?? null, hydrated: true });
    },

    openLink: async (id, token) => {
      set({ link: { id, token } });
      await get().refresh();
    },

    watchChat: async (contact) => {
      if (get().chatWith === contact) return;
      set({ chatWith: contact, chat: null });
      await get().refresh();
    },

    logout: async () => {
      await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
      set({ data: null, ownerId: null, codes: [] });
      await get().refresh();
    },

    dismissError: () => set({ error: null }),

    reset: (scenario) => done("reset", { scenario }),
    runJobs: async () => ((await run("runJobs"))?.result as { ran?: string[] } | undefined)?.ran ?? null,

    // Refused when the date was taken since the page checked it, or this contact already holds an unpaid date. null
    // when the command failed.
    book: async (n) => {
      const r = (await run("book", n))?.result as Partial<Booked & Refused> | undefined;
      return r?.id && r.token ? { id: r.id, token: r.token } : r?.refused ? { refused: r.refused } : null;
    },

    payDeposit: async (bookingId, card, checkout = {}) => !!(await run("payDeposit", { bookingId, token: tokenFor(bookingId), card, ...checkout })),
    payBalance: async (bookingId, card) => !!(await run("payBalance", { bookingId, token: tokenFor(bookingId), card })),
    customerCancel: async (bookingId) => {
      const r = (await run("customerCancel", { bookingId, token: tokenFor(bookingId) }))?.result;
      return r && ("refund" in (r as object) || "needsOwner" in (r as object)) ? (r as { refund: number } | { needsOwner: string }) : null;
    },
    cancel: (bookingId) => done("cancel", { bookingId }),

    // The message goes to /api/dev/simulate, which signs it and posts it through the inbound webhook, where the server
    // stores it and runs the agent's turn (lib/server/inbound.ts). Not retried: a second post would be a second
    // message. Returns the conversation id, or "" when refused (for example another owner's number, or too many
    // messages a minute). The answer's `handset` is what the phone shows for this turn.
    sendCustomer: async (to, body) => {
      try {
        const res = await post(JSON.stringify({ ...to, body }), "/api/dev/simulate");
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? `Something went wrong (${res.status}).`);
        const handset = Object.fromEntries(Object.entries({ ...get().handset, ...(out.handset as Record<string, string> | undefined) }).slice(-HANDSET_MAX));
        set({ handset });
        saveHandset(handset);
        return (out.conversation as ChatView | undefined)?.id ?? "";
      } catch (err) {
        set({ error: (err as Error).message });
        return "";
      } finally {
        await get().refresh();
      }
    },

    ownerReply: (convId, body) => done("ownerReply", { convId, body }),
    setAgentActive: (convId, active) => done("setAgentActive", { convId, active }),
    handBack: (convId, force) => done("handBack", { convId, force }),
    setDraft: (convId, draft) => done("setDraft", { convId, draft }),
    markRead: (convId) => done("markRead", { convId }),
    claimRun: (bookingId, which) => done("claimRun", { bookingId, which }),
    captureBond: (bookingId, amount, note) => done("captureBond", { bookingId, amount, note }),
    returnedClean: (bookingId) => done("returnedClean", { bookingId }),
    chargeBalanceNow: (bookingId) => done("chargeBalanceNow", { bookingId }),
    addExpense: (date, account, amount, memo) => done("addExpense", { date, account, amount, memo }),
    approveDistribution: (distId) => done("approveDistribution", { distId }),
    payDistribution: (distId) => done("payDistribution", { distId }),
    updateSettings: (patch) => done("updateSettings", { patch }),
    saveKb: (page) => done("saveKb", { page }),
    toggleBlackout: (date) => done("toggleBlackout", { date }),
    addPersonalUse: (date, note) => done("addPersonalUse", { date, note }),
    addTruckLog: (log) => done("addTruckLog", { log }),
    transferShares: (fromId, toId, shares) => done("transferShares", { fromId, toId, shares }),
    approveRequest: (id) => done("approveRequest", { id }),
    declineRequest: (id) => done("declineRequest", { id }),
  };
});
