import { test } from "node:test";
import assert from "node:assert/strict";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { resetCeilings } from "@/lib/server/rate-limit";
import { ok, reject } from "@/lib/server/respond";
import { integer, oneOf, shape } from "@/lib/server/validate";

const body = shape({ side: oneOf(["long", "short"] as const), leverage: integer({ min: 1, max: 10 }) });

const post = (payload: unknown, headers: Record<string, string> = {}): Request =>
  new Request("https://parallel.test/api/thing", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

test("a valid body is read and typed", async () => {
  const parsed = await readJson(post({ side: "long", leverage: 3 }), body);
  assert.deepEqual(parsed, { side: "long", leverage: 3 });
});

test("a body that is not JSON is refused before parsing", async () => {
  const request = new Request("https://parallel.test/api/thing", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "side=long",
  });
  await assert.rejects(readJson(request, body), /application\/json/);
});

test("broken JSON is a plain refusal", async () => {
  await assert.rejects(readJson(post("{not json"), body), /not valid JSON/);
});

test("an empty body is a refusal, not a crash", async () => {
  const request = new Request("https://parallel.test/api/thing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "",
  });
  await assert.rejects(readJson(request, body), /JSON body is required/);
});

test("an oversized body is refused by its declared length", async () => {
  const huge = JSON.stringify({ side: "long", leverage: 1, padding: "x".repeat(10_000) });
  await assert.rejects(readJson(post(huge), body, { maxBytes: 1_024 }), /under 1024 bytes/);
});

test("an oversized body is refused even when it lies about its length", async () => {
  // A stream with no content-length: the ceiling has to hold while reading.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`{"side":"long","padding":"${"x".repeat(5_000)}`));
      controller.close();
    },
  });
  const request = new Request("https://parallel.test/api/thing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(readJson(request, body, { maxBytes: 1_024 }), /under 1024 bytes/);
});

test("route refuses a cross-origin write", async () => {
  resetCeilings();
  const handler = route("thing", { ceiling: CEILINGS.write }, async () => ok({ fine: true }));
  const response = await handler(post({ side: "long", leverage: 1 }, { origin: "https://evil.test" }));
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { code: string }).code, "forbidden");
});

test("route allows a same-origin write, and a read from anywhere", async () => {
  resetCeilings();
  const write = route("thing", { ceiling: CEILINGS.write }, async () => ok({ fine: true }));
  const sameOrigin = await write(
    post({ side: "long", leverage: 1 }, { origin: "https://parallel.test" }),
  );
  assert.equal(sameOrigin.status, 200);

  const read = route("read", { ceiling: CEILINGS.read, sameOrigin: false }, async () => ok({ fine: true }));
  const embedded = await read(
    new Request("https://parallel.test/api/read", { headers: { origin: "https://elsewhere.test" } }),
  );
  assert.equal(embedded.status, 200);
});

test("route stops a caller past its ceiling, and says when to return", async () => {
  resetCeilings();
  const ceiling = { name: "tiny", windowMs: 60_000, max: 2 };
  const handler = route("thing", { ceiling }, async () => ok({ fine: true }));
  const from = (ip: string): Request =>
    new Request("https://parallel.test/api/thing", { headers: { "x-forwarded-for": ip } });

  assert.equal((await handler(from("1.1.1.1"))).status, 200);
  assert.equal((await handler(from("1.1.1.1"))).status, 200);
  const refused = await handler(from("1.1.1.1"));
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("Retry-After")) > 0);
  // A different caller is unaffected.
  assert.equal((await handler(from("2.2.2.2"))).status, 200);
});

test("route never leaks an internal error to the caller", async () => {
  resetCeilings();
  const handler = route("thing", { ceiling: CEILINGS.read }, async () => {
    throw new Error("postgres://user:hunter2@db.internal/parallel timed out");
  });
  const response = await handler(new Request("https://parallel.test/api/thing"));
  const payload = (await response.json()) as { error: string; requestId: string };
  assert.equal(response.status, 500);
  assert.doesNotMatch(payload.error, /hunter2|postgres|internal/);
  // The request id is the thread back to the full detail in the log.
  assert.match(payload.requestId, /^[0-9a-f]{8}$/);
  assert.equal(response.headers.get("X-Request-Id"), payload.requestId);
});

test("route passes a deliberate rejection through, with its words", async () => {
  resetCeilings();
  const handler = route("thing", { ceiling: CEILINGS.read }, async () => {
    reject("conflict", "This market is paused because its index is not healthy");
    return ok({});
  });
  const response = await handler(new Request("https://parallel.test/api/thing"));
  assert.equal(response.status, 409);
  const payload = (await response.json()) as { error: string; code: string };
  assert.equal(payload.code, "conflict");
  assert.match(payload.error, /index is not healthy/);
});

test("a validation failure is a 400 that names the field", async () => {
  resetCeilings();
  const handler = route("thing", { ceiling: CEILINGS.write }, async ({ request }) => {
    await readJson(request, body);
    return ok({});
  });
  const response = await handler(post({ side: "sideways", leverage: 1 }));
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /side must be one of/);
});

test("every response forbids caching by default", async () => {
  resetCeilings();
  const handler = route("thing", { ceiling: CEILINGS.read }, async () => ok({ fine: true }));
  const response = await handler(new Request("https://parallel.test/api/thing"));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
