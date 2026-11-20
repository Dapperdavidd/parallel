# Parallel — Phase 1 report

**Feasibility scripts. 20 November 2026.**

All seven spikes pass on Solana devnet. No UI, no database, no API routes were
built, and no Rust was written or modified.

Phase 1 asked whether the core works. It does — but it also turned up several
places where the plan was based on documentation that no longer matches
reality. Those are the parts worth reading.

---

## 1. Which checks passed

| # | Spike | Result |
|---|---|---|
| 1 | Mock USDC mint + naira market with our wallet as oracle authority | ✅ pass |
| 2 | Oracle push, read-back, circuit breaker | ✅ pass |
| 3 | Open a long and a short, move the price, close both | ✅ pass |
| 4 | Liquidate a high-leverage position | ✅ pass |
| 5 | Street price index, all 13 launch markets | ✅ pass |
| 6 | 2-minute oracle loop for 30 minutes | ✅ pass |
| 7 | Privy email wallet holds mock USDC and signs Percolator instructions | ✅ pass |

Live devnet artefacts:

| | |
|---|---|
| Percolator program | `Bu1J8eQQN2mNnUgisSEd5StBG6zDaRb7fwDjN34VzgLG` |
| Market (USD/NGN) | `HWNLPt9wYYtTHFhekp5e58uEutsqf8LzybK97mVCDMQo` |
| Mock USDC mint (6 dp) | `6W4yrqeCDsN6Z1YwasT2X2RTgTVfZB7t77UYHRzbjd18` |
| Oracle authority | `8iApLfrsJBNDkZYFNxZqvr1QVAmm6NFmAdqLaiXi8jHu` |
| Privy embedded wallet | `2PaXdZBJ7uKiFkjhbdxG4MCX8qBYXfJCvzQNyQU4sWTg` |

**121 transactions attempted, 110 landed, 11 failed.** Every failure is
explained in §4; none is an unresolved defect.

---

## 2. The price scale, per market

Percolator prices in **e6** (`1_000_000` = $1.00). The collateral mint's
decimals are independent of this — confirmed in spike 1.

Each market trades a **bundle** of local currency so the USD unit price is a
comfortable size. Measured live on 20 November:

| Market | Unit | Street rate | Unit price | Premium over official |
|---|---|---|---|---|
| USD/NGN | 1,000 NGN | 1,437.50 | **$0.6957** | +6.46% |
| USD/ZAR | 10 ZAR | 17.50 | $0.5713 | +1.20% |
| USD/ARS | 1,000 ARS | 1,742.19 | $0.5740 | +11.73% |
| USD/BRL | 1 BRL | 6.00 | $0.1667 | +2.00% |
| USD/MXN | 10 MXN | 19.02 | $0.5257 | +0.63% |
| USD/COP | 1,000 COP | 3,410.85 | $0.2932 | +1.67% |
| USD/TRY | 10 TRY | 50.47 | $0.1982 | +0.01% |
| USD/INR | 100 INR | 103.08 | $0.9701 | +10.46% |
| USD/PHP | 100 PHP | 63.88 | $1.5655 | +0.29% |
| USD/KES | 100 KES | 130.64 | $0.7655 | +0.49% |
| USD/GHS | 10 GHS | 12.35 | $0.8097 | +5.20% |
| USD/EGP | 100 EGP | 55.15 | $1.8132 | +2.44% |
| USD/PKR | 100 PKR | 286.05 | $0.3496 | +3.49% |

All 13 land between $0.17 and $1.82.

**But the PRD's stated reason for those units is wrong.** The claim that
Percolator "behaves" between $0.05 and $10 has no basis in the program. There is
no minimum tick and no price-dependent rounding penalty; sub-atom price movement
is explicitly accumulated across slots, and the test suite exercises a price of
`100` e6 — **$0.0001**, 500× below the PRD's floor — tracking its target exactly.

The two constraints that *do* exist:

1. `price_e6 × max_price_move_bps_per_slot ≥ 10_000`, so a per-slot step never
   floors to zero. At kNGN's ~691,000 with a cap of 24 we get 1,658 atoms/slot —
   enormous headroom. The real cliff is around `price_e6 < 417` ($0.0004).
2. Contract notional must clear the absolute atom floors (`min_nonzero_mm_req`
   and friends), which are price-independent.

**Recommendation: keep the units.** They are harmless and they make the quotes
sensible. Just don't treat the $0.05–$10 band as a real engineering limit — it
would wrongly rule out currencies that are perfectly tradable.

---

## 3. Timings

Medians across 110 successful transactions on the public devnet endpoint:

| Operation | n | Median | Min | Max |
|---|---|---|---|---|
| Oracle push (`PushAuthMark`) | 27 | **1,084 ms** | 611 ms | 78,005 ms |
| Keeper crank | 54 | **~1,000 ms** | 733 ms | 40,535 ms |
| Trade (`TradeNoCpi`, open or close) | 7 | **927 ms** | 772 ms | 40,088 ms |
| Create portfolio + init | 4 | 1,361 ms | 1,031 ms | 1,382 ms |
| Deposit | 4 | 1,227 ms | 844 ms | 1,231 ms |
| Create market + vault + `InitMarket` | 2 | — | 882 ms | 35,598 ms |

**The medians are good — about a second. The maxima are the problem**, and they
are entirely the public RPC rather than Percolator. Under congestion the same
operation took 40–80 seconds across retries. See blocker B1.

End-to-end user experience, when the network is healthy: **sign-in to funded
position in well under a minute**, which satisfies the PRD's goal 3.

---

## 4. Failures, with exact errors

Eleven failures. Each is understood.

| Error | n | What it was | Resolution |
|---|---|---|---|
| `custom program error: 0x17` (`EngineNonProgress`) | 5 | The crank had nothing to do | **Normal.** A keeper must treat this as "idle", not failure |
| `block height exceeded` | 2 | RPC congestion; the transaction had **already landed** | Fixed — see below |
| `custom program error: 0x1a` (`OracleInvalid`) | 1 | We pushed a nonsense price, parsed from the wrong byte offset | Fixed — `assetSlotOffset` vs `assetEngineOffset` |
| `custom program error: 0x15` (`EngineLockActive`) | 1 | A retry re-sent a trade that had already opened | Fixed — see below |
| `invalid instruction data` | 1 | Deliberate ABI probe (see §5) | Expected |
| `invalid account data for instruction` | 1 | `mintTo` before the token account existed | Fixed |

**The one that mattered.** A confirmation timeout does *not* mean a transaction
failed — it means we stopped watching. The opening trade in spike 3 landed, the
confirm timed out, our retry fired, and the second attempt returned
`EngineLockActive` against a position that already existed. **On a trade, a blind
retry is a double position.** `send()` now checks `getSignatureStatus` before
retrying; five transactions in later runs were recovered this way rather than
re-sent. The keeper pushes every two minutes on this same network, so the race
was waiting for us there too.

---

## 5. What we found that changes the plan

Five things. All were discovered by reading the real source and running it,
rather than trusting documentation.

### 5.1 The Percolator docs describe a CLI that no longer exists

`percolator-cli`'s `README.md` and `skill.md` document a complete command-line
tool. That tool has been **deleted** — `src/cli.ts`, `src/abi/`, `src/commands/`
are all gone. Every symbol the docs tell you to use (`encodeInitMarket`,
`push-oracle-price`, `buildIx`, `fetchSlab`, `callerIdx: 65535`) has **zero
hits** in the source.

What remains is a 1,642-line encoder/parser library. We vendored it and drive
the program by hand-building instructions, following upstream's own
`tests/v16/devnet-smoke.ts` as the specification.

### 5.2 The program ID is neither of the two in the PRD

The live wrapper is `Bu1J8eQQN…`. The PRD's two IDs are v12-era. **Both are
still executable on devnet**, so an "is it deployed?" check passes on the wrong
program — only cross-referencing the source catches it.

### 5.3 The deployed program is *older* than its own source repo

The vendored TypeScript encodes a 19-byte oracle-push instruction; the Rust at
HEAD decodes a 43-byte one with three extra fields. A working third-party
deployment uses the long form, so two of three sources pointed that way.

Spike 1 probed both against the live program:

```
43-byte wire  ->  invalid instruction data
19-byte wire  ->  accepted
```

**For a deployed program, only the chain is the truth.** Both encoders are kept;
spike 1 re-probes on `--fresh`, so a devnet upgrade is a one-line change.

### 5.4 Leverage is fixed when a market is created

There is **no `UpdateConfig` instruction**. `max_leverage = 10_000 /
initial_margin_bps`, set at `InitMarket` and immutable.

So "5× live, 2× beta" **cannot be a UI setting**. You chose one tier per
currency: live at 5×, beta at 2×. That holds — but any future leverage change
means building a new market and migrating.

### 5.5 Bankruptcy is a different code path from liquidation

Spike 4's first attempt pushed a 25% adverse move at 4.8× and did **not**
liquidate — it drove the account bankrupt (`capital 0.00`, `pnl −1,986`,
`bankruptcy_hlock_active`), and the engine then could not unwind it, returning
`EngineNonProgress` indefinitely.

