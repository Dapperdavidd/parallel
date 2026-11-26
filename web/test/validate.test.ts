import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  accountAddress,
  address,
  base64Bytes,
  calendarDay,
  integer,
  number,
  oneOf,
  optional,
  shape,
  signature,
  text,
  ValidationError,
  withDefault,
} from "@/lib/server/validate";

const throws = (run: () => unknown, expecting?: RegExp): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ValidationError, `expected a ValidationError, got ${String(error)}`);
    if (expecting) assert.match(error.message, expecting);
    return true;
  });
};

test("text enforces its bounds and names the field", () => {
  assert.equal(text({ max: 8 })("hello", "name"), "hello");
  throws(() => text({ max: 4 })("hello", "name"), /name/);
  throws(() => text({ max: 8 })("", "name"), /required/);
  throws(() => text({ max: 8 })(42, "name"), /must be text/);
});

test("text honours a pattern", () => {
  const marketId = text({ max: 16, pattern: /^USD\/[A-Z]{3}$/ });
  assert.equal(marketId("USD/NGN", "marketId"), "USD/NGN");
  throws(() => marketId("usd/ngn", "marketId"));
  throws(() => marketId("USD/NGN; drop table trades", "marketId"));
});

test("number rejects what arithmetic would silently accept", () => {
  const margin = number({ min: 10, max: 5_000 });
  assert.equal(margin(250, "marginUsdc"), 250);
  // A numeric string is read, because query strings only carry text.
  assert.equal(margin("250", "marginUsdc"), 250);
  throws(() => margin("abc", "marginUsdc"), /must be a number/);
  throws(() => margin(Number.NaN, "marginUsdc"));
  throws(() => margin(Number.POSITIVE_INFINITY, "marginUsdc"));
  throws(() => margin(9, "marginUsdc"), /between 10 and 5000/);
  throws(() => margin(5_001, "marginUsdc"));
});

test("integer refuses a fraction", () => {
  assert.equal(integer({ min: 1, max: 100 })(5, "leverage"), 5);
  throws(() => integer({ min: 1, max: 100 })(2.5, "leverage"), /whole number/);
});

test("address accepts a wallet and refuses an off-curve key", () => {
  const wallet = Keypair.generate().publicKey;
  assert.equal(address()(wallet.toBase58(), "wallet").toBase58(), wallet.toBase58());
  throws(() => address()("not-an-address", "wallet"));
  throws(() => address()("", "wallet"));

  // A program-derived address is a legitimate account but cannot sign, so it
  // is refused where a wallet is required and accepted where any account is.
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("parallel")],
    new PublicKey("Bu1J8eQQN2mNnUgisSEd5StBG6zDaRb7fwDjN34VzgLG"),
  );
  throws(() => address()(pda.toBase58(), "wallet"), /wallet address/);
  assert.equal(accountAddress()(pda.toBase58(), "portfolio").toBase58(), pda.toBase58());
});

test("base64Bytes insists on the exact length", () => {
  const sixtyFour = Buffer.alloc(64, 7);
  assert.ok(base64Bytes({ bytes: 64 })(sixtyFour.toString("base64"), "signature").equals(sixtyFour));
  throws(() => base64Bytes({ bytes: 64 })(Buffer.alloc(63).toString("base64"), "signature"), /64 bytes/);
  throws(() => base64Bytes({ bytes: 64 })("!!!!", "signature"));
});

test("signature wants base58 of the right length", () => {
  throws(() => signature()("0OIl".repeat(20), "signature"));
  throws(() => signature()("short", "signature"));
});

test("calendarDay rejects a date that does not exist", () => {
  assert.equal(calendarDay()("2026-02-28", "dueDate"), "2026-02-28");
  throws(() => calendarDay()("2026-02-30", "dueDate"), /real calendar date/);
  throws(() => calendarDay()("2026-2-8", "dueDate"));
});

test("oneOf is exhaustive", () => {
  const side = oneOf(["long", "short"] as const);
  assert.equal(side("long", "side"), "long");
  throws(() => side("sideways", "side"), /long, short/);
});

test("optional and withDefault treat absence, null and empty alike", () => {
  assert.equal(optional(number({ min: 0, max: 1 }))(undefined, "x"), undefined);
  assert.equal(optional(number({ min: 0, max: 1 }))(null, "x"), undefined);
  assert.equal(withDefault(integer({ min: 1, max: 9 }), 4)("", "x"), 4);
  assert.equal(withDefault(integer({ min: 1, max: 9 }), 4)(7, "x"), 7);
});

test("shape rejects an unknown field rather than ignoring it", () => {
  const body = shape({ side: oneOf(["long", "short"] as const) });
  assert.deepEqual(body({ side: "short" }, "body"), { side: "short" });
  throws(() => body({ side: "short", leverage: 99 }, "body"), /Unexpected field: leverage/);
  throws(() => body([], "body"), /JSON object/);
  throws(() => body("long", "body"), /JSON object/);
});

test("shape reports the first missing required field", () => {
  const body = shape({ wallet: address(), marketId: text({ max: 16 }) });
  throws(() => body({}, "body"), /wallet/);
});

test("a signature must decode to sixty-four bytes, not merely look long", () => {
  // Eighty '1' characters are valid base58 and the right length, and decode
  // to a run of zero bytes the RPC rejects outright.
  throws(() => signature()("1".repeat(80), "signature"), /transaction signature/);
  // A real signature's shape: 64 bytes, base58-encoded.
  const real = Buffer.alloc(64, 0xab);
  const encoded = (() => {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const digits = [0];
    for (const byte of real) {
      let carry = byte;
      for (let i = 0; i < digits.length; i += 1) {
        carry += digits[i]! << 8;
        digits[i] = carry % 58;
        carry = Math.floor(carry / 58);
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = Math.floor(carry / 58);
      }
    }
    return digits.reverse().map((d) => alphabet[d]).join("");
  })();
  assert.equal(signature()(encoded, "signature"), encoded);
});
