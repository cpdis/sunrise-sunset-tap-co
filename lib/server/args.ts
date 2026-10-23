// Argument checks for server commands. Each returns the value, or throws a 400 naming the field.
import { isISODate, localNumber } from "@/lib/util";

export class CommandError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Raw = Record<string, unknown>;

export const isObj = (x: unknown): x is Raw => typeof x === "object" && x !== null && !Array.isArray(x);

export const bad = (field: string): never => {
  throw new CommandError(400, `Bad or missing ${field}.`);
};

export const match = (r: Raw, k: string, re: RegExp) => {
  const v = r[k];
  return typeof v === "string" && re.test(v) ? v : bad(k);
};

// A non-blank string of at most `max` characters.
export const text = (r: Raw, k: string, max: number) => {
  const v = r[k];
  return typeof v === "string" && v.trim() !== "" && v.length <= max ? v : bad(k);
};

export const maybeText = (r: Raw, k: string, max: number) => {
  const v = r[k];
  return v === undefined ? undefined : typeof v === "string" && v.length <= max ? v : bad(k);
};

export const num = (r: Raw, k: string, min: number, max: number) => {
  const v = r[k];
  return typeof v === "number" && v >= min && v <= max ? v : bad(k);
};

export const maybeNum = (r: Raw, k: string, min: number, max: number) => (r[k] === undefined ? undefined : num(r, k, min, max));

export const flag = (r: Raw, k: string) => {
  const v = r[k];
  return v === undefined ? undefined : typeof v === "boolean" ? v : bad(k);
};

export const oneOf = <T>(r: Raw, k: string, xs: readonly T[]) => (xs.includes(r[k] as T) ? (r[k] as T) : bad(k));

export const date = (r: Raw, k: string) => {
  const v = r[k];
  return isISODate(v) ? v : bad(k);
};

// A phone number as every route stores it (localNumber), or a 400: digits, spaces and + ( ) - only, 8 to 15 digits.
// Blank is none. A field that must hold a number can't carry an instruction to a model (F14).
export const maybePhone = (r: Raw, k: string) => {
  const v = maybeText(r, k, 30)?.trim();
  if (!v) return undefined;
  const n = v.replace(/\D/g, "").length;
  return /^[\d\s()+-]+$/.test(v) && n >= 8 && n <= 15 ? localNumber(v) : bad(k);
};

// An email as every route stores it, trimmed and lower-cased (B9), or a 400. Blank is none.
export const maybeEmail = (r: Raw, k: string) => {
  const v = maybeText(r, k, 120)?.trim();
  if (!v) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : bad(k);
};

// A record id: booking, conversation, distribution or owner.
export const id = (r: Raw, k: string) => match(r, k, /^[\w-]{1,100}$/);

export const obj = (r: Raw, k: string) => {
  const v = r[k];
  return isObj(v) ? v : bad(k);
};

export const CHANNELS = ["sms", "email", "phone", "web"] as const;
