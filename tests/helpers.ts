import { runRules } from "@/lib/agent/rules";
import type { ToolCtx } from "@/lib/agent/tools";
import { buildSeed } from "@/lib/seed";
import { snapshot } from "@/lib/store";
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
