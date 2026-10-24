import { inboundWebhook } from "@/lib/server/inbound";

export const runtime = "nodejs";

// POST: an email to the business address, from the email provider (signed like the SMS route; lib/server/inbound.ts).
export function POST(req: Request) {
  return inboundWebhook("email", req);
}
