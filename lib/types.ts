export type Block = 4 | 8;

export type BookingState =
  | "held"
  | "confirmed"
  | "balance_paid"
  | "completed"
  | "cancelled";

export type Channel = "web" | "sms" | "email" | "phone" | "admin";

export interface Settings {
  price4: number;
  price8: number;
  deposit: number;
  bond: number;
  travelFee: number;
  travelThresholdMin: number;
  runnerFee: number;
  balanceDaysBefore: number;
  bondHoldDaysBefore: number;
  cancelDays: number;
  holdMinutes: number;
  minNoticeDays: number;
  bookAheadMonths: number;
  reserveMonths: number;
  fixedMonthly: number;
  maintPerKm: number;
  taxRate: number;
  refundLimit: number;
  approvalsRequired: number;
  // The largest expense one owner can log by SMS; bigger ones go in the admin.
  smsExpenseCap: number;
}

export interface Owner {
  id: string;
  name: string;
  email: string;
  phone: string;
  shares: number;
  isDirector: boolean;
  payoutAccount: string;
  joined: string;
  // Counts this owner's sign-outs (lib/server/auth.ts): a session cookie is good only while it carries the current
  // value, so signing out ends the owner's sessions on every device. Absent is 0.
  sessionVersion?: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface Run {
  ownerId?: string;
  done: boolean;
}

export interface Booking {
  id: string;
  ref: string;
  kind: "paid" | "personal";
  customerId?: string;
  ownerId?: string;
  date: string;
  block: Block;
  startTime: string;
  suburb: string;
  travelMinutes: number;
  km: number;
  price: number;
  travelFee: number;
  total: number;
  deposit: number;
  bond: number;
  state: BookingState;
  bondStatus: "none" | "held" | "released" | "captured";
  bondCaptured?: number;
  heldUntil?: string;
  createdAt: string;
  createdVia: Channel;
  eventType?: string;
  guests?: number;
  notes?: string;
  agreementSigned: boolean;
  // Where the receipt goes: the email given with this booking, or the one checkout took. Kept on the booking, never
  // read from the customer record, so a booking made with someone else's phone never shows their email (AUTH-06).
  receiptEmail?: string;
  // The secret in the customer's checkout and booking links. Random and separate from the id, so a booking id
  // alone (in a log, a screenshot, an owner's view) opens nothing. Paid bookings always have one.
  token?: string;
  // Simulated card trouble: the saved card declines off-session charges until the customer updates it.
  cardDeclines?: boolean;
  balanceAttempts?: number;
  balanceFailedAt?: string;
  deliver: Run;
  collect: Run;
  condition?: string;
  cancelledAt?: string;
}

// What availability needs from a booking: the day it takes and whether it still counts. Public views carry only
// this, so nobody learns who booked or for how much.
export type Slot = Pick<Booking, "date" | "kind" | "state" | "heldUntil">;

export type PaymentType =
  | "deposit"
  | "balance"
  | "bond_hold"
  | "bond_release"
  | "bond_capture"
  | "refund";

export interface Payment {
  id: string;
  bookingId: string;
  type: PaymentType;
  amount: number;
  fee: number;
  status: "succeeded" | "failed" | "pending";
  at: string;
  card: string;
}

export type Account =
  | "capital"
  | "truck"
  | "setup"
  | "revenue"
  | "refunds"
  | "stripe_fees"
  | "runner_fees"
  | "fuel"
  | "co2"
  | "cleaning"
  | "insurance"
  | "rego"
  | "maintenance"
  | "software"
  | "dividends"
  | "bond"
  // Balance-sheet accounts. Customer payments sit in deposits until the hire happens or the deposit is forfeited;
  // runner fees sit in owed_runners until the quarterly payout.
  | "deposits"
  | "owed_runners"
  | "depreciation"
  | "accounting"
  | "marketing"
  | "breakage";

export interface LedgerEntry {
  id: string;
  date: string;
  account: Account;
  amount: number;
  memo: string;
  ref?: string;
  ownerId?: string;
}

export interface Msg {
  id: string;
  from: "customer" | "agent" | "owner" | "system";
  body: string;
  at: string;
  ownerId?: string;
  tools?: string[];
  // Owner replies: how the reply actually went out (lib/ops.ts replyRoute).
  via?: "sms" | "email";
  to?: string;
}

export interface AgentState {
  date?: string;
  block?: Block;
  suburb?: string;
  name?: string;
  startTime?: string;
  // The customer has said yes to booking; the hold goes through once the details are complete.
  agreed?: boolean;
  // Consecutive replies that didn't give the thing the agent asked for.
  misses?: number;
  // SST- references in a row that aren't the sender's. The second goes to an owner.
  refMisses?: number;
  awaiting?: "date" | "name" | "suburb" | "confirm_hold" | "confirm_cancel";
  bookingId?: string;
  // A cancel quote: the code the customer's YES must echo (KTD11) and the refund the quote stated.
  code?: string;
  refund?: number;
  refDate?: string;
}

// An owner change waiting for YES (KTD4, KTD11). The server keeps it in the approvals table, bound to its business,
// owner and conversation, and it expires after APPROVAL_MINUTES (lib/agent/owner-tools.ts).
export interface StagedApproval {
  id: string;
  // The owner tool that runs on YES, and its input with the conversation it names resolved to an id. A
  // "pick_conversation" is a numbered list of conversations instead: a number answers it, it changes nothing by
  // itself, and it has no nonce.
  tool: string;
  args: Record<string, unknown>;
  // What the owner is asked to confirm (KTD5).
  summary: string;
  // The actions and summary YES applies, as canonical JSON. A YES whose re-run gives anything else asks again.
  binding: string;
  // The 4-digit code the YES must echo, sent only to the owner's handset (KTD11).
  nonce: string;
  // Money, settings, knowledge and draft sends also need the one-time code on the owner's admin page (KTD6).
  needsCode: boolean;
  policyVersion: number;
  expiresAt: string;
}

// The approval waiting when an owner's message comes in, as the server hands it to the owner agent: with its
// one-time code when it needs one, whether its time ran out, and how many wrong codes it has had (B1).
export interface PendingApproval extends StagedApproval {
  code?: string;
  expired: boolean;
  codeMisses: number;
}

export type ApprovalStatus = "consumed" | "cancelled" | "invalidated" | "expired";

// A one-time code the signed-in owner's admin page shows, next to the change it is for (lib/server/approvals.ts).
export interface ApprovalCode {
  id: string;
  summary: string;
  code: string;
  expiresAt: string;
}

// What an owner's turn does to approvals. lib/server/agent.ts writes it in the same transaction as the actions.
export interface ApprovalChange {
  // The approval the message answered and what becomes of it. Left out, it stays staged (asked again for its code).
  settled?: { id: string; status: ApprovalStatus };
  staged?: StagedApproval;
  // The message quoted a wrong nonce or one-time code for this approval (B1). The server counts it against the
  // sender's day, and a wrong one-time code against the approval's tries.
  miss?: { id: string; kind: "nonce" | "code" };
}

// A change one director asked for in the admin that a second, different director must approve before it happens (B5):
// lowering the approvals a payout needs, or moving shares between owners. Approving applies it; declining drops it.
export interface DirectorRequest {
  id: string;
  change: { type: "approvals"; to: number } | { type: "shares"; fromId: string; toId: string; shares: number };
  // The director who asked, and when.
  by: string;
  at: string;
}

export interface Conversation {
  id: string;
  channel: Exclude<Channel, "admin">;
  contact: string;
  name: string;
  customerId?: string;
  // Set when the sender is an owner texting the business line; their texts are stored as "customer" (inbound).
  ownerId?: string;
  // The owner who took the conversation off the agent, while they have it.
  handledBy?: string;
  agentActive: boolean;
  escalated?: string;
  // The agent's suggested reply for the hand-over, until an owner sends or replaces it.
  draft?: string;
  unread: boolean;
  state: AgentState;
  messages: Msg[];
}

export interface DistributionLine {
  ownerId: string;
  shares: number;
  amount: number;
  // Runner fees owed to this owner at quarter end, paid in the same transfer.
  runnerFees: number;
  // The owed_runners ledger entries those fees settle. No other distribution lists them.
  runnerFeeEntries: string[];
  payoutId?: string;
}

export interface Distribution {
  id: string;
  quarter: string;
  start: string;
  end: string;
  revenue: number;
  expenses: number;
  profit: number;
  taxProvision: number;
  cash: number;
  reserve: number;
  // Customer money for hires that haven't happened yet, and runner fees owed; both are kept back.
  deposits: number;
  owedRunners: number;
  distributable: number;
  lines: DistributionLine[];
  approvals: string[];
  status: "awaiting" | "paid";
  paidAt?: string;
}

export interface TruckLog {
  id: string;
  date: string;
  type: "service" | "clean" | "odometer" | "incident" | "purchase";
  notes: string;
  odometer?: number;
}

export interface KbPage {
  slug: string;
  title: string;
  body: string;
}

export interface JobLog {
  at: string;
  text: string;
}

export interface Data {
  version: number;
  seededAt: string;
  settings: Settings;
  owners: Owner[];
  customers: Customer[];
  bookings: Booking[];
  payments: Payment[];
  ledger: LedgerEntry[];
  conversations: Conversation[];
  distributions: Distribution[];
  truck: TruckLog[];
  kb: KbPage[];
  blackouts: string[];
  jobs: JobLog[];
  seq: number;
  scenario: Scenario;
  // Changes waiting for a second director (B5). Absent is none.
  requests?: DirectorRequest[];
  // What a change sends (lib/ops.ts send). Never stored: the repo turns these into outbox rows in the same
  // transaction as the save, and drops them from the document (lib/server/outbox.ts).
  outgoing?: Outgoing[];
}

// A message a change sends: an owner's reply to a customer, or the owners' notice that a conversation needs them.
export type Outgoing = { kind: "reply"; channel: "sms" | "email"; to: string; body: string } | { kind: "escalation"; convId: string; reason: string };

export type Scenario = "bear" | "base" | "bull";

// Actions the agent returns. lib/server/agent.ts applies them after the turn, for the conversation's own sender.
export type AgentAction =
  | {
      type: "hold";
      bookingId: string;
      ref: string;
      date: string;
      block: Block;
      startTime?: string;
      suburb: string;
      name: string;
      // The booking's link token, made with the hold so the link in the reply opens it.
      token: string;
    }
  // refund: what the confirmed terms refund. The cancel applies only while the policy still gives exactly that.
  | { type: "cancel"; bookingId: string; refund: number }
  // keepAgent: flag it for an owner but let the agent carry on (short notice, date changes, unknown suburbs).
  // draft: a reply the owner can send as-is (shown in the inbox queue, cleared by ownerReply).
  | { type: "escalate"; reason: string; keepAgent?: boolean; draft?: string }
  // Owner agent actions, applied as the owner who texted (lib/ops.ts).
  | { type: "claim_run"; bookingId: string; which: ("deliver" | "collect")[] }
  | { type: "truck_log"; log: Omit<TruckLog, "id"> }
  | { type: "expense"; date: string; account: Account; amount: number; memo: string }
  | { type: "approve_payout"; distId: string }
  | { type: "pay_payout"; distId: string }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "kb_append"; slug: string; line: string }
  | { type: "blackout"; date: string; on: boolean }
  | { type: "own_use"; date: string; note: string }
  | { type: "owner_reply"; convId: string; body: string }
  // force: hand back although the customer was promised an owner reply that nobody sent.
  | { type: "hand_back"; convId: string; force?: boolean }
  // Send the agent's draft reply for a handed-over conversation as the owner.
  | { type: "send_draft"; convId: string };

export interface AgentResult {
  reply: string;
  actions: AgentAction[];
  tools: string[];
  state: AgentState;
  engine: "claude" | "rules";
  // Model tokens the turn spent, for the daily budget (lib/server/limits.ts). The rules engine spends none.
  tokens?: number;
  // Owner agent only.
  approval?: ApprovalChange;
}
