import { describe, expect, test } from "vitest";
import { applyOwnerAction, ownerReply, owesReply, replyRoute, setAgentActive } from "@/lib/ops";
import { chat, seed } from "./helpers";

const COLIN = "own_colin";
const harbour = (d: ReturnType<typeof seed>) => d.conversations.find((x) => x.name.startsWith("Harbour"))!;

describe("inbox hand-overs", () => {
  test("replies route by contact: callers get SMS, forms get email", () => {
    expect(replyRoute({ contact: "0433 210 877" })).toEqual({ via: "sms", to: "0433 210 877" });
    expect(replyRoute({ contact: "tom@example.com" })).toEqual({ via: "email", to: "tom@example.com" });
  });

  test("an owner reply records who, where and clears the hand-over and draft", () => {
    const d = seed();
    const c = harbour(d);
    expect(c.draft).toBeTruthy();
    ownerReply(d, c.id, "We can do single days.", COLIN);
    expect(c.messages.at(-1)).toMatchObject({ from: "owner", ownerId: COLIN, via: "email", to: "events@harbourcollective.com.au" });
    expect(c.escalated).toBeUndefined();
    expect(c.draft).toBeUndefined();
    expect(c.handledBy).toBe(COLIN);
    expect(c.messages.some((m) => m.from === "system" && m.body.startsWith("Agent handed over:"))).toBe(true);
  });

  test("send_draft sends the agent's draft as the owner", () => {
    const d = seed();
    const c = harbour(d);
    const draft = c.draft!;
    applyOwnerAction(d, { type: "send_draft", convId: c.id }, COLIN);
    expect(c.messages.at(-1)).toMatchObject({ from: "owner", body: draft, ownerId: COLIN });
    expect(owesReply(c)).toBe(false);
  });

  test("hand back is refused while a reply is owed unless forced", () => {
    const d = seed();
    const c = harbour(d);
    applyOwnerAction(d, { type: "hand_back", convId: c.id }, COLIN);
    expect(c.agentActive).toBe(false);
    applyOwnerAction(d, { type: "hand_back", convId: c.id, force: true }, COLIN);
    expect(c.agentActive).toBe(true);
    expect(c.messages.at(-1)?.body).toBe("Colin handed back to the agent");
  });

  test("take over names the owner", () => {
    const d = seed();
    const c = d.conversations.find((x) => x.channel === "sms")!;
    setAgentActive(d, c.id, false, COLIN);
    expect(c.messages.at(-1)?.body).toBe("Colin took over this conversation");
    expect(c.handledBy).toBe(COLIN);
  });

  test("rules hand-overs carry a draft the owner can send", () => {
    const d = seed();
    const [r] = chat(d, "0499 120 554", ["Can I get a discount for a school fete?"]);
    const esc = r.actions.find((a) => a.type === "escalate");
    expect(esc).toMatchObject({ type: "escalate", draft: expect.stringMatching(/^Hi, one of the owners here\./) });
  });
});
