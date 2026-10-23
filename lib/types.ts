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
  // Where checkout sent the receipt. Kept on the booking: checkout never changes the customer's own contacts.
  receiptEmail?: string;
  // Simulated card trouble: the saved card declines off-session charges until the customer updates it.
  cardDeclines?: boolean;
  balanceAttempts?: number;
  balanceFailedAt?: string;
  deliver: Run;
  collect: Run;
  condition?: string;
  cancelledAt?: string;
}

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
  refDate?: string;
  // Owner agent: a staged change that runs only if the owner's next text is YES.
  pending?: PendingOwnerAction;
}

export interface PendingOwnerAction {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
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
}

export type Scenario = "bear" | "base" | "bull";

// Commands the agent (server) returns for the client store to apply.
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
      contact: string;
      channel: Channel;
    }
  | { type: "cancel"; bookingId: string }
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
}