Two causes, both now fixed:

- **Thresholds.** At L× leverage with 10% maintenance, liquidation needs about
  `(1/L − 0.10)` and bankruptcy arrives at `1/L`. At 4.8× that is ~10.8% and
  ~20.8%. 25% skipped the window entirely.
- **Unwind capacity.** The bankruptcy parameters we had copied from a live
  third-party USDC deployment (1 chunk, 100-slot lifetime) are too small to
  unwind a real bankruptcy. Upstream's own suite uses 16 / 16 / 10,000,000.

**These are immutable after market creation.** Found in Phase 3, every market
would have needed rebuilding. This is the clearest argument for the phase gate.

---

## 6. How the pieces actually behave

Worth knowing before Phase 3 wires the UI to them.

- **A price push alone does nothing.** `PushAuthMark` writes only the oracle
  profile's target. A **crank** propagates it to the engine and walks the
  effective price. There are three distinct price fields; confusing them makes a
  working push look like a silent failure.
- **The circuit breaker only clamps when there is open interest.** With no
  positions the effective price snaps straight to target. With positions, a 14%
  move took **6 cranks**. The cap protects open positions; it does not rate-limit
  the index.
- **Keeper cadence is a risk parameter.** Because the effective price only tracks
  ~2.4% per crank segment, a fast FX move plus a slow keeper equals sustained
  target/effective lag — during which withdrawals and PnL conversion go
  conservative.
- **Liquidation pays the insurance fund.** Spike 4: +20.64 USDC. Value conserved
  exactly — the loser lost 6,741, the winner gained 6,720, insurance took 20.64.
- **AuthMark markets have no trade price discovery.** The engine discards the
  caller's `exec_price` and substitutes its own effective price. Correct for us —
  the index *is* the price — but it means a matcher's job is size and consent only.
- **Never push or crank twice in the same slot.** The per-slot step budget is
  zero, which caused a real production incident upstream.

---

## 7. Blockers and proposed fallbacks

### B1 — The public devnet RPC is not good enough *(needs a decision)*

Pushes intermittently took 40–80 s instead of ~1 s, with `429 Too Many
Requests`, websocket timeouts and expired blockhashes. Spike 6 still achieved
**15/15 intervals (100%)** against F1's 99% target, but that run was lucky;
earlier the same day the same operation failed repeatedly.

**Proposed fallback:** a free Helius devnet key — already in the PRD's budget
(free tier: 1M credits/month, 10 req/s; $49/month only if demo week needs it).
It is a one-line change: `SOLANA_RPC_URL` in `.env`. Mitigations already shipped
(priority fees that escalate per retry, landed-transaction checks, read retries)
keep us running meanwhile.

### B2 — Funding is a manual step

Devnet's airdrop RPC returns `410 Gone`. Scripts print the exact
`solana transfer` command when a wallet is short. Not blocking; worth knowing.

### B3 — Funding rate not yet measured *(deferred deliberately)*

`FUNDING_DEN` lives in an engine crate that is not in any checked-out repo, and
`max_abs_funding_e9_per_slot` is **immutable after creation**. Rather than bake
in a guess, spike 1's market ships with funding **off** — which is what the
reference USDC deployment does too.

**Proposed fallback:** measure it empirically on a throwaway market (~0.022 SOL)
before any market intended for the demo is created. Funding must be settled
before Phase 3 creates the real 13.

### B4 — Two open questions for Phase 3

- **Dead-man switch.** `permissionless_resolve_stale_slots` defaults to off. Turn
  it on and an oracle outage lets *anyone* permanently kill the market, unsigned.
  Leave it off and nothing protects users from our outage. Recommend a generous
  value (48 h ≈ 432,000 slots) plus alerting on `last_good_oracle_slot`.
- **Single-signature trades.** `TradeNoCpi` needs both counterparties to sign,
  which a browser cannot do. Phase 3 needs the **vAMM matcher** (`5ogNxr4u…`,
  `TradeCpi`), where the taker signs alone. That is also what the F10 liquidity
  vaults need. It is the largest unscoped piece of Phase 3.

---

## 8. Recommendation

**Phase 1's gate is met: all checks pass.** Three things should be settled before
Phase 3, none of which blocks Phase 2:

1. Get a free Helius devnet key (B1).
2. Measure the funding rate on a throwaway market and fix the parameter (B3).
3. Scope the matcher work for single-signature trades (B4).

Phase 2 is UI with mock data and touches none of these.

**Awaiting your review and approval before starting Phase 2.**

---

*Full decision history, including the reasoning behind every parameter and the
paths that were tried and rejected, is in `DECISIONS.md` (local, gitignored).*
