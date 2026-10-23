import { runOwnerRules } from "@/lib/agent/owner-rules";
import { runRules } from "@/lib/agent/rules";
import { cancelBooking } from "@/lib/domain";
import { applyOwnerAction } from "@/lib/ops";
import type { ToolCtx } from "@/lib/agent/tools";
import { BUSINESS } from "@/lib/config";
import { buildSeed } from "@/lib/seed";
import { approvalCode } from "@/lib/server/approvals";
import { sessionCookie } from "@/lib/server/auth";
import { DEMO_TENANT } from "@/lib/server/db/repo";
import { DEV_WEBHOOK_SECRET, type InboundKind, SIGNATURE_HEADER, inboundUrl, sign } from "@/lib/server/signature";
import { ownerSnapshot, snapshot } from "@/lib/views";
import type { AgentState, Data, StagedApproval } from "@/lib/types";

export const NOW = new Date("2026-10-22T12:00:00+08:00");

export function seed(): Data {
  return buildSeed(NOW);
}

// A Cookie header for an owner's session, as the confirm page's sign-in sets it. `sv` is the owner's session
// version when it was signed and `demo` whether the business's demo features were on (lib/server/auth.ts): the
// demo business has them on in tests, any other business off.
export function sessionFor(ownerId: string, opts: { tenant?: string; sv?: number; demo?: boolean } = {}) {
  const tenant = opts.tenant ?? DEMO_TENANT;
  const c = sessionCookie({ tenant, ownerId, sv: opts.sv ?? 0, demo: opts.demo ?? tenant === DEMO_TENANT }, new URL("http://localhost:3000"));
  return `${c.name}=${c.value}`;
}

let sid = 0;

// An inbound webhook as the provider posts it: To the business line, a fresh MessageSid, and `fields`, signed with
// the dev secret over the public URL. `secret`, `url` or `signature` (null: no header) forge it; `tamper` changes
// the fields after signing.
export function inboundReq(
  kind: InboundKind,
  fields: Record<string, string>,
  opts: { secret?: string; url?: string; signature?: string | null; tamper?: (f: [string, string][]) => [string, string][] } = {},
) {
  const all: [string, string][] = Object.entries({ To: kind === "sms" ? BUSINESS.sms : BUSINESS.email, MessageSid: `SMtest${++sid}`, ...fields });
  const url = inboundUrl(kind);
  const sig = opts.signature === undefined ? sign(opts.secret ?? DEV_WEBHOOK_SECRET[kind], opts.url ?? url, Object.fromEntries(all)) : opts.signature;
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(sig !== null && { [SIGNATURE_HEADER[kind]]: sig }) },
    body: new URLSearchParams(opts.tamper ? opts.tamper(all) : all),
  });
}

// Runs a conversation through the rules engine, carrying state between turns. "{code}" in a line is the code the
// last cancel quote asked for (KTD11), as the real handset would see it; "{wrong}" is any other code.
export function chat(d: Data, contact: string, lines: string[], opts: { handover?: boolean; now?: Date } = {}) {
  let state: AgentState = {};
  return lines.map((line) => {
    const text = line.replace("{code}", state.code ?? "").replace("{wrong}", state.code === "1234" ? "4321" : "1234");
    const ctx: ToolCtx = {
      data: snapshot(d, contact),
      contact,
      channel: "sms",
      now: opts.now ?? NOW,
      actions: [],
      used: [],
      origin: "https://x.test",
      handover: opts.handover,
    };
    const r = runRules(ctx, text, state);
    state = r.state;
    return r;
  });
}

// An owner texting from their own number, through the owner rules engine, with the actions applied to d as
// lib/server/agent.ts applies them. The staged approval carries over between texts as the approvals table keeps it.
// In a text, "{nonce}" is the nonce the last confirmation asked for (KTD11) and "{code}" the one-time code the
// owner's admin page shows for it (KTD6), as the real owner would see them.
export function ownerSession(d: Data, ownerId: string) {
  let pending: StagedApproval | undefined;
  return {
    get pending() {
      return pending;
    },
    say(line: string, now = NOW) {
      const code = pending ? approvalCode(DEMO_TENANT, pending.id) : "";
      const text = line.replace("{nonce}", pending?.nonce ?? "").replace("{code}", code);
      const owner = d.owners.find((o) => o.id === ownerId)!;
      const live = pending && { ...pending, code: pending.needsCode ? code : undefined, expired: Date.parse(pending.expiresAt) <= now.getTime() };
      const r = runOwnerRules({ data: ownerSnapshot(d, now), owner, now, actions: [], used: [], pending: live }, text);
      if (r.approval?.settled) pending = undefined;
      if (r.approval?.staged) pending = r.approval.staged;
      for (const a of r.actions) {
        if (a.type === "cancel") cancelBooking(d, a.bookingId, now);
        else applyOwnerAction(d, a, ownerId);
      }
      return r;
    },
  };
}

export function ownerChat(d: Data, ownerId: string, lines: string[]) {
  const s = ownerSession(d, ownerId);
  return lines.map((line) => s.say(line));
}
