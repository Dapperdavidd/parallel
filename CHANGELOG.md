# Changelog

Dates are the day the work landed. Devnet throughout — there is no released
version, because there is nothing to release until there is a mainnet, and
inventing a `1.0.0` would say otherwise.

Notable entries say what was *wrong*, not only what changed, because the
interesting part of a fix is usually the mistake.

## Unreleased — devnet beta

### 2026-11-26 — remediating the codebase audit

**Security.** The API is guarded. Each route now shares one wrapper: a per-caller
ceiling, a same-origin rule for writes, a body read that counts bytes as they
arrive rather than after parsing, declarative field validation, and one funnel
that turns anything thrown into either the caller's own mistake or a generic
500 with a reference that leads to the trace.

- The faucet was an open mint: it minted test funds to any address in a POST
  body, from any origin, as often as asked — a free top-up for every wallet on
  devnet and a way to drain the mint authority's SOL. It now requires a
  signature from the wallet being funded over a server-issued challenge, plus a
  cooldown recorded in the store so it survives a restart.
- Trade history recorded the leverage the browser claimed. Prepared trades now
  come back with a signed quote holding the server's own arithmetic, and a row
  is written only when that quote and the confirmed transaction agree on size,
  price, side and accounts.
- Signing keys lived in the request handler, defaulting to the repository's
  `wallets/` folder. There is now one module that can obtain a key, and a
  separate signer service so the web app need not hold one at all — it will
  sign only a Percolator trade against a registry market, with the authority
  neither fee payer nor writable.
- Raw errors went to the caller: Supabase permission messages, wallet file
  paths. Those now go to the log, with a request id the caller also receives.
- Production declares what it requires and the process refuses to boot without
  it, instead of starting and failing every write.
- Slippage and price-impact protection on every prepared trade.
- The engine's effective price is cross-checked against our own index before
  any trade, since the account offsets have no version to verify and a shifted
  field would otherwise be traded on.
- Dependency advisories: 23 → 3 in the app, 9 → 3 in the services. The three
  remaining are one advisory with no upstream fix, reachable only through a
  native binding this project never loads.

**Correctness.**

- A wallet's trade history was read by fetching the most recent 200 trades
  across every wallet and filtering afterwards, so somebody whose last trade
  was 200 trades ago saw nothing. Now filtered in the query, paged by cursor.
- The liquidation estimate had the side backwards: it showed a long being
  liquidated in the direction it profits. The second time this class of bug has
  appeared, so the tests now derive the direction from `pnlSign` rather than
  restating it.
- An unknown market code rendered as the naira — `/app/trade?m=XYZ` showed
  "Nigerian naira" with naira prices. Unknown codes now say so.
- Mark and index were the same number under two labels, while the tooltip
  promised one was the engine's effective price. It now is, read from the
  chain, which also gives the basis and the real open interest.

**Honesty about data.** Measured, sample and stale figures rendered
identically, so invented volume read as though somebody had traded and a
paused market's sample price from the day the mock file was written read as
live. Every figure now says which it is, with a freshness pill carrying the
measurement's age and how many sources answered. A 24-hour change with less
than a day of history shows a dash.

- The landing page promised 10,000 test dollars beside a faucet that gives
  5,000, in two places.
- "Mainnet coming soon" was a promise with no date, contradicting the FAQ two
  clicks away.
- Landing illustrations are labelled as illustrations, so a made-up balance
  cannot read as a claim about somebody's returns.

**Trading.** The ticket asks the server what a trade would cost rather than
pricing itself, and shows the fill price, the gap to the index, where
liquidation lands and how full that side of the market is. Trade progress is
reported stage by stage with an explorer link and a retry. Order settings cover
whether to review before sending and the slippage tolerance. The disabled
Limit and Trigger tabs say why on their face.

**The portfolio.** Each open position carries its cost basis from the verified
history, its own unrealised P&L and return, its margin ratio, and how far the
price can move before the margin is gone. The realised curve has period
windows. The whole account exports as a CSV statement.

**Markets.** Filters, sortable columns, a star that keeps a market at the top,
a source-health column, and the reason a market is paused written out beside
the row rather than hidden in a tooltip.

**Engineering.** Seventy-odd tests on Node's own runner; a flat ESLint config
covering both packages, replacing a `next lint` that stopped to ask an
interactive question and so never ran; CI running lint, both typechecks, both
suites and the build with no secrets; an end-to-end API smoke script; health
and readiness endpoints; one line of JSON per log event with secrets redacted;
a reconciliation job that rebuilds missing trade rows from the chain.

**Documentation.** A README that describes what is here rather than Phase 1,
an architecture document, a full HTTP API reference with limits and errors, an
operations runbook with objectives and an incident procedure, and this file.

### 2026-11-25
- The trading terminal reads as a familiar perps terminal, and knows about the
  vault standing behind each market.

### 2026-11-24
- Chart drawing tools: trend lines, rays, rectangles, horizontal and vertical
  lines, Fibonacci retracement, a measure tool, and long/short position boxes.
- Pan and zoom rebuilt. Three separate defects: logical-range zoom drifted
  about 30px a notch because logical ranges address bar centres while the range
  is measured at pane edges; `options().barSpacing` is the *configured* value,
  not the live one, so the arithmetic was computing from 9 while the chart sat
  at 1.3; and a burst of wheel events in one frame overwrote each other.
- The trade header stopped falling apart on a phone. The cause was not the
  stats: `.thead` inherited `flex-wrap: wrap`, and a wrapping column flex
  container sizes columns to content.
- The index stopped dying when a socket did. An unhandled `ECONNRESET` killed
  the keeper and the whole index went stale for hours.

### 2026-11-23
- Every timeframe has real candles, built from the published official rates for
  the span before the index existed, and labelled as a different quantity from
  the street median.
- Server-side database access uses the service role. The anon key silently
  refused every write and every hedge read, which looked like an empty
  database rather than a permissions failure.

### 2026-11-22
- Position direction corrected: a long must gain when the local currency falls.
  Confirmed on-chain rather than reasoned about.
- Balances, positions and chart markers read confirmed chain state. The local
  position model is gone, along with the "close the on-chain position anyway"
  button that existed because a local row could vanish while the leg was open.
- Verified trade history: a row is stored only after the server matches the
  signature against the confirmed instruction.
- Hedges open through the same guarded path as any trade, and store the intent
  the trade cannot carry.
- Liquidity vault state is published, because there is no order book to publish.

### 2026-11-21
- All thirteen markets live on devnet, with the keeper pushing on the PRD's
  rule: a 0.1% move or ten minutes.
- The index service, its store, and the public index page that shows every
  source reading including the ones that failed.

### 2026-11-20 and before
- Phase 2: every screen, against one mock file.
- Phase 1: the feasibility spikes. The engine, the oracle push, trading,
  liquidation and the index, each proven on devnet rather than argued.
  See `PHASE-1-REPORT.md` for the signatures.
