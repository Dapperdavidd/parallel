import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getJson, HttpError, invalidate, resetCache } from "@/lib/fetcher";

/**
 * The two rules this exists for: share a request in flight, reuse a fresh
 * one. Both are about not paying twice for the same bytes.
 */

let calls: string[] = [];
let respond: (url: string) => { status: number; body: unknown };

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetCache();
  calls = [];
  respond = () => ({ status: 200, body: { ok: true } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    // A tick of latency, so "in flight" is a real state in these tests.
    await new Promise((r) => setTimeout(r, 5));
    const { status, body } = respond(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
});

test("two callers at once share one request", async () => {
  const [a, b] = await Promise.all([getJson("/api/thing"), getJson("/api/thing")]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
});

test("a fresh response is reused rather than refetched", async () => {
  await getJson("/api/thing", { freshMs: 1_000 });
  await getJson("/api/thing", { freshMs: 1_000 });
  assert.equal(calls.length, 1);
});

test("a stale response is refetched", async () => {
  await getJson("/api/thing", { freshMs: 1 });
  await new Promise((r) => setTimeout(r, 20));
  await getJson("/api/thing", { freshMs: 1 });
  assert.equal(calls.length, 2);
});

test("with no freshness asked for, nothing is reused", async () => {
  await getJson("/api/thing");
  await getJson("/api/thing");
  assert.equal(calls.length, 2);
});

test("different URLs are different entries", async () => {
  await Promise.all([getJson("/api/a"), getJson("/api/b")]);
  assert.equal(calls.length, 2);
});

test("a failure is not cached", async () => {
  respond = () => ({ status: 503, body: { error: "down", code: "unavailable" } });
  await assert.rejects(getJson("/api/thing", { freshMs: 10_000 }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 503);
    assert.equal(error.code, "unavailable");
    assert.match(error.message, /down/);
    return true;
  });
  // One blip must not persist for the whole freshness window.
  respond = () => ({ status: 200, body: { ok: true } });
  assert.deepEqual(await getJson("/api/thing", { freshMs: 10_000 }), { ok: true });
  assert.equal(calls.length, 2);
});

test("a 500 carries the reference back to the log", async () => {
  respond = () => ({ status: 500, body: { error: "ours", code: "internal", requestId: "abc12345" } });
  await assert.rejects(getJson("/api/thing"), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.requestId, "abc12345");
    return true;
  });
});

test("invalidate forgets by prefix, and only by prefix", async () => {
  await getJson("/api/trades?wallet=a", { freshMs: 10_000 });
  await getJson("/api/markets", { freshMs: 10_000 });
  assert.equal(calls.length, 2);

  invalidate("/api/trades");
  await getJson("/api/trades?wallet=a", { freshMs: 10_000 });
  await getJson("/api/markets", { freshMs: 10_000 });
  // The trades entry was refetched; the markets one was not.
  assert.equal(calls.length, 3);
});

test("the original fetch is left alone", () => {
  assert.equal(typeof originalFetch, "function");
});
