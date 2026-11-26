/**
 * An end-to-end pass over the guarded API, against a running server.
 *
 * Unit tests cover the pieces; this checks the wiring — that a route really
 * refuses what the module it imports says it refuses. Read-only apart from
 * the faucet, which is driven with a throwaway keypair and expected to be
 * refused at the proof stage rather than funded.
 *
 *   node scripts/smoke-api.mjs [http://localhost:3000]
 */

import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/** A well-formed signature for a transaction that was never sent. */
const unsentSignature = () => bs58.encode(randomBytes(64));

const base = process.argv[2] ?? "http://localhost:3000";
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A fresh caller identity per run, and per section that exercises a ceiling.
 *
 * The rate limiter keys on `x-forwarded-for`, which a direct caller can set to
 * whatever it likes — stated plainly in `rate-limit.ts`, and the reason
 * nothing security-critical is keyed on it alone. Here it is useful: without
 * it, two runs inside the same minute poison each other, and a passing suite
 * would depend on how recently it last ran.
 */
let identity = `smoke-${Math.random().toString(36).slice(2)}`;
const freshIdentity = () => {
  identity = `smoke-${Math.random().toString(36).slice(2)}`;
};

const get = (path) => fetch(`${base}${path}`, { headers: { "x-forwarded-for": identity } });

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": identity,
      ...headers,
    },
    body: JSON.stringify(body),
  });

function walletSign(keypair, message) {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8, Buffer.from(keypair.secretKey.subarray(0, 32))]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, Buffer.from(message, "utf8"), key);
}

const json = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

console.log(`\nParallel API smoke test against ${base}\n`);

// ------------------------------------------------------------- liveness --
{
  const health = await get("/api/health");
  check("GET /api/health is 200", health.status === 200);
  const ready = await get("/api/ready");
  const body = await json(ready);
  check("GET /api/ready reports its checks", Array.isArray(body.checks), JSON.stringify(body).slice(0, 120));
  check("readiness status matches its own verdict", (ready.status === 200) === body.ready);
}

// ------------------------------------------------------------ public reads --
freshIdentity();
{
  const markets = await get("/api/markets");
  const body = await json(markets);
  check("GET /api/markets is 200", markets.status === 200);
  check("markets carry a request id", Boolean(markets.headers.get("x-request-id")));
  check("markets are cacheable", /max-age/.test(markets.headers.get("cache-control") ?? ""));
  check("markets expose source counts", body.markets?.every((m) => typeof m.sourceCount === "number"));
  const paused = body.markets?.filter((m) => !m.acceptingPositions) ?? [];
  check(
    "a paused market explains itself in words",
    paused.length === 0 || paused.every((m) => typeof m.pausedBecause === "string" && m.pausedBecause.length > 20),
    JSON.stringify(paused.map((m) => [m.code, m.pausedBecause])).slice(0, 160),
  );

  const candles = await get("/api/candles?market=USD/NGN&tf=1D");
  check("GET /api/candles is 200", candles.status === 200);
  const badTf = await get("/api/candles?market=USD/NGN&tf=7Y");
  check("an unknown timeframe is a 400", badTf.status === 400, String(badTf.status));
  const badMarket = await get("/api/candles?market=../../etc/passwd&tf=1D");
  check("a path in the market name is a 400", badMarket.status === 400, String(badMarket.status));
  const noMarket = await get("/api/candles");
  check("a missing market is a 400", noMarket.status === 400, String(noMarket.status));
}

// ------------------------------------------------------------- portfolio --
freshIdentity();
{
  const bad = await get("/api/portfolio?wallet=nonsense");
  check("a malformed wallet is a 400", bad.status === 400, String(bad.status));
  const none = await get("/api/portfolio");
  check("a missing wallet is a 400", none.status === 400, String(none.status));
  const real = await get(`/api/portfolio?wallet=${Keypair.generate().publicKey.toBase58()}`);
  const body = await json(real);
  check("an unused wallet reads as empty, not an error", real.status === 200 && Array.isArray(body.portfolios));
  check("a private read is not cached", /no-store/.test(real.headers.get("cache-control") ?? ""));
}

