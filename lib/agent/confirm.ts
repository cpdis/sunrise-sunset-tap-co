// Reads a reply to "Reply YES to ...". Shared by the customer and owner agents, so the two cannot drift.
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
