# HTTP API

Thirteen routes under `/api`. Everything here is devnet.

There is **no versioning in the path** and that is deliberate: this API has one
consumer, the app shipped in the same commit, and a `/v1/` prefix that never
changes value is decoration. If a second consumer ever appears, the version
goes in the path at that point, and this paragraph becomes the note explaining
why `/v1` starts where it does.

## Conventions

| | |
| --- | --- |
| Encoding | JSON in, JSON out. A request body must declare `Content-Type: application/json` |
| Body ceiling | 4 KB, counted as it arrives rather than after parsing |
| Unknown fields | **Rejected**, not ignored — more likely a client on the wrong deployment than a harmless extra |
| Amounts | `tUSDC` as a decimal number; on-chain quantities as a decimal **string**, because they exceed a JS number |
| Prices | `…PriceE6` is micro-dollars per contract, the engine's own scale. A `quote` price is local currency per USD |
| Times | ISO 8601, UTC |
| Request id | Every response carries `X-Request-Id`. Quote it in a bug report |

### Errors

```json
{ "error": "Margin must be between 10 and 5000", "code": "bad_request" }
```

`code` is stable and machine-readable; `error` is written for a person and may
change. A 500 also carries `requestId`, matching the header, which is the
thread to the full trace in the log — the message itself says nothing, on
purpose, because the thing it used to say was a database permission error or a
path inside the wallets folder.

| `code` | Status | Means |
| --- | --- | --- |
| `bad_request` | 400 | The request is malformed. The message names the field |
| `unauthorized` | 401 | Missing proof |
| `forbidden` | 403 | Proof present and wrong, or a cross-origin write |
| `not_found` | 404 | No such market |
| `conflict` | 409 | Understood, and refused: paused market, expired quote, price moved |
| `rate_limited` | 429 | Over the ceiling. `Retry-After` says when |
| `unavailable` | 503 | A dependency is down, or this deployment is not configured for it |
| `internal` | 500 | Ours. Quote the `requestId` |

### Rate limits

Per caller per minute, identified by the left-most `X-Forwarded-For` hop.
Responses carry `RateLimit-Limit` and `RateLimit-Remaining`.

| Class | Per minute | Routes |
| --- | --- | --- |
| read | 240 | markets, candles, index-feed, vaults, trades (GET), portfolio, ready, trade/quote |
| write | 30 | trades (POST), hedge |
| prepare | 20 | trade/prepare, trade/close/prepare |
| faucet | 4 | faucet |
| challenge | 20 | auth/challenge |

The counter is in the serving process's memory, which holds for the
single-instance deployment and resets on restart. The faucet does not rely on
it alone: its cooldown is a row in the store, so it survives both.

### Cross-origin

Reads are open, so the public market data stays embeddable. Anything that
changes state refuses a request whose `Origin` is not ours.

---

## Market data

### `GET /api/markets`

The board. One row per market, live where the index has it.

`Cache-Control: public, max-age=5, stale-while-revalidate=55`

```bash
curl -s https://parallel.example/api/markets
```

```json
{
  "markets": [
    {
      "code": "NGN",
      "id": "USD/NGN",
      "median": 1440.51,
      "official": 1353.58,
      "premiumPct": 6.42,
      "unitPriceUsd": 0.694197,
      "markUnitPriceUsd": 0.688719,
      "mark": 1451.97,
      "basisBps": -79,
      "openInterestLongUsdc": 68.81,
      "openInterestShortUsdc": 0,
      "unitLabel": "kNGN",
      "maxLeverage": 5,
      "status": "ok",
      "acceptingPositions": true,
      "reason": null,
      "pausedBecause": null,
      "sources": ["ngn:quidax", "ngn:luno"],
      "sourceCount": 2,
      "sourcesTried": 3,
      "ts": "2026-11-26T13:58:04.000Z",
      "ageSeconds": 44,
      "change24hPct": -0.3,
      "lastPushTx": "5xH…",
      "marketAccount": "3DjLeHeYRXTtCUozjGvjsVuFwUV3NyWEdVrBsk8gpBmV",
      "collateralVault": "ByNsVoNZ8ugzZ8hvoi7eudBZpR2eiQ4ZN7tn1szNHbBf",
      "maxNotionalUsdc": 5000,
      "maxOpenInterestUsdc": 50000
    }
  ],
  "collateralMint": "6W4yrqeCDsN6Z1YwasT2X2RTgTVfZB7t77UYHRzbjd18",
  "at": "2026-11-26T13:58:48.019Z"
}
```

