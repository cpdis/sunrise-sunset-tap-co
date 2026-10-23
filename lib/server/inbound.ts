// Inbound SMS and email (KTD3, R15). A provider posts a signed form; the signature proves the sender (From) and the
// business line it was sent to (To), so those two decide whose conversation it is and which business answers. Then
// come the provider's message id (a retried webhook runs once), the rate limits and the model budget (KTD8), and the
// agent's turn (lib/server/agent.ts).
import { BUSINESS } from "@/lib/config";
import type { Conversation } from "@/lib/types";
import { sameContact } from "@/lib/util";
import { BODY_CHARS, type TurnOutput, agentTurn } from "./agent";
import { CommandError, match, maybeText, text } from "./args";
import { DEMO_TENANT, type Repo, getRepo } from "./db/repo";
import { admit, overBudget, spend } from "./limits";
import { type InboundKind, SIGNATURE_HEADER, inboundUrl, publicBaseUrl, verify, webhookSecret } from "./signature";

// Each business's own number and address, which providers post as To. One business runs for now (KTD12); the next
// adds its line here.
const LINES = [{ tenant: DEMO_TENANT, sms: BUSINESS.sms, email: BUSINESS.email }];

const MAX_BYTES = 16_000;

// An Australian number as the data writes it: "+61412345678" becomes "0412 345 678". Anything else is unchanged.
export function localNumber(x: string) {
  const m = /^(?:\+61|0)(\d{9})$/.exec(x.replace(/[\s()-]/g, ""));
  if (!m) return x.trim();
  const d = m[1];
  return d.startsWith("4") ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : `0${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
}

export function tenantFor(to: string) {
  return LINES.find((l) => sameContact(localNumber(to), l.sms) || sameContact(to, l.email))?.tenant;
}

export interface Inbound {
  channel: Conversation["channel"];
  // The business line it was sent to, and who sent it.
  to: string;
  from: string;
  name?: string;
  body: string;
  // The provider's id for this message (Twilio's MessageSid).
  messageId: string;
}

export interface InboundOptions {
  // Tests pass a scripted model client and a fixed clock.
  client?: Parameters<typeof agentTurn>[3]["client"];
  now?: Date;
}

// One message the caller has already authenticated. Undefined when the provider already delivered this message id:
// a replay gets nothing, not a second agent run.
export async function receiveInbound(repo: Repo, m: Inbound, opts: InboundOptions = {}): Promise<TurnOutput | undefined> {
  const now = opts.now ?? new Date();
  const tenant = tenantFor(m.to);
  if (!tenant) throw new CommandError(404, "No business on that number.");
  if (!(await repo.claimKey(tenant, `inbound:${m.channel}:${m.messageId}`, `inbound_${m.channel}`))) return undefined;
  if (await admit(repo, tenant, m.from, now)) throw new CommandError(429, "Too many messages, try again in a minute.");
  return agentTurn(
    repo,
    { tenant, now },
    { channel: m.channel, contact: m.from, name: m.name, body: m.body },
    { origin: publicBaseUrl(), client: opts.client, rulesOnly: await overBudget(repo, tenant, now), onTokens: (n) => spend(repo, tenant, n, now) },
  );
}

const xml = (s: string) => s.replace(/[<>&"']/g, (ch) => `&${{ "<": "lt", ">": "gt", "&": "amp", '"': "quot", "'": "apos" }[ch]};`);

// The agent's answer to this message: its newest reply, when it answered at all.
function replyOf(out: TurnOutput | undefined) {
  return out?.engine ? [...out.conversation.messages].reverse().find((x) => x.from === "agent")?.body : undefined;
}

// The webhook for one inbound route: Twilio-shaped form fields From, To, Body, MessageSid and an optional FromName,
// signed over the public URL (never one built from request headers). An unsigned or altered request gets 403 and
// touches nothing. The SMS answer is TwiML, so the provider texts the reply back; email answers with JSON.
export async function inboundWebhook(kind: InboundKind, req: Request, opts: InboundOptions = {}): Promise<Response> {
  // Bytes, not characters: an emoji is one character and four bytes.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  const fields = [...new URLSearchParams(new TextDecoder().decode(buf))];
  if (!verify(webhookSecret(kind), inboundUrl(kind), fields, req.headers.get(SIGNATURE_HEADER[kind]))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const f = Object.fromEntries(fields);
  try {
    const m: Inbound = {
      channel: kind,
      to: text(f, "To", 120),
      from: localNumber(text(f, "From", 120)),
      name: maybeText(f, "FromName", 80),
      body: text(f, "Body", BODY_CHARS),
      messageId: match(f, "MessageSid", /^[\w-]{1,64}$/),
    };
    const out = await receiveInbound(await getRepo(), m, opts);
    if (kind === "email") return Response.json({ ok: true });
    const reply = replyOf(out);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${xml(reply)}</Message>` : ""}</Response>`, {
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  } catch (err) {
    if (err instanceof CommandError) return Response.json({ error: err.message }, { status: err.status });
    console.error(`Inbound ${kind} failed`, err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
