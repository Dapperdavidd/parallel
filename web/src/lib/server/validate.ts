import "server-only";

import { PublicKey } from "@solana/web3.js";

/**
 * A request body validator, in about a hundred lines and no dependency.
 *
 * Every route used to cast `await request.json()` straight to its own
 * interface, which types the code but checks nothing: a string where a number
 * belonged reached the arithmetic, and an unbounded body reached the parser.
 * This gives each route one declarative shape, with the rejection message it
 * should show the person who sent it.
 *
 * It is deliberately small rather than a schema library. The surface here is
 * ten endpoints with a dozen fields between them, and a dependency we do not
 * add is a dependency we do not have to audit — see the vulnerability count in
 * the codebase review.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Reads one field, or throws with a message naming it. */
export type Field<T> = (value: unknown, name: string) => T;

const bad = (name: string, expectation: string): never => {
  throw new ValidationError(`${name} ${expectation}`);
};

export const text = (options: { max: number; min?: number; pattern?: RegExp }): Field<string> =>
  (value, name) => {
    if (typeof value !== "string") return bad(name, "must be text");
    if (value.length > options.max) return bad(name, `must be at most ${options.max} characters`);
    if (value.length < (options.min ?? 1)) return bad(name, "is required");
    if (options.pattern && !options.pattern.test(value)) return bad(name, "is not in the expected form");
    return value;
  };

export const number = (options: { min: number; max: number }): Field<number> =>
  (value, name) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return bad(name, "must be a number");
    if (parsed < options.min || parsed > options.max) {
      return bad(name, `must be between ${options.min} and ${options.max}`);
    }
    return parsed;
  };

export const integer = (options: { min: number; max: number }): Field<number> =>
  (value, name) => {
    const parsed = number(options)(value, name);
    if (!Number.isInteger(parsed)) return bad(name, "must be a whole number");
    return parsed;
  };

export const boolean = (): Field<boolean> =>
  (value, name) => {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return bad(name, "must be true or false");
  };

export const oneOf = <const T extends readonly string[]>(allowed: T): Field<T[number]> =>
  (value, name) => {
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
      return value as T[number];
    }
    return bad(name, `must be one of ${allowed.join(", ")}`);
  };

/** A Solana address, returned parsed so no caller re-parses it. */
export const address = (): Field<PublicKey> =>
  (value, name) => {
    if (typeof value !== "string" || value.length < 32 || value.length > 44) {
      return bad(name, "must be a Solana address");
    }
    let key: PublicKey;
    try {
      key = new PublicKey(value);
    } catch {
      return bad(name, "must be a Solana address");
    }
    // A program-derived address is a real account but holds no private key, so
    // it can never be the wallet a trade is signed by. `isOnCurve` throws
    // rather than returning false for some inputs, hence the guard.
    let onCurve = false;
    try {
      onCurve = PublicKey.isOnCurve(key.toBytes());
    } catch {
      onCurve = false;
    }
    if (!onCurve) return bad(name, "must be a wallet address, not a program address");
    return key;
  };

/** An address that may legitimately be off-curve, such as a program account. */
export const accountAddress = (): Field<PublicKey> =>
  (value, name) => {
    if (typeof value !== "string" || value.length < 32 || value.length > 44) {
      return bad(name, "must be a Solana address");
    }
    try {
      return new PublicKey(value);
    } catch {
      return bad(name, "must be a Solana address");
    }
  };

/** A base64 blob with a hard byte ceiling, returned decoded. */
export const base64Bytes = (options: { bytes: number }): Field<Buffer> =>
  (value, name) => {
    if (typeof value !== "string") return bad(name, "must be base64 text");
    if (value.length > Math.ceil(options.bytes / 3) * 4 + 8) return bad(name, "is too long");
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== options.bytes) return bad(name, `must decode to ${options.bytes} bytes`);
    return decoded;
  };

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * How many bytes this base58 string decodes to.
 *
 * Length in characters is not enough. Eighty `1`s are valid base58 and look
 * like a signature, but decode to a run of zero bytes the RPC rejects with
 * "Invalid param: WrongSize" — a 500 for what is plainly a bad request. Done
 * by hand because `bs58` is not a dependency of the web app, and twenty lines
 * is cheaper than making it one.
 */
function base58Length(value: string): number | null {
  const digits = [0];
  for (const character of value) {
    const index = BASE58.indexOf(character);
    if (index < 0) return null;
    let carry = index;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! * 58;
      digits[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      digits.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading '1' is one leading zero byte.
  let leadingZeros = 0;
  for (const character of value) {
    if (character !== "1") break;
    leadingZeros += 1;
  }
  return leadingZeros + digits.length - (digits.length === 1 && digits[0] === 0 ? 1 : 0);
}

/** A transaction signature: base58, decoding to exactly 64 bytes. */
export const signature = (): Field<string> =>
  (value, name) => {
    const encoded = text({ max: 96, min: 64, pattern: /^[1-9A-HJ-NP-Za-km-z]+$/ })(value, name);
    if (base58Length(encoded) !== 64) return bad(name, "must be a transaction signature");
    return encoded;
  };

/** `YYYY-MM-DD`, and a date that really exists. */
export const calendarDay = (): Field<string> =>
  (value, name) => {
    const day = text({ max: 10, min: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ })(value, name);
    const parsed = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
      return bad(name, "must be a real calendar date");
    }
    return day;
  };

/** An ISO 8601 instant, used as a page cursor. */
export const isoTimestamp = (): Field<string> =>
  (value, name) => {
    const text_ = text({ max: 40 })(value, name);
    const parsed = Date.parse(text_);
    if (Number.isNaN(parsed)) return bad(name, "must be an ISO timestamp");
    return new Date(parsed).toISOString();
  };

export const optional = <T>(field: Field<T>): Field<T | undefined> =>
  (value, name) => (value === undefined || value === null || value === "" ? undefined : field(value, name));

export const withDefault = <T>(field: Field<T>, fallback: T): Field<T> =>
  (value, name) => (value === undefined || value === null || value === "" ? fallback : field(value, name));

export type Shape = Record<string, Field<unknown>>;
export type Parsed<S extends Shape> = { [K in keyof S]: S[K] extends Field<infer T> ? T : never };

/**
 * Read a whole body against a shape.
 *
 * Unknown keys are rejected rather than ignored: a request carrying a field
 * this version does not know about is more likely a client talking to the
 * wrong deployment than a harmless extra, and saying so is kinder than
 * silently dropping it.
 */
export function shape<S extends Shape>(fields: S): Field<Parsed<S>> {
  return (value, name) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return bad(name, "must be a JSON object");
    }
    const source = value as Record<string, unknown>;
    const unknown = Object.keys(source).filter((key) => !(key in fields));
    if (unknown.length > 0) {
      throw new ValidationError(`Unexpected field: ${unknown.slice(0, 3).join(", ")}`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(fields)) {
      out[key] = field(source[key], key);
    }
    return out as Parsed<S>;
  };
}

/** Read one query-string parameter through the same field validators. */
export function query<T>(url: URL, name: string, field: Field<T>): T {
  return field(url.searchParams.get(name) ?? undefined, name);
}