Notes on the fields that are easy to misread:

- `median` and `unitPriceUsd` are the **index**. `mark` and `markUnitPriceUsd`
  are the **engine's own price**, read from the chain. They are different
  numbers and `basisBps` is the gap — that gap is where a fill actually lands.
- `null` means *we do not have this*, never zero. A paused market has a null
  median, and `change24hPct` is null until there is a full day of history.
- `pausedBecause` is written for a person. `reason` is the index service's own
  vocabulary.
- `sourceCount` / `sourcesTried` is source health: how many venues answered
  with a price we kept, out of how many we asked.

### `GET /api/candles?market=USD/NGN&tf=1H`

`tf` is one of `1H`, `4H`, `1D`, `1W`, `1M`.

`Cache-Control: public, max-age=10, stale-while-revalidate=110`

Returns `candles` (pre-rolled OHLC in the quote scale, with `unitOpen` and
`unitClose` in the engine's), `ticks` (raw index points, for a market too young
for candles), `officialHistory` (the published official rate, two years of it)
and `officialCandles` (real OHLC built from those dailies, or `null` for
timeframes where a bucket holds one published rate and there is nothing honest
to build).

The official series is a **different quantity** from the street median. The
chart labels it, and so should any other consumer.

### `GET /api/index-feed`

Everything behind a number: every source reading including the ones that failed
and the ones dropped as outliers, the rules in force, and the transaction each
push went out in. A reader should be able to recompute our index from this
response alone — that is the point of it.

`Cache-Control: public, max-age=15, stale-while-revalidate=105`

### `GET /api/vaults`

The capital and the caps actually standing behind each market, read from the
chain. There is no order book to publish; this is what is there instead.

---

## Trading

### `POST /api/trade/quote`

What a trade would cost. **Signs nothing** — a preview must not spend a
liquidity authority's signature or a blockhash, which is why it is a separate
route from `prepare`.

```bash
curl -s -X POST https://parallel.example/api/trade/quote \
  -H 'content-type: application/json' \
  -d '{"marketId":"USD/NGN","side":"long","marginUsdc":500,"leverage":3}'
```

```json
{
  "marketId": "USD/NGN", "side": "long", "marginUsdc": 500, "leverage": 3,
  "notionalUsdc": 1500,
  "entryPrice": 0.688719, "entryQuote": 1451.97,
  "indexPrice": 0.694197, "indexQuote": 1440.51,
  "priceImpactBps": -79,
  "approximateLiquidationPrice": 0.918292,
  "approximateLiquidationQuote": 1088.98,
  "maxLeverage": 5, "maxNotionalUsdc": 5000, "maxOpenInterestUsdc": 50000,
  "sideOpenInterestUsdc": 68.81,
  "tradable": true, "blockedBecause": null,
  "at": "2026-11-26T13:59:51.126Z"
}
```

`approximateLiquidation*` is the textbook `1/leverage` figure. Percolator keeps
maintenance margin at an account offset this app does not read, and fees and
funding bring the real point slightly nearer, so it is an approximation and is
labelled as one everywhere it is shown. Note the direction: a user-facing long
is an engine short, so its liquidation sits **above** entry in `entryPrice`
terms and **below** it in `entryQuote` terms.

### `POST /api/trade/prepare`

| Field | | |
| --- | --- | --- |
| `wallet` | required | The trader's address. Must be on-curve |
| `portfolio` | required | Their Percolator portfolio for this market |
| `marketId` | required | `USD/XXX` |
| `side` | required | `long` or `short`, in the user-facing convention |
| `marginUsdc` | required | 10 – 5,000 |
| `leverage` | required | A whole number, up to the market's cap |
| `expectedPriceE6` | optional | The price the screen showed. **Without it no slippage gate is applied** — see below |
| `maxSlippageBps` | optional | 1 – 1000, default 100 |

Returns a base64 transaction, already co-signed by the liquidity authority and
needing only the trader's signature, plus a signed `quoteToken` and a human
`quote` block.

Refused with `conflict` when: the market is paused, the notional exceeds the
vault's per-trade cap, this side's open interest would exceed its cap, or the
price has moved further than `maxSlippageBps` from `expectedPriceE6`.

