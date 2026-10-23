// One schema for PGlite (local and tests) and hosted Postgres (DATABASE_URL). `npm run db:generate` writes the
// migration in drizzle/ after a change here. Every row carries a tenant id: one tenant is one business (R16).
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Data } from "@/lib/types";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // The public demo business (A1): only seedDemo sets it. The demo features (simulated sign-in links, the SMS
  // simulator, the reset) need it as well as DEMO_MODE, so a real business never has them.
  demo: boolean("demo").notNull().default(false),
  createdAt: createdAt(),
});

// Each business's data as one document (KTD1). `version` counts saves and guards compare-and-swap writes;
// `dataVersion` is the document's own shape version (Data.version, lib/seed.ts DATA_VERSION).
export const tenantState = pgTable("tenant_state", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  version: integer("version").notNull(),
  dataVersion: integer("data_version").notNull(),
  data: jsonb("data").$type<Data>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// A staged owner change, bound to its exact targets and consumed once (KTD4, KTD11). Rows stay after they settle,
// as the record of what was staged and what ran. The one-time code is never stored (lib/server/approvals.ts).
export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // The owner who staged it.
    ownerId: text("owner_id"),
    conversationId: text("conversation_id").notNull(),
    tool: text("tool").notNull(),
    // The tool's input, with targets pinned to ids.
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    // The exact actions and summary a YES applies (StagedApproval.binding).
    binding: text("binding").notNull(),
    nonce: text("nonce").notNull(),
    needsCode: boolean("needs_code").notNull().default(false),
    // Wrong one-time codes so far. The CODE_TRIES-th closes it (lib/agent/owner-tools.ts, B1).
    codeMisses: integer("code_misses").notNull().default(0),
    policyVersion: integer("policy_version").notNull(),
    status: text("status", { enum: ["staged", "consumed", "invalidated", "cancelled", "expired"] })
      .notNull()
      .default("staged"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [index("approvals_conversation_idx").on(t.tenantId, t.conversationId, t.status), index("approvals_owner_idx").on(t.tenantId, t.ownerId, t.status)],
);

// Fixed-window counters (KTD8). `bucket` names what is counted, for example a sender's messages or the day's
// model tokens; `count` is how many in the window that starts at `windowStart`.
export const rateLimits = pgTable(
  "rate_limits",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.bucket, t.windowStart] })],
);

// A command's result, kept so a retry with the same key returns it instead of running the command again. Server
// one-time keys (sign-in link nonces, inbound message ids, the day's budget alert) share the table under their own
// prefixes; a command's key is stored under "cmd:", so a caller can't spend one of them (F09).
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: text("key").notNull(),
    command: text("command").notNull(),
    // A digest of the command, its arguments and its caller. A replay must match it (lib/server/commands.ts, B8).
    request: text("request").notNull().default(""),
    result: jsonb("result").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

// Simulated outgoing SMS and email: sign-in links, owner alerts, customer texts.
export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    channel: text("channel", { enum: ["sms", "email"] }).notNull(),
    to: text("to").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_tenant_idx").on(t.tenantId, t.createdAt)],
);
