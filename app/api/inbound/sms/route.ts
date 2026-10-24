import { inboundWebhook } from "@/lib/server/inbound";

export const runtime = "nodejs";

// POST: a text to the business number, from the SMS provider (Twilio-shaped and signed; lib/server/inbound.ts).
export function POST(req: Request) {
  return inboundWebhook("sms", req);
}
