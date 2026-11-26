import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appSecret } from "./env";
import { Rejection } from "./respond";

/**
 * Short-lived tokens the server signs and later recognises.
 *
 * Two things need this. A *challenge* proves a browser controls the wallet it
 * claims, without the server storing session state. A *quote* carries the
 * numbers the server itself computed — price, size, leverage — through to the
 * moment the resulting transaction is filed, so the record is the server's
 * arithmetic rather than the client's word for it.
 *
 * Both are HMAC over a compact JSON payload: no database row to expire, and a
 * tampered token fails the comparison rather than being half-trusted. Each
 * carries its own `exp`, and `kind` is inside the signed payload so a
 * challenge can never be presented as a quote.
 */

interface Envelope<T> {
  /** What this token is for. */
  k: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
  /** Single-use marker. */
  n: string;
  p: T;
}

const b64url = (input: Buffer): string => input.toString("base64url");

const mac = (body: string): Buffer => createHmac("sha256", appSecret()).update(body).digest();

export function sign<T>(kind: string, payload: T, ttlMs: number): string {
  const envelope: Envelope<T> = {
    k: kind,
    exp: Date.now() + ttlMs,
    n: randomUUID(),
    p: payload,
  };
  const body = b64url(Buffer.from(JSON.stringify(envelope), "utf8"));
  return `${body}.${b64url(mac(body))}`;
}

export interface Opened<T> {
  readonly payload: T;
  readonly nonce: string;
  readonly expiresAt: number;
}

/** Verify and decode, or reject. The message says which of the two failed. */
export function open<T>(kind: string, token: string): Opened<T> {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Rejection("bad_request", "This token is malformed");

  const expected = mac(body);
  let presented: Buffer;
  try {
    presented = Buffer.from(signature, "base64url");
  } catch {
    throw new Rejection("bad_request", "This token is malformed");
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new Rejection("forbidden", "This token was not issued by this server");
  }

  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Envelope<T>;
  } catch {
    throw new Rejection("bad_request", "This token is malformed");
  }
  if (envelope.k !== kind) throw new Rejection("forbidden", "This token is for something else");
  if (!Number.isFinite(envelope.exp) || envelope.exp < Date.now()) {
    throw new Rejection("conflict", "This has expired — ask for a fresh one");
  }
  return { payload: envelope.p, nonce: envelope.n, expiresAt: envelope.exp };
}

/**
 * One use per nonce.
 *
 * A signed token is otherwise replayable until it expires, which for a quote
 * would mean filing the same prepared trade twice. Held in memory, swept on
 * read, and bounded by the token lifetime rather than by traffic.
 *
 * The second line of defence is independent of this one: trade rows are
 * idempotent on the transaction signature, so even a lost nonce set cannot
 * produce a duplicate record.
 */
const spent = new Map<string, number>();

export function consume(nonce: string, ttlMs: number): boolean {
  const now = Date.now();
  if (spent.size > 10_000) {
    for (const [key, expiry] of spent) if (expiry <= now) spent.delete(key);
  }
  const existing = spent.get(nonce);
  if (existing !== undefined && existing > now) return false;
  spent.set(nonce, now + ttlMs);
  return true;
}

export function resetSpentNonces(): void {
  spent.clear();
}