Slippage is measured **only** against `expectedPriceE6`. It is deliberately not
measured against the index when that field is absent: slippage means "the price
moved while you were deciding", whereas the engine's distance from the index is
the *basis* — a standing property of a market whose keeper pushes on a 0.1% move
or every ten minutes, and legitimately above 1%. Conflating the two refused
ordinary trades with a message claiming the price had just moved, which was
untrue. The basis is reported as `priceImpactBps` instead, and `slippageChecked`
says whether the gate ran.

The transaction expires with its blockhash. The `quoteToken` expires first, at
75 seconds, so the failure says *the quote expired* rather than *blockhash not
found*.

### `POST /api/trade/close/prepare`

`{wallet, portfolio, marketId}`. Nothing about the size comes from the caller:
the portfolio is read from the chain, its ownership and market are checked, and
the close is the exact negation of the leg found there.

**Deliberately not slippage-gated.** Refusing to let somebody out of a position
because the price moved is how a trader is liquidated by their own risk control.

### `POST /api/trades`

`{signature, quoteToken}` — and nothing else, which is the point. The stored
row is built from the quote this server signed and the transaction devnet
confirmed, and written only when the two agree on size, price, side and
accounts. A client cannot author history here, and cannot colour it in either.

The quote's nonce is spent only once the row is written, so a verification that
fails for an unrelated reason leaves the caller able to retry. Rows are
idempotent on the transaction signature regardless.

### `POST /api/hedge`

`{signature, quoteToken, amountLocal, dueDate}`. The same two-sided
verification, plus three requirements the quote must satisfy: an **opening**,
**long**, **1x** position. A close, a short or a levered position cannot be
filed as a hedge.

`dueDate` is `YYYY-MM-DD` and must be a date that exists.

---

## The wallet's own data

### `GET /api/trades?wallet=…&marketId=…&before=…&limit=…`

Newest first. Filtered **in the database**, not after — this route used to read
the most recent 200 trades globally and filter them afterwards, so a wallet
whose last trade was 200 trades ago saw nothing.

Paging is by cursor: pass the `nextCursor` from the previous page as `before`.
Offset paging would skip or repeat rows, because new ones arrive at the top of
this ordering constantly. `nextCursor` is `null` on the last page.

With a `wallet`, the response is `private, no-store`.

```json
{ "trades": [ … ], "nextCursor": "2026-11-22T15:04:12+00:00" }
```

### `GET /api/portfolio?wallet=…`

Everything the chain says this wallet owns, at one slot: the token balance,
every Percolator portfolio it owns (found by program scan on account size and
the owner at its fixed offset, so a portfolio opened on another machine still
appears), the capital and stored P&L in each, and the open legs with the
engine's current price.

Nothing is seeded and nothing is interpolated. A figure this route cannot read,
it does not return, so the UI shows a dash rather than a plausible number.

`Cache-Control: private, no-store`.

### `GET /api/hedge?wallet=…`

The hedge intents filed against that wallet's positions.

---

## Devnet funds

### `POST /api/auth/challenge`

`{wallet, purpose: "faucet"}` → `{message, token, expiresInSeconds}`.

Sign `message` **exactly**, byte for byte, with the wallet named in it. No state
is stored: `token` is what lets the server rebuild that same challenge.

### `POST /api/faucet`

`{wallet, proof, signature}` where `proof` is the challenge token and
`signature` is base64 of the 64-byte ed25519 signature over the challenge text.

Tops a wallet **up to** 0.12 SOL and 5,000 tUSDC rather than adding to it, so a
retry after a timeout cannot double-fund. Cooldown is six hours per wallet and
forty claims in total, recorded in the store rather than in memory.

Refused with `forbidden` when the signature is not that wallet's, or the
challenge was issued for a different wallet or purpose.

---

## Operational

### `GET /api/health`

Shallow and fast: no database, no RPC. It cannot be made to fail by something
downstream, which is exactly what a process supervisor needs to know.

### `GET /api/ready`

Three dependencies checked independently — the registry, the index store and
devnet — each reported separately so the answer says *which* is down. **200**
when a trade could be placed, **503** when it could not, so an uptime check
needs no body parser.

```json
{
  "ready": true, "mode": "production",
  "marketsLive": 9, "marketsTotal": 13,
  "checks": [
    { "name": "registry", "ok": true, "detail": "13 markets configured" },
    { "name": "index", "ok": true, "detail": "9 of 13 markets priced" },
    { "name": "devnet", "ok": true, "detail": "slot 526519523" }
  ],
  "at": "2026-11-26T13:12:07.775Z"
}
```
