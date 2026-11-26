import "server-only";

import {
  CEILINGS,
  callerIdentity,
  ceilingHeaders,
  take,
  type Ceiling,
  type Verdict,
} from "./rate-limit";
import { info, newRequestId } from "./log";
import { Rejection, refuseCeiling, respondToFailure } from "./respond";
import { ValidationError, type Field } from "./validate";

/**
 * The shape every route shares.
 *
 * Each handler used to repeat the same four things — an origin check, a JSON
 * parse in a try, an ad-hoc status code, and a catch that forwarded the raw
 * error. Four copies of a security control is four chances to miss one, and
 * `/api/vaults` had missed all of them.
 *
 * `route` puts them in one place: identity, ceiling, origin, timing, logging,
 * and a single funnel for anything thrown. A handler is then only its own
 * logic, and it can `reject(...)` or throw freely.
 */

export interface Ctx {
  readonly request: Request;
  readonly url: URL;
  readonly requestId: string;
  readonly caller: string;
}

interface Config {
  /** How often one caller may ask. */
  readonly ceiling: Ceiling;
  /**
   * Refuse a cross-origin request. On by default for anything that changes
   * state; reads are left open so the public market data stays embeddable.
   */
  readonly sameOrigin?: boolean;
}

export function route(
  name: string,
  config: Config,
  handler: (ctx: Ctx) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const started = Date.now();
    const requestId = newRequestId();
    const caller = callerIdentity(request);

    // Every exit stamps the same headers, so a refused request is as
    // traceable as a served one — the early returns used to skip them.
    const stamp = (response: Response, verdict?: Verdict): Response => {
      const headers = new Headers(response.headers);
      headers.set("X-Request-Id", requestId);
      if (verdict) {
        for (const [key, value] of Object.entries(ceilingHeaders(verdict))) headers.set(key, value);
      }
      info({
        event: "request",
        route: name,
        requestId,
        method: request.method,
        status: response.status,
        ms: Date.now() - started,
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return stamp(
        respondToFailure(name, new Rejection("bad_request", "Unreadable request URL"), requestId),
      );
    }

    const verdict = take(config.ceiling, caller);
    if (!verdict.ok) return stamp(refuseCeiling(name, verdict), verdict);

    if (config.sameOrigin !== false) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) {
        return stamp(
          respondToFailure(
            name,
            new Rejection("forbidden", "Cross-origin requests are refused here", { origin }),
            requestId,
          ),
          verdict,
        );
      }
    }

    try {
      return stamp(await handler({ request, url, requestId, caller }), verdict);
    } catch (error) {
      return stamp(respondToFailure(name, error, requestId), verdict);
    }
  };
}

/** Bodies here are a handful of fields; anything larger is a mistake or an attack. */
const DEFAULT_MAX_BYTES = 4 * 1024;

/**
 * Read and validate a JSON body without ever buffering more than the ceiling.
 *
 * `await request.json()` reads the whole stream first and asks questions
 * afterwards, so a declared content type and a 50MB payload would be parsed
 * before anything rejected it. This counts bytes as they arrive and stops.
 */
export async function readJson<T>(
  request: Request,
  field: Field<T>,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const declaredType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(declaredType)) {
    throw new Rejection("bad_request", "Send this as application/json");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Rejection("bad_request", `The request body must be under ${maxBytes} bytes`);
  }

  const stream = request.body;
  if (!stream) throw new Rejection("bad_request", "A JSON body is required");

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Rejection("bad_request", `The request body must be under ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    void stream.cancel().catch(() => undefined);
  }

  const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  if (raw.trim() === "") throw new Rejection("bad_request", "A JSON body is required");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Rejection("bad_request", "The request body is not valid JSON");
  }

  try {
    return field(parsed, "body");
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new Rejection("bad_request", "The request body could not be read");
  }
}

export { CEILINGS };
