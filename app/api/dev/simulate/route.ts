import { NextResponse } from "next/server";
import { BUSINESS } from "@/lib/config";
import { BODY_CHARS } from "@/lib/server/agent";
import { CHANNELS, CommandError, isObj, maybeText, oneOf, text } from "@/lib/server/args";
import { demoFor, refusedWrite, requestSession, sessionOwner } from "@/lib/server/auth";
import { DEMO_TENANT, getRepo } from "@/lib/server/db/repo";
import { inboundWebhook, localNumber, receiveInbound } from "@/lib/server/inbound";
import { clientIp, newNumberRefused } from "@/lib/server/limits";
import { type Fields, SIGNATURE_HEADER, inboundUrl, sign, webhookSecret } from "@/lib/server/signature";
import { randomToken } from "@/lib/util";
import { chatView, ownerByContact } from "@/lib/views";

export const runtime = "nodejs";

// POST { channel, contact, name?, body }: the SMS widget and the inbox simulator send a message to the demo business
// as if from `contact`. The server signs it as the provider would and posts it through the real inbound webhook, so
// the browser never holds the secret. Phone transcripts and web forms have no provider webhook yet, so those go
// straight in. Answers with the sender's conversation.
// KTD12, A1: only to the demo business, and only while its demo features are on (outside production, or with
// DEMO_MODE on). Otherwise 404. One IP may text as only so many numbers an hour (A6), so a new number for each message
// can't dodge the per-sender limit.
const MAX_BYTES = 16_000;

export async function POST(req: Request) {
  const repo = await getRepo();
  if (!(await demoFor(repo, DEMO_TENANT))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const refused = refusedWrite(req);
  if (refused) return refused;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    if (!isObj(raw)) throw new CommandError(400, "Bad request");
    const channel = oneOf(raw, "channel", CHANNELS);
    const contact = localNumber(text(raw, "contact", 120));
    const name = maybeText(raw, "name", 80);
    const body = text(raw, "body", BODY_CHARS);
    const doc = await repo.load(DEMO_TENANT);
    if (!doc) throw new CommandError(404, "No such business.");
    // An owner's own number gets the owner agent, so only a signed-in owner may text as one here. A real text from
    // that number proves only its caller ID, so the owner agent stages every change for a YES with the nonce it
    // texts back, and the risky ones also need the code on that owner's admin page (KTD6).
    const { tenant, session } = await requestSession(req, repo);
    const signedIn = tenant === DEMO_TENANT && !!sessionOwner(doc.data, session?.ownerId, session?.sv);
    if (ownerByContact(doc.data, contact) && !signedIn) throw new CommandError(401, "Sign in to text as an owner.");
    if (await newNumberRefused(repo, DEMO_TENANT, clientIp(req), contact)) {
      throw new CommandError(429, "You've texted from a lot of different numbers this hour. Use one you've already tried, or try again later.");
    }

    const to = channel === "sms" || channel === "phone" ? BUSINESS.sms : BUSINESS.email;
    const messageId = `SIM${randomToken()}`;
    if (channel === "sms" || channel === "email") {
      const fields: Fields = { From: contact, To: to, Body: body, MessageSid: messageId, ...(name && { FromName: name }) };
      const url = inboundUrl(channel);
      const res = await inboundWebhook(
        channel,
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", [SIGNATURE_HEADER[channel]]: sign(webhookSecret(channel), url, fields) },
          body: new URLSearchParams(fields),
        }),
      );
      if (!res.ok) return res;
    } else {
      await receiveInbound(repo, { channel, to, from: contact, name, body, messageId });
    }
    const c = (await repo.load(DEMO_TENANT))?.data.conversations.find((x) => x.channel === channel && x.contact === contact);
    if (!c) throw new CommandError(404, "No such conversation.");
    return NextResponse.json({ conversation: chatView(c) });
  } catch (err) {
    if (err instanceof CommandError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Simulated message failed", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
