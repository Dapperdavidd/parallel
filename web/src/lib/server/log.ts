import "server-only";

import { randomUUID } from "node:crypto";

/**
 * One line of JSON per event.
 *
 * Until now the server's only record of a failure was whatever string reached
 * the browser, which meant the stack trace we needed was either lost or
 * leaked. Structured lines are greppable, ship to any log drain without a
 * parser, and keep the detail server-side where it belongs.
 *
 * Nothing here is a metrics system. It is the substrate one needs: every line
 * carries a `requestId` that the caller also receives, so a support message
 * saying "I got error 4f2a…" leads straight to the trace.
 */

export type Level = "info" | "warn" | "error";

export interface Event {
  readonly event: string;
  readonly requestId?: string;
  readonly route?: string;
  readonly ms?: number;
  readonly status?: number;
  readonly [key: string]: unknown;
}

const REDACTED = "[redacted]";

/**
 * Keys whose values never belong in a log line.
 *
 * A secret in a log file is a secret in a log drain, a log search index and
 * every laptop that has ever run `vercel logs`.
 */
const SENSITIVE = /secret|private|key|token|authorization|cookie|password|mnemonic|seed/i;

function clean(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => clean(entry, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE.test(key) ? REDACTED : clean(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2_000) return `${value.slice(0, 2_000)}…`;
  return value;
}

export function log(level: Level, event: Event): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "parallel-web",
    ...(clean(event) as Record<string, unknown>),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const info = (event: Event): void => log("info", event);
export const warn = (event: Event): void => log("warn", event);
export const failure = (event: Event): void => log("error", event);

/** Short enough to read out over the phone, long enough not to collide. */
export const newRequestId = (): string => randomUUID().slice(0, 8);
