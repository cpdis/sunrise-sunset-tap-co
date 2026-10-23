import { runOwnerRules } from "@/lib/agent/owner-rules";
import type { OwnerCtx } from "@/lib/agent/owner-tools";
import { runRules } from "@/lib/agent/rules";
import { cancelBooking } from "@/lib/domain";
import { applyOwnerAction } from "@/lib/ops";
import type { ToolCtx } from "@/lib/agent/tools";
import { buildSeed } from "@/lib/seed";
import { ownerSnapshot, snapshot } from "@/lib/views";
import type { AgentState, Data } from "@/lib/types";

export const NOW = new Date("2026-10-22T12:00:00+08:00");

export function seed(): Data {
  return buildSeed(NOW);
}

// Runs a conversation through the rules engine, carrying state between turns.
export function chat(d: Data, contact: string, lines: string[], opts: { handover?: boolean; now?: Date } = {}) {
  let state: AgentState = {};
  return lines.map((text) => {
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

// Runs an owner's texts through the owner rules engine and applies the actions to d, as the agentReply command does.
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