// ----------------------------------------------------------- body guards --
freshIdentity();
{
  const wrongType = await fetch(`${base}/api/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "text/plain", "x-forwarded-for": identity },
    body: "wallet=x",
  });
  check("a non-JSON body is a 400", wrongType.status === 400, String(wrongType.status));

  const broken = await fetch(`${base}/api/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": identity },
    body: "{oops",
  });
  check("broken JSON is a 400", broken.status === 400, String(broken.status));

  const huge = await post("/api/auth/challenge", {
    wallet: Keypair.generate().publicKey.toBase58(),
    purpose: "faucet",
    padding: "x".repeat(20_000),
  });
  check("an oversized body is a 400", huge.status === 400, String(huge.status));

  const unknownField = await post("/api/auth/challenge", {
    wallet: Keypair.generate().publicKey.toBase58(),
    purpose: "faucet",
    admin: true,
  });
  const unknownBody = await json(unknownField);
  check(
    "an unexpected field is refused by name",
    unknownField.status === 400 && /admin/.test(unknownBody.error ?? ""),
    unknownBody.error,
  );

  const crossOrigin = await post(
    "/api/auth/challenge",
    { wallet: Keypair.generate().publicKey.toBase58(), purpose: "faucet" },
    { origin: "https://not-parallel.example" },
  );
  check("a cross-origin write is a 403", crossOrigin.status === 403, String(crossOrigin.status));
}

// --------------------------------------------------------------- faucet --
freshIdentity();
{
  const wallet = Keypair.generate();
  const stranger = Keypair.generate();

  const noProof = await post("/api/faucet", { wallet: wallet.publicKey.toBase58() });
  check("the faucet refuses a request with no proof", noProof.status === 400, String(noProof.status));

  const challenged = await post("/api/auth/challenge", {
    wallet: wallet.publicKey.toBase58(),
    purpose: "faucet",
  });
  const challenge = await json(challenged);
  check("a challenge is issued", challenged.status === 200 && typeof challenge.message === "string");
  check(
    "the challenge names the wallet and says it moves nothing",
    (challenge.message ?? "").includes(wallet.publicKey.toBase58()) &&
      /moves nothing/.test(challenge.message ?? ""),
  );

  const forged = await post("/api/faucet", {
    wallet: wallet.publicKey.toBase58(),
    proof: challenge.token,
    signature: Buffer.alloc(64, 1).toString("base64"),
  });
  check("a forged signature is a 403", forged.status === 403, String(forged.status));

  const wrongSigner = await post("/api/faucet", {
    wallet: wallet.publicKey.toBase58(),
    proof: challenge.token,
    signature: walletSign(stranger, challenge.message).toString("base64"),
  });
  check("another wallet's signature is a 403", wrongSigner.status === 403, String(wrongSigner.status));

  const redirected = await post("/api/faucet", {
    wallet: stranger.publicKey.toBase58(),
    proof: challenge.token,
    signature: walletSign(stranger, challenge.message).toString("base64"),
  });
  check(
    "a challenge cannot be pointed at another wallet",
    redirected.status === 403,
    String(redirected.status),
  );

  const tampered = await post("/api/faucet", {
    wallet: wallet.publicKey.toBase58(),
    proof: `${challenge.token}x`,
    signature: walletSign(wallet, challenge.message).toString("base64"),
  });
  check("an edited proof token is refused", tampered.status >= 400, String(tampered.status));
}

