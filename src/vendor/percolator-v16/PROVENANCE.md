# Vendored: Percolator v16 client library

These files are copied **verbatim** from the upstream Percolator CLI repo.

| | |
|---|---|
| Source | https://github.com/aeyakovenko/percolator-cli |
| Path in source | `src/v16/` |
| Commit | `7f90047` — "Devnet bumped to HEAD 1357dc3 / engine 500ebee9 (BPF b3bd523d)" |
| Vendored on | 2026-11-20 |
| License | Apache-2.0 (see upstream `LICENSE`) |

## Why these are vendored rather than installed

The upstream package is **not published to npm**. Its `package.json` declares
`"main": "./dist/index.js"`, which does not exist in the repo, and its build is
configured with `dts: false`, so even a local build emits no type declarations.
Importing the source directly is what every script and test in the upstream repo
itself does. Vendoring keeps Parallel reproducible: `reference/` is a throwaway
clone and is gitignored, so the repo must carry its own copy.

## What this library actually is

A pure encoder/parser library — **no CLI, no account-meta helpers, no network
code**. It gives you:

- `instructions.ts` — `enc*` functions returning a bare instruction-data `Buffer`.
  You build every `keys: []` array by hand.
- `parsers.ts` — `parseHeader`, `parseWrapperConfig`, `parseMarketGroup`,
  `parseAsset`, `parseAssetOracleProfile`, `parsePortfolio`, `parseLeg`.
- `constants.ts` — account-layout offsets and sizes.
- `discover.ts` — `discoverMarkets` / `discoverPortfolios`.

## Warnings that cost real time to rediscover

1. **The upstream `README.md` and `skill.md` describe a CLI that no longer
   exists.** `src/cli.ts`, `src/abi/`, `src/commands/` and `src/solana/slab.ts`
   were all deleted. Names like `encodeInitMarket`, `encodePushOraclePrice`,
   `ACCOUNTS_*`, `buildIx`, `fetchSlab` and `callerIdx: 65535` appear *only* in
   that stale prose. Do not follow those documents.

2. **These constants are pinned to one exact program build** (`percolator-prog`
   HEAD `70294cb`, engine `051e268`). If devnet is redeployed under us, every
   offset here must be regenerated. `parseMarketGroup` exposes `assetSlotCapacity`
   specifically so a layout drift can be asserted — check it before trusting any
   parse.

3. **Prose inside these files contradicts the code in places.** Always compute
   sizes from `marketAccountLenFor()` and `PORTFOLIO_ACCOUNT_LEN`, never from a
   comment.

4. **Some exported aliases are traps** — `encWithdrawInsuranceLimited`,
   `encUpdateInsurancePolicy`, `encWithdrawInsuranceDomain` and
   `encRestartAsset0Oracle` encode removed or different wire formats and will
   fail on-chain. Live, same-wire aliases: `encConfigureHyperpMark` and
   `encPushHyperpMark`.

## Local modifications

**None.** These files are byte-identical to upstream. Parallel's own wrapper
around them lives in `src/lib/percolator.ts` — put all adaptation there, so this
directory stays a clean diff against upstream and can be re-synced.
