# Parallel

Perpetual futures on emerging-market currencies, on Solana — starting with the
Nigerian naira. Priced by Parallel's own open street-rate index, executed on the
open-source [Percolator](https://github.com/aeyakovenko/percolator-prog) perps
engine.

> **Devnet only.** Test USDC, no real money, and no mainnet date. Built for the
> Solana Foundation Perps & Prediction Markets hackathon.

Most of the world's currencies trade at two prices: the official rate a bank
will quote you, and the street rate people actually transact at. The gap is
where the risk lives, and nobody can hedge it, because no venue prices the
street rate. Parallel measures it from the exchanges and peer-to-peer desks
that make it, publishes every reading, and makes it tradable.

**Thirteen markets** are live on devnet: NGN, ZAR, ARS, BRL, MXN, COP, TRY, INR,
PHP, KES, GHS, EGP, PKR.

## What is in this repository

Two deployables that share a contract rather than code — the Supabase schema and
the committed market registry.

| | |
| --- | --- |
| `src/` | The services. The index keeper, the market and vault creation scripts, the liquidity signer, and the feasibility spikes. Runs beside the oracle key. |
| `web/` | The app. Next.js 15, App Router, React 19. Reads the index, prepares trades, and is the only thing a trader sees. |
| `market-registry.json` | Which Percolator market account is which currency. Committed, public, no secrets. |
| `src/lib/store/schema.sql` | The Supabase schema. Apply it before pointing anything at a database. |
| `docs/` | Architecture, the HTTP API, and how to run this in production. |

## Getting started

Nothing below needs a key, a database or a deployment. With no configuration at
all the app reads the JSON files under `data/`, signs with the keypairs in
`wallets/`, and talks to public devnet.

```bash
npm install                 # the services
npm install --prefix web    # the app

npm run index               # measure the street index, all 13 markets, once
npm run keeper -- --loop    # keep it measuring and push on-chain

npm run dev --prefix web    # the app, on http://localhost:3000
```

Checks, which are also what CI runs:

```bash
npm run lint                # both packages, one config
npm run typecheck           # services
npm run typecheck --prefix web
npm test                    # services
npm test --prefix web
node scripts/smoke-api.mjs  # the running API, end to end
```

## How a price becomes a trade

1. **Measure.** The index service reads every source for a market — exchange
   order books and peer-to-peer desks — drops anything more than 3% from the
   median, and recomputes. Fewer than two live sources and the market pauses
   rather than quoting a number we do not believe. (`src/lib/index-math.ts`)
2. **Publish.** Every reading is stored, including the ones that failed and the
   ones dropped as outliers, so anyone can recompute our number from the
   `/open-index` page alone.
3. **Push.** The keeper writes the median on-chain when it has moved more than
   0.1% or ten minutes have passed, whichever comes first.
   (`src/services/keeper.ts`)
4. **Trade.** The app prepares a transaction against Percolator, priced at the
   engine's own effective price, co-signed by that market's liquidity authority.
   Parallel is the counterparty: there is no order book, because the engine
   settles against an isolated vault. (`web/src/app/api/trade/prepare`)
5. **Record.** A history row is written only when a signed server quote and a
   confirmed devnet transaction agree on size, price, side and accounts.

## What is deliberately not here

Being clear about this is cheaper than being asked.

- **No order book.** Percolator matches against a vault, so a book would be
  invented liquidity. The trade screen shows the live trade feed in its place.
- **No limit, trigger, stop-loss or reduce-only orders.** The deployed devnet
  program cannot rest an order. The tabs are visible and disabled, and say why.
- **No funding.** These markets were created with a funding cap, but the devnet
  program does not accrue funding through its AuthMark price path — verified
  on-chain, with the market's own counters at zero after a full liquidation
  cycle. So the figure is zero and the screen says why rather than listing
  plausible payments.
- **No real money, and no mainnet date.** After the devnet beta has run
  properly, the contracts have been audited, and the legal position is clear in
  each country.

## Documentation

| | |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, and the two environment modes |
| [docs/API.md](docs/API.md) | Every HTTP endpoint, its schema, its limits and its errors |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Running it: objectives, incidents, backups, deployment |
| [CHANGELOG.md](CHANGELOG.md) | What changed, and when |
| [PHASE-1-REPORT.md](PHASE-1-REPORT.md) | What the feasibility spikes proved on devnet |

The product documentation a trader reads is in the app itself, under `/docs`.

## The spikes

The feasibility work that came first. Each one proves a thing on devnet rather
than arguing it, and they still run.

| # | Command | Proves |
| --- | --- | --- |
| 1 | `npm run spike1` | Test USDC mint and a naira market with our wallet as oracle authority |
| 2 | `npm run spike2` | Oracle push, read-back, and the per-slot price cap |
| 3 | `npm run spike3` | Open a long and a short, crank, P&L, close both |
| 4 | `npm run spike4` | A position liquidates on an adverse mark |
| 5 | `npm run spike5` | The street index, all 13 markets, read-only HTTP |
| 6 | `npm run spike6` | The oracle loop at its real cadence |
| 7 | `npm run spike7` | A browser wallet trading against it |

`PHASE-1-REPORT.md` has the signatures.

## Licence and credit

Percolator is Anza's, and is vendored under `src/vendor/percolator-v16/` at the
version deployed on devnet. Price sources are credited by name on the
`/open-index` page, which is the point of that page.
