import "server-only";

import { ValidationError } from "./validate";
import { EnvironmentError } from "./env";
import { ceilingHeaders, type Verdict } from "./rate-limit";
import { failure, warn } from "./log";

/**
 * What a route is allowed to tell the caller.
 *
 * Every route used to end with `error instanceof Error ? error.message : …`,
 * which handed the browser whatever the failure happened to say: a Supabase
 * permission message, a file path from the wallets folder, an RPC URL with a
 * key in it. Those belong in the log, not in a response.
 *
 * So failures come in two kinds. A *rejection* is the caller's to fix and says
 * exactly what is wrong. An *internal* failure is ours: the caller gets a
 * stable code and a request id, and the detail goes to the log under that same
 * id.
 */

export type Code =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal";

const STATUS: Record<Code, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

/** A failure a route raises on purpose, with the words the caller should see. */
export class Rejection extends Error {
  constructor(
    readonly code: Code,
    message: string,
    /** Extra context for the log only — never serialised to the caller. */
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "Rejection";
  }
}

export const reject = (code: Code, message: string, context?: Record<string, unknown>): never => {
  throw new Rejection(code, message, context);
};

const json = (body: unknown, status: number, headers?: Record<string, string>): Response =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

export const ok = (body: unknown, headers?: Record<string, string>): Response =>
  json(body, 200, headers);

export const refuse = (code: Code, message: string, headers?: Record<string, string>): Response =>
  json({ error: message, code }, STATUS[code], headers);

export const refuseCeiling = (route: string, verdict: Verdict): Response => {
  warn({ event: "rate_limited", route, retryAfter: verdict.retryAfterSeconds });
  return refuse(
    "rate_limited",
    `Too many requests. Try again in ${verdict.retryAfterSeconds}s.`,
    ceilingHeaders(verdict),
  );
};

/**
 * Turn anything thrown inside a route into a response.
 *
 * Validation and deliberate rejections pass their message through. Everything
 * else is logged in full and answered generically — the request id is the
 * thread between the two, so it must be the *same* id the caller sees in the
 * `X-Request-Id` header. It is passed in rather than minted here for exactly
 * that reason.
 */
export function respondToFailure(route: string, error: unknown, requestId: string): Response {
  if (error instanceof Rejection) {
    warn({ event: "rejected", route, code: error.code, reason: error.message, ...error.context });
    return refuse(error.code, error.message);
  }
  if (error instanceof ValidationError) {
    warn({ event: "invalid_request", route, reason: error.message });
    return refuse("bad_request", error.message);
  }
  if (error instanceof EnvironmentError) {
    failure({ event: "misconfigured", route, requestId, error });
    return json(
      {
        error: "This deployment is not configured for that yet.",
        code: "unavailable" satisfies Code,
        requestId,
      },
      STATUS.unavailable,
    );
  }
  failure({ event: "unhandled", route, requestId, error });
  return json(
    {
      error: "Something failed on our side. Quote this reference if you get in touch.",
      code: "internal" satisfies Code,
      requestId,
    },
    STATUS.internal,
  );
}
