import { runOwnerRules } from "@/lib/agent/owner-rules";
import type { OwnerCtx } from "@/lib/agent/owner-tools";
import { runRules } from "@/lib/agent/rules";
import { cancelBooking } from "@/lib/domain";
import { applyOwnerAction } from "@/lib/ops";
import type { ToolCtx } from "@/lib/agent/tools";
import { BUSINESS } from "@/lib/config";
import { buildSeed } from "@/lib/seed";
import { DEV_WEBHOOK_SECRET, type InboundKind, SIGNATURE_HEADER, inboundUrl, sign } from "@/lib/server/signature";
import { ownerSnapshot, snapshot } from "@/lib/views";
import type { AgentState, Data } from "@/lib/types";

export const NOW = new Date("2026-10-22T12:00:00+08:00");

export function seed(): Data {
  return buildSeed(NOW);
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
  const sig = opts.signature === undefined ? sign(opts.secret ?? DEV_WEBHOOK_SECRET[kind], opts.url ?? url, all) : opts.signature;
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

// Runs an owner's texts through the owner rules engine and applies the actions to d, as lib/server/agent.ts does.
export function ownerChat(d: Data, ownerId: string, lines: string[]) {
  let state: AgentState = {};
  return lines.map((text) => {
    const owner = d.owners.find((o) => o.id === ownerId)!;
    const ctx: OwnerCtx = { data: ownerSnapshot(d, NOW), owner, now: NOW, actions: [], used: [] };
    const r = runOwnerRules(ctx, text, state);
    state = r.state;
    for (const a of r.actions) {
      if (a.type === "cancel") cancelBooking(d, a.bookingId, NOW);
      else applyOwnerAction(d, a, ownerId);
    }
    return r;
  });
}
