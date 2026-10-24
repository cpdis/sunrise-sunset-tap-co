// The simulated outbox (R4). A change that sends something queues it on the document (lib/ops.ts send); the repo
// takes the queue off before it saves and writes these rows in the same transaction, so a message goes out exactly
// when its change is saved. Nothing here really sends: each row is the SMS or email a live business would send.
import { BUSINESS } from "@/lib/config";
import type { Data, Outgoing, Owner } from "@/lib/types";
import { sameContact } from "@/lib/util";
import type { OutboxMessage } from "./db/repo";
import { publicBaseUrl } from "./signature";

// The admin page that opens one conversation.
export const conversationUrl = (convId: string, base = publicBaseUrl()) => `${base}/admin/inbox?c=${encodeURIComponent(convId)}`;

// One queued message as the outbox row it becomes. An escalation is one notice to the owners' shared inbox: who,
// why, and the link to the conversation.
export function render(d: Data, m: Outgoing): OutboxMessage {
  if (m.kind === "reply") {
    return { channel: m.channel, to: m.to, subject: m.channel === "email" ? `Re: your message to ${BUSINESS.name}` : null, body: m.body };
  }
  const c = d.conversations.find((x) => x.id === m.convId);
  const who = c ? `${c.name} (${c.channel}${c.contact ? `, ${c.contact}` : ""})` : "A customer";
  return {
    channel: "email",
    to: BUSINESS.email,
    subject: `${c?.name ?? "A customer"} needs an owner`,
    body: `${who} needs an owner. Why: ${m.reason} Open the conversation: ${conversationUrl(m.convId)}`,
  };
}

// Takes the queued messages off the document, rendered, so the saved document never carries them.
export function drain(d: Data): OutboxMessage[] {
  const queued = d.outgoing ?? [];
  delete d.outgoing;
  return queued.map((m) => render(d, m));
}

// What one owner may read of the outbox: everything but mail addressed to another owner, such as their sign-in
// link, which would sign the reader in as them.
export function outboxFor<T extends Pick<OutboxMessage, "to">>(rows: T[], owners: Owner[], me: string): T[] {
  const others = owners.filter((o) => o.id !== me);
  return rows.filter((r) => !others.some((o) => sameContact(o.email, r.to) || sameContact(o.phone, r.to)));
}
