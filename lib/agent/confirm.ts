// Reads a reply to "Reply YES ...". Shared by the customer and owner agents, so the two cannot drift.
// A refusal word anywhere wins, and a yes must be the whole message: "yeah nah", "okay, cancel that"
// and "yes, but what about kegs?" never confirm anything.

export type Confirm = "yes" | "no" | "other";

const REFUSALS = [
  "no", "nope", "nah", "nay", "not", "never", "dont", "do not", "stop", "wait", "hold on", "hang on",
  "keep", "leave it", "cancel", "scrap", "forget", "never mind", "nevermind", "changed my mind", "change my mind",
  "rather not", "too expensive", "too much", "too dear", "wrong",
];

const AFFIRMATIVES = [
  "y", "yes", "yeah", "yea", "yep", "yup", "ya", "sure", "ok", "okay", "k", "confirm", "confirmed", "correct",
  "do it", "go", "go ahead", "please do", "sounds good", "lets do it", "absolutely", "definitely",
  "of course", "too right",
];

// Words that may follow a yes without changing it: "yes please", "yep thanks mate".
const COURTESY = ["please", "pls", "thanks", "thank you", "ta", "cheers", "mate"];

const alt = (xs: string[]) => xs.map((x) => x.replace(/ /g, "\\s")).join("|");

// Lower case, apostrophes dropped ("don't" reads as "dont"), other punctuation turned into single spaces.
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A refusal word, ignoring any the caller's own yes phrases use ("cancel it" is a yes to "Reply YES to cancel").
function refusalRe(extraYes: string[]) {
  const own = new Set(extraYes.flatMap((p) => p.split(" ")));
  return new RegExp(`(^|\\s)(${alt(REFUSALS.filter((w) => !own.has(w)))})(?=\\s|$)`);
}

export function isRefusal(text: string, extraYes: string[] = []) {
  return refusalRe(extraYes).test(normalise(text));
}

// extraYes: phrases that also mean yes for this question, such as "cancel it" or "send the link".
export function parseConfirm(text: string, extraYes: string[] = []): Confirm {
  const t = normalise(text);
  if (!t) return "other";
  if (refusalRe(extraYes).test(t)) return "no";
  const yes = alt([...AFFIRMATIVES, ...extraYes]);
  // One or two yes phrases ("ok go ahead"), then any courtesy words.
  const whole = new RegExp(`^(${yes})(\\s(${yes}))?(\\s(${alt(COURTESY)}))*$`);
  return whole.test(t) ? "yes" : "other";
}

// KTD11: a confirmation sent to the sender's real handset carries a 4-digit code, and only a yes that echoes it
// ("YES 4821") confirms. A spoofed caller ID never sees the code, so a blind "yes" confirms nothing.
export function newCode() {
  return String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
}

const CODE = /\b\d{4}\b/g;

// A reply to "Reply YES 4821": its yes or no (the parser above, with the code taken out), the code it quotes (only
// when it quotes exactly one), and whether the code is all it says.
export function parseCoded(text: string, extraYes: string[] = []): { answer: Confirm; code?: string; bare: boolean } {
  const codes = text.match(CODE) ?? [];
  const rest = text.replace(CODE, " ");
  return { answer: parseConfirm(rest, extraYes), code: codes.length === 1 ? codes[0] : undefined, bare: codes.length > 0 && normalise(rest) === "" };
}

// KTD6: an owner's one-time code from the admin page, six digits ("482193" or "482 193"), maybe after "code".
const ONE_TIME = /\b(?:code\s*:?\s*)?(\d{3})\s?(\d{3})\b/gi;

// A reply to "Reply YES 4821 and the 6-digit code from your admin page": parseCoded on the text without the
// one-time code, plus that code (only when it quotes exactly one). bare: the message is only codes.
export function parseApproval(text: string): { answer: Confirm; code?: string; oneTime?: string; bare: boolean } {
  const oneTimes = [...text.matchAll(ONE_TIME)].map((m) => m[1] + m[2]);
  const rest = text.replace(ONE_TIME, " ");
  const r = parseCoded(rest);
  const quoted = oneTimes.length > 0 || (rest.match(CODE) ?? []).length > 0;
  return { answer: r.answer, code: r.code, oneTime: oneTimes.length === 1 ? oneTimes[0] : undefined, bare: quoted && normalise(rest.replace(CODE, " ")) === "" };
}
