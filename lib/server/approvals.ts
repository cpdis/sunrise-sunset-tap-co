// Owner approvals on the server (KTD4, KTD6). The owner agent stages a change (lib/agent/owner-tools.ts); the
// approvals table keeps it, bound to its business, owner and conversation, with its exact actions, its nonce and a
// 10-minute expiry, and the agent gets it back with that conversation's next message. A YES consumes it in the same
// transaction as its actions (repo.mutateApprovals), after planning it again on the data as it is then, so a
// second, stale, expired or misdirected YES applies nothing.
//
// The one-time code is not stored, not even hashed: six digits have only a million values, so a hash in the
// database gives the code to anyone with a copy. It is an HMAC of the approval's random id under APPROVAL_SECRET,
// which the admin page works out again, for the owner who staged it only. That secret is its own, apart from the
// session secret, so rotating one leaves the other alone (A7).
import { createHmac } from "node:crypto";
import { CODE_TRIES, type OwnerCtx, PICK, replan } from "@/lib/agent/owner-tools";
import type { ApprovalChange, ApprovalCode, Data, Owner, PendingApproval, StagedApproval } from "@/lib/types";
import { ownerSnapshot } from "@/lib/views";
import type { ApprovalRow, ApprovalWrites, NewApprovalRow, Repo } from "./db/repo";
import { type Env, secret } from "./secrets";

// The six-digit code for one approval. Each approval's id is random, so each gets its own code.
export function approvalCode(tenant: string, approvalId: string, env?: Env) {
  const n = createHmac("sha256", secret("APPROVAL_SECRET", env)).update(`${tenant}:${approvalId}`).digest().readUInt32BE(0);
  return String(n % 1_000_000).padStart(6, "0");
}

const live = (r: ApprovalRow, now: Date) => r.expiresAt.getTime() > now.getTime();

const toStaged = (r: ApprovalRow): StagedApproval => ({
  id: r.id,
  tool: r.tool,
  args: r.args,
  summary: r.summary,
  binding: r.binding,
  nonce: r.nonce,
  needsCode: r.needsCode,
  policyVersion: r.policyVersion,
  expiresAt: r.expiresAt.toISOString(),
});

const toRow = (s: StagedApproval, ownerId: string): NewApprovalRow => ({
  id: s.id,
  ownerId,
  tool: s.tool,
  args: s.args,
  summary: s.summary,
  binding: s.binding,
  nonce: s.nonce,
  needsCode: s.needsCode,
  policyVersion: s.policyVersion,
  expiresAt: new Date(s.expiresAt),
});

// The conversation's staged approval, as the owner agent gets it with a new message: with its code when it needs
// one, whether it has expired, and its wrong codes so far.
export async function pendingApproval(repo: Repo, tenant: string, conversationId: string, now: Date): Promise<PendingApproval | undefined> {
  const [r] = await repo.stagedApprovals(tenant, conversationId);
  return r && { ...toStaged(r), code: r.needsCode ? approvalCode(tenant, r.id) : undefined, expired: !live(r, now), codeMisses: r.codeMisses };
}

// The live approvals waiting on this owner's one-time code, in conversations the business still has (a demo reset
// replaces them all). Only this owner's own: another owner's session never sees them.
export async function codesFor(repo: Repo, d: Data, tenant: string, ownerId: string, now: Date): Promise<ApprovalCode[]> {
  const rows = await repo.ownerApprovals(tenant, ownerId);
  return rows
    .filter((r) => r.needsCode && live(r, now) && d.conversations.some((c) => c.id === r.conversationId))
    .map((r) => ({ id: r.id, summary: r.summary, code: approvalCode(tenant, r.id), expiresAt: r.expiresAt.toISOString() }));
}

// What a turn closes on its conversation's staged approvals, and the wrong one-time code it counts (B1). These only
// take away what can run, so they apply even when the rest of the turn is out of date and dropped: a wrong nonce
// still ends its approval when a newer message overtook the turn (F07).
export function closingWrites(change: ApprovalChange | undefined, staged: ApprovalRow[]): ApprovalWrites {
  const writes: ApprovalWrites = {};
  const s = change?.settled;
  const m = change?.miss;
  if (s && s.status !== "consumed" && staged.some((r) => r.id === s.id)) writes.close = [{ id: s.id, status: s.status }];
  if (m?.kind === "code" && !s && staged.some((r) => r.id === m.id)) writes.codeMiss = { id: m.id, tries: CODE_TRIES };
  return writes;
}

// The approval writes for one owner turn, checked again inside the write that applies it (KTD4). A YES consumes its
// approval only while the approval is staged and unexpired and plans the same on the data as it is now. Otherwise
// nothing of the turn applies and `refused` is the reply instead (R4).
export function settleApprovals(d: Data, owner: Owner, change: ApprovalChange | undefined, staged: ApprovalRow[], now: Date): { writes: ApprovalWrites; refused?: string } {
  const s = change?.settled;
  const add = change?.staged && { add: toRow(change.staged, owner.id) };
  if (s?.status !== "consumed") return { writes: { ...closingWrites(change, staged), ...add } };
  const row = staged.find((r) => r.id === s.id);
  if (!row || !live(row, now)) {
    return { writes: row ? { close: [{ id: row.id, status: "expired" }] } : {}, refused: "Nothing has changed: that one has expired or was already done. Send it again if you still want it." };
  }
  if (row.tool !== PICK) {
    const ctx: OwnerCtx = { data: ownerSnapshot(d, now), owner, now, actions: [], used: [] };
    const r = replan(ctx, toStaged(row));
    if (!r.ok || !r.same) {
      return { writes: { close: [{ id: row.id, status: "invalidated" }] }, refused: r.ok ? "Something changed while I was on it, so I didn't do it. Send it again if you still want it." : `I didn't do it: ${r.reason}` };
    }
  }
  return { writes: { consume: row.id, ...add } };
}
