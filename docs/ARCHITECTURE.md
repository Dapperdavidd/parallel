# Architecture

Two deployables, one contract between them, and a deliberate rule about which
one is allowed to hold a key.

```
  price sources                    Solana devnet
  (exchanges, P2P desks)           ┌──────────────────────────────┐
         │                         │  Percolator v16              │
         │  HTTP, read-only        │  Bu1J8eQQ…VzgLG              │
         ▼                         │                              │
  ┌─────────────────┐   AUTH_MARK  │  13 market accounts          │
  │  index keeper   │─────push────▶│  13 liquidity portfolios     │
  │  src/services/  │              │  one collateral mint         │
  │  keeper.ts      │              └──────────────────────────────┘
  └────────┬────────┘                        ▲            ▲
           │ writes                          │            │
           ▼                      co-signs a trade        │ reads accounts
  ┌─────────────────┐                        │            │
  │  Supabase       │                ┌───────┴────────────┴───────┐
  │  index_ticks    │◀──── reads ────│  web app (Next.js)         │
  │  candles        │                │  web/                      │
  │  trades, hedges │                └───────┬────────────────────┘
  └─────────────────┘                        │ asks for a signature
                                             ▼
                                   ┌────────────────────┐
                                   │  liquidity signer  │
                                   │  src/services/     │
                                   │  signer.ts         │
                                   └────────────────────┘
```

## The index keeper

`src/services/keeper.ts`, run as `npm run keeper -- --loop`.

One pass every two minutes: read every source for all thirteen markets,
compute each index, store the tick with its full per-source breakdown, and push
on-chain where the rule says to. The rules are in `src/lib/index-math.ts` and
are the PRD's verbatim:

- drop any source more than **3%** from the median, then recompute;
- a market needs at least **two** live sources, or it pauses;
- if the median strays more than **15%** from the official rate, pause;
- push when the median moves more than **0.1%** or **ten minutes** pass.

A paused market takes no new positions. Existing positions can still close —
that distinction matters, and refusing to let somebody out is worse than
refusing to let them in.

The process is built not to die. `src/lib/stay-alive.ts` keeps it up through an
unhandled rejection (an `ECONNRESET` from a source killed it once and the whole
index went stale for hours), and every pass runs under a deadline so a hung
socket cannot stop the clock. `scripts/keeper-supervise.sh` restarts it unless
it exits deliberately, and holds the machine awake.

**It currently runs on a laptop.** That is the largest open operational risk and
it is the owner's decision to make — see OPERATIONS.md.

## The web app

`web/`, Next.js 15 App Router. Server-only modules live under
`web/src/lib/server/` and are fenced with `import "server-only"`, so a route
handler may read the database and a client component may not.

Every API route goes through one guard, `web/src/lib/server/request.ts`:

| | |
| --- | --- |
| `env.ts` | What production requires; which mode this is; the app secret; the RPC |
| `validate.ts` | Declarative field validators, no dependency |
| `rate-limit.ts` | Per-caller ceilings |
| `respond.ts` | `ok` / `reject`, and one funnel for anything thrown |
| `log.ts` | One line of JSON per event, with secret-shaped keys redacted |
| `request.ts` | `route()` and `readJson()` |
| `tokens.ts` | HMAC envelopes with expiry and single-use nonces |
| `wallet-proof.ts` | Ownership challenges, verified with Node's own ed25519 |
| `quotes.ts` | The signed quote carried from prepare to record |
| `signing.ts` | The only door to a signing key |

A failure is one of two things. A **rejection** is the caller's to fix and says
exactly what is wrong. Anything else is logged in full with a request id and
answered generically with that same id — which the caller also gets in the
`X-Request-Id` header, so a support message quoting a reference leads straight
to the trace.

## Where the keys are

Parallel is the counterparty to every trade, so each one needs a signature from
that market's liquidity authority. There are two ways to provide it, and the
preference is not close.

**Remote (preferred).** Set `PARALLEL_SIGNER_URL` and the web app holds no key
at all. It sends the serialised transaction message to `src/services/signer.ts`
— which runs on the machine that already holds the keys, bound to loopback by
default — and gets back one 64-byte signature, which
`Transaction.addSignature` verifies against the message before attaching. The
signer will sign only when all of this holds:

- every instruction belongs to the compute-budget program or to Percolator;
- there is exactly one Percolator instruction and it is a trade (tag 6);
- its vault-authority account is the key being asked for;
- its market and vault-portfolio accounts match the registry;
- the authority is neither the fee payer nor writable.

So a fully compromised web app cannot borrow the signer to move the authority's
funds or retarget another market's vault. The policy is a pure function of the
message bytes (`src/lib/signer-policy.ts`) with a test per attack shape.

**Local.** Keys from `PARALLEL_LIQUIDITY_SECRETS` or a secrets directory
outside the repository. The repository's own `wallets/` folder is the
development default and is **refused** in production.

The faucet's mint authority is the one exception: it mints through
`@solana/spl-token` helpers that build, sign and send in one call, so there is
no message to hand to a remote signer. It is devnet-only and mints a valueless
test token, which is the trade that exception is worth.

## Two environment modes

The modes are not "configured" and "misconfigured". They are two supported
shapes, and the app says which one it is in.

| | Development | Production |
| --- | --- | --- |
| Store | JSON files under `data/` | Supabase, required |
| Signing keys | `wallets/` in the repository | Environment or a signer, required |
| App secret | A random one per process | `PARALLEL_APP_SECRET`, required |
| Missing a requirement | A warning at boot | **The process refuses to start** |

`web/src/instrumentation.ts` runs `assertServerEnv()` once per server start and
rethrows, so a deployment missing its secrets fails to boot rather than serving
and then failing every write. That file must live in `web/src/`, beside `app/` —
Next looks for it there, and a copy at the project root is simply never called.

`PARALLEL_ENV=development` forces the development contract, which is what you
want when running a production build on your own machine, since `npm start`
sets `NODE_ENV=production` either way.

A configured database is **authoritative**: the file store is the other
backend, not a safety net under it. Falling through to local files on a database
error is what hid a permissions failure for two days, answering with stale
history as though it were live.

## The data model

`src/lib/store/schema.sql` is the whole of it. On-chain state stays the source
of truth for positions, balances and liquidations; this database is a cache and
a history, so that the charts, the public index page and the traction figures
can be served without replaying the chain.

| Table | What it is for |
| --- | --- |
| `markets`, `sources` | The registry and the source configuration, so the index page can describe the method without shipping code |
| `index_ticks` | Every two-minute calculation with its per-source breakdown, and the transaction each push went out in. Unique on `(market_id, ts)` |
| `candles` | Pre-rolled OHLC, so a chart is a query rather than a reduction |
| `trades` | Chain-verified history. Unique on `tx_signature`, which is what makes a retried write a no-op |
| `hedges` | The intent behind a hedge: the local amount and the date it is needed by. No anon read policy |
| `faucet_claims` | The faucet's durable cooldown. One row per wallet, no IP column |

Reads of public market data are open to the anon role. Every write, and
everything about a person, belongs to the service role.

## Price conventions, and the one thing to get right

The engine trades the local currency priced in dollars. A contract is a bundle
of local currency — 1,000 NGN, 10 ZAR — and the mark pushed on-chain is
`unitSize / streetRate`, which is **USD per bundle**. So the engine's price
*falls* as the local currency weakens.

Every screen shows the familiar quote instead: local currency per USD, which
*rises* as the currency weakens. The two are reciprocals, and mixing them is
the single most expensive mistake available in this codebase.

**A user-facing long is an engine short.** Everything above the engine boundary
speaks the user-facing convention; only `sizeQ` on the wire is in engine terms.
`web/src/lib/side.ts` is the one module that knows, and everything else derives
from it. This has been got wrong twice — once opening positions the wrong way
round (DECISIONS §7.16), once showing a long being liquidated in the direction
it profits — so the tests now derive the direction from `pnlSign` rather than
restating it.

## Validating the engine's layout

Percolator's account layout is read at fixed byte offsets. If that program is
upgraded and a field moves, the parse does not fail — it returns a number from
the wrong place, and a trade would be priced on it.

There is no version byte in the account to check, and the program's
upgrade-data account does not resolve on devnet, so the deployed slot and a
hash of the program bytes are both unavailable. The strongest check available
is a cross-reference: `assertEnginePriceSane` refuses to trade when the
engine's effective price and our own index differ by more than 40%, and warns
past 10%. In practice they sit within about 5%, because of the push rule. A
misread field would be out by orders of magnitude.

It is a plausibility check, not a version check. Both prepare routes fail
closed on it.
