import { test } from "node:test";
import assert from "node:assert/strict";
import { consume, open, resetSpentNonces, sign } from "@/lib/server/tokens";
import { Rejection } from "@/lib/server/respond";

const expectRejection = (run: () => unknown, code: string, expecting?: RegExp): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof Rejection, `expected a Rejection, got ${String(error)}`);
    assert.equal(error.code, code);
    if (expecting) assert.match(error.message, expecting);
    return true;
  });
};

test("a token survives a round trip", () => {
  const token = sign("quote", { side: "long", leverage: 3 }, 60_000);
  const opened = open<{ side: string; leverage: number }>("quote", token);
  assert.deepEqual(opened.payload, { side: "long", leverage: 3 });
  assert.ok(opened.expiresAt > Date.now());
  assert.ok(opened.nonce.length > 10);
});

test("an edited payload fails the signature", () => {
  const token = sign("quote", { leverage: 3 }, 60_000);
  const [body, mac] = token.split(".");
  const tampered = Buffer.from(
    JSON.stringify({ k: "quote", exp: Date.now() + 60_000, n: "x", p: { leverage: 100 } }),
  ).toString("base64url");
  assert.notEqual(tampered, body);
  expectRejection(() => open("quote", `${tampered}.${mac}`), "forbidden", /not issued/);
});

test("a token cannot be presented as a different kind", () => {
  const token = sign("wallet-proof", { wallet: "x" }, 60_000);
  expectRejection(() => open("quote", token), "forbidden", /something else/);
});

test("an expired token is refused, and says so", () => {
  const token = sign("quote", { leverage: 1 }, -1);
  expectRejection(() => open("quote", token), "conflict", /expired/);
});

test("a malformed token does not throw something unexpected", () => {
  expectRejection(() => open("quote", "rubbish"), "bad_request");
  expectRejection(() => open("quote", "rubbish.rubbish"), "forbidden");
});

test("a nonce spends exactly once", () => {
  resetSpentNonces();
  assert.equal(consume("nonce-1", 60_000), true);
  assert.equal(consume("nonce-1", 60_000), false);
  assert.equal(consume("nonce-2", 60_000), true);
});

test("a nonce is reusable once its window has passed", () => {
  resetSpentNonces();
  assert.equal(consume("brief", -1), true);
  assert.equal(consume("brief", 60_000), true);
});