// ----------------------------------------------------- trade preparation --
freshIdentity();
{
  const wallet = Keypair.generate();
  const portfolio = Keypair.generate();

  const degenerate = await post("/api/trades", {
    signature: "1".repeat(80),
    quoteToken: "x.y",
  });
  check(
    "a signature that is the right length but not 64 bytes is a 400",
    degenerate.status === 400,
    String(degenerate.status),
  );

  const noQuote = await post("/api/trades", { signature: unsentSignature() });
  check("history cannot be written without a quote", noQuote.status === 400, String(noQuote.status));

  const madeUpQuote = await post("/api/trades", {
    signature: unsentSignature(),
    quoteToken: Buffer.from(
      JSON.stringify({ k: "trade-quote", exp: Date.now() + 60_000, n: "x", p: { leverage: 100 } }),
    ).toString("base64url") + ".bm90YXNpZ25hdHVyZQ",
  });
  check("an unsigned quote is refused", madeUpQuote.status === 403, String(madeUpQuote.status));

  const overLeveraged = await post("/api/trade/prepare", {
    wallet: wallet.publicKey.toBase58(),
    portfolio: portfolio.publicKey.toBase58(),
    marketId: "USD/NGN",
    side: "long",
    marginUsdc: 100,
    leverage: 50,
  });
  const overBody = await json(overLeveraged);
  check(
    "leverage past the market's cap is refused",
    overLeveraged.status === 400 && /leverage/i.test(overBody.error ?? ""),
    overBody.error,
  );

  const tinyMargin = await post("/api/trade/prepare", {
    wallet: wallet.publicKey.toBase58(),
    portfolio: portfolio.publicKey.toBase58(),
    marketId: "USD/NGN",
    side: "long",
    marginUsdc: 1,
    leverage: 2,
  });
  check("margin below the floor is refused", tinyMargin.status === 400, String(tinyMargin.status));

  const hugeNotional = await post("/api/trade/prepare", {
    wallet: wallet.publicKey.toBase58(),
    portfolio: portfolio.publicKey.toBase58(),
    marketId: "USD/NGN",
    side: "long",
    marginUsdc: 5000,
    leverage: 5,
  });
  check(
    "notional past the vault's cap is refused",
    hugeNotional.status === 409,
    `${hugeNotional.status} ${JSON.stringify(await json(hugeNotional)).slice(0, 120)}`,
  );

  const unknownMarket = await post("/api/trade/prepare", {
    wallet: wallet.publicKey.toBase58(),
    portfolio: portfolio.publicKey.toBase58(),
    marketId: "USD/ZZZ",
    side: "long",
    marginUsdc: 100,
    leverage: 2,
  });
  check("an unknown market is a 404", unknownMarket.status === 404, String(unknownMarket.status));

  // A stale on-screen price must be refused rather than filled quietly.
  const stale = await post("/api/trade/prepare", {
    wallet: wallet.publicKey.toBase58(),
    portfolio: portfolio.publicKey.toBase58(),
    marketId: "USD/NGN",
    side: "long",
    marginUsdc: 100,
    leverage: 2,
    expectedPriceE6: 400_000,
    maxSlippageBps: 50,
  });
  const staleBody = await json(stale);
  check(
    "a price that moved past tolerance is refused",
    stale.status === 409 && /moved/.test(staleBody.error ?? ""),
    `${stale.status} ${staleBody.error}`,
  );

  // The real thing: a signable transaction plus a quote that explains it.
  const prepared = await post("/api/trade/prepare", {
    wallet: wallet.publicKey.toBase58(),
    portfolio: portfolio.publicKey.toBase58(),
    marketId: "USD/NGN",
    side: "long",
    marginUsdc: 100,
    leverage: 2,
  });
  const body = await json(prepared);
  check(
    "a valid request is prepared",
    prepared.status === 200 && typeof body.transaction === "string",
    `${prepared.status} ${JSON.stringify(body).slice(0, 200)}`,
  );
  if (prepared.status === 200) {
    check("a signed quote comes back with it", typeof body.quoteToken === "string");
    check("the quote states a fill price", body.quote?.entryPrice > 0);
    check("the quote states the gap to the index", Number.isFinite(body.quote?.priceImpactBps));
    check("the quote states its own expiry", Boolean(Date.parse(body.quote?.expiresAt ?? "")));
    check(
      "the quote states where liquidation sits",
      body.quote?.approximateLiquidationPrice > 0 &&
        body.quote.approximateLiquidationPrice < body.quote.entryPrice,
      JSON.stringify(body.quote),
    );

    // A real quote, with a transaction that was never sent.
    const unsent = await post("/api/trades", {
      signature: unsentSignature(),
      quoteToken: body.quoteToken,
    });
    check(
      "a quote with no confirmed transaction stores nothing",
      unsent.status === 409,
      `${unsent.status} ${JSON.stringify(await json(unsent)).slice(0, 120)}`,
    );
  }

  const noPosition = await post("/api/trade/close/prepare", {
    wallet: wallet.publicKey.toBase58(),
    portfolio: portfolio.publicKey.toBase58(),
    marketId: "USD/NGN",
  });
  check(
    "closing a portfolio that does not exist is refused",
    noPosition.status === 503 || noPosition.status === 409,
    String(noPosition.status),
  );
}

// ---------------------------------------------------------- rate limiting --
freshIdentity();
{
  // The faucet ceiling is the tightest, so it is the quickest to demonstrate.
  const wallet = Keypair.generate().publicKey.toBase58();
  let limited = false;
  for (let i = 0; i < 12; i += 1) {
    const response = await post("/api/faucet", { wallet });
    if (response.status === 429) {
      limited = true;
      check("a refused request says when to come back", Number(response.headers.get("retry-after")) > 0);
      break;
    }
  }
  check("a caller past the ceiling is refused", limited);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
