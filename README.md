# Parallel

Perpetual futures on emerging-market currencies, on Solana — starting with the
Nigerian naira. Priced by Parallel's own open street-rate index, executed on the
open-source [Percolator](https://github.com/aeyakovenko/percolator-prog) perps
engine.

> **Devnet only.** Mock USDC, no real money. Built for the Solana Foundation
> Perps & Prediction Markets hackathon.

## Build order

The product is built in three phases, in order. **This repo is currently in
Phase 1.**

1. **Feasibility scripts** ← *here* — TypeScript spikes that prove the engine,
   the oracle push, trading, liquidation and the price index work on devnet.
   No UI, no database, no API routes.
2. **UI with mock data** — every screen, hard-coded sample data.
3. **Functionality** — wire the screens to Percolator, the oracle and Supabase.

## Getting started

```bash
npm install
npm run spike5              # street price index, all 13 markets
npm run spike5 -- USD/NGN   # one market
npm run typecheck
```

Spike 5 needs no keys and touches no chain — it is read-only HTTP against public
price endpoints.

## The spikes

| # | Command | Proves | |
|---|---|---|---|
| 1 | `npm run spike1` | Mock USDC mint + a naira market with our wallet as oracle authority | ✅ |
| 2 | `npm run spike2` | Oracle push, read-back, and the per-slot price cap | ✅ |
| 3 | `npm run spike3` | Open a long and a short, crank, PnL, close both | ✅ |
| 4 | `npm run spike4` | Liquidation of a high-leverage position | ✅ |
| 5 | `npm run spike5` | Street price index with median / outlier / pause rules | ✅ |
| 6 | `npm run spike6` | Oracle loop with the push-on-move rule | ✅ |
| 7 | `npm run spike7` | Privy email wallet holds mock USDC and signs Percolator instructions | ✅ |

Useful alongside them:

```bash
npm run inspect                  # live market, oracle profile and portfolios
npm run spike6 -- --dry-run      # index loop without touching the chain
npm run spike1 -- --fresh        # rebuild the market from scratch
```

Spikes 1–4 and 6 touch devnet and need a funded wallet. Devnet's airdrop RPC is
closed, so they print the exact `solana transfer` command if a wallet is short.

## Layout

```
src/
  lib/            index service and (soon) the Percolator wrapper
    markets.ts      market registry and unit sizes
    sources.ts      one adapter per price venue
    index-math.ts   median, outlier, pause and push rules
    http.ts         timeout / retry / defensive parsing
  spikes/         the Phase 1 feasibility scripts
  vendor/
    percolator-v16/  vendored upstream client library, see PROVENANCE.md
wallets/          devnet keypairs — gitignored, never committed
out/              run artifacts and probed API responses — gitignored
reference/        upstream repos cloned for research — gitignored
```

## How prices are made

Every market tracks the **street price of a digital dollar**: the median USDT
price across several public venues per currency.

1. Poll each street source every 2 minutes; the official rate once a day.
2. Use the mid of best bid and best ask; for P2P books, the best offer.
3. Drop any source more than 3% from the median, then recompute.
4. A market needs at least 2 live sources, or it pauses — no new positions,
   existing positions can still close.
5. If the median strays more than 15% from the official rate, pause and alert.
6. Push on-chain when the median moves more than 0.1%, or 10 minutes pass.
7. Store every calculation with its per-source breakdown.

Each market trades a **bundle** of local currency (1,000 NGN, 10 ZAR, …) chosen
so the USD unit price lands in roughly $0.05–$10, where the engine's e6 price
scale behaves well. The UI always shows the familiar quote (₦1,450 per $1).

## A note on upstream documentation

The Percolator CLI's `README.md` and `skill.md` describe a command-line interface
and an ABI that **no longer exist** in that repo. Parallel drives the program by
importing the v16 encoder/parser library directly and hand-building instructions,
following upstream's own `tests/v16/devnet-smoke.ts`. See
`src/vendor/percolator-v16/PROVENANCE.md`.

## Licence

Vendored Percolator code is Apache-2.0, copyright its original authors.
