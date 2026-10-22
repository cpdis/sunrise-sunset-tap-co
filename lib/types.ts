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
  bookAheadMonths: number;
  reserveMonths: number;
  fixedMonthly: number;
  maintPerKm: number;
  taxRate: number;
  refundLimit: number;
  approvalsRequired: number;
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
  | "bond";

export interface LedgerEntry {
  id: string;
  date: string;
  account: Account;
  amount: number;
  memo: string;
  ref?: string;
}

export interface Msg {
  id: string;
  from: "customer" | "agent" | "owner" | "system";
  body: string;
  at: string;
  ownerId?: string;
  tools?: string[];
}

export interface AgentState {
  date?: string;
  block?: Block;
  suburb?: string;
  name?: string;
  awaiting?: "date" | "name" | "suburb" | "confirm_hold" | "confirm_cancel";
  bookingId?: string;
  refDate?: string;
}

export interface Conversation {
  id: string;
  channel: Exclude<Channel, "admin">;
  contact: string;
  name: string;
  customerId?: string;
  agentActive: boolean;
  escalated?: string;
  unread: boolean;
  state: AgentState;
  messages: Msg[];
}

export interface DistributionLine {
  ownerId: string;
  shares: number;
  amount: number;
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
}

// Commands the agent (server) returns for the client store to apply.
export type AgentAction =
  | {
      type: "hold";
      bookingId: string;
      ref: string;
      date: string;
      block: Block;
      suburb: string;
      name: string;
      contact: string;
      channel: Channel;
    }
  | { type: "cancel"; bookingId: string }
  | { type: "escalate"; reason: string };

export interface AgentResult {
  reply: string;
  actions: AgentAction[];
  tools: string[];
  state: AgentState;
  engine: "claude" | "rules";
}
