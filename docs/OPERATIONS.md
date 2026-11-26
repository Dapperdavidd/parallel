# Operations

What has to be true for Parallel to be trustworthy while it is running, and
what to do when it is not.

Everything here describes a **devnet** service holding test tokens. The
procedures are written as though the money were real, because the point of a
devnet beta is to find out whether we can run it before it is.

## What we promise ourselves

Objectives, not marketing. Each one is measurable from the endpoints below.

| | Objective | Why that number |
| --- | --- | --- |
| Index freshness | A live market's newest tick is under **6 minutes** old, 99% of the time | The keeper's cadence is 2 minutes; 6 allows two consecutive bad passes before anyone is misled |
| Live markets | At least **9 of 13** priced during market hours | Four markets depend on P2P venues that block our egress. Promising 13 would be a promise about somebody else's firewall |
| Push latency | On-chain mark within **0.1%** or **10 minutes** of the index | This is the push rule itself, so a breach means the keeper is not pushing |
| Trade preparation | `/api/trade/prepare` answers under **4s**, 99% of the time | It is two RPC round trips and a signature |
| Readiness | `/api/ready` returns 200 **99.5%** of the month | Below this, trading is not available, which is the only failure a trader experiences directly |

A breach of index freshness or readiness is an incident. A breach of the live-market
count is an incident only if the cause is ours.

## What to watch

| Signal | Where | Alert when |
| --- | --- | --- |
| Readiness | `GET /api/ready` | Non-200 twice in a row, 60s apart |
| Liveness | `GET /api/health` | No response in 30s |
| Index staleness | `/api/markets` → `ageSeconds` | Any `status: "ok"` market over 360 |
| Live count | `/api/ready` → `marketsLive` | Under 8 for 15 minutes |
| Engine drift | `/api/markets` → `basisBps` | Over ±1000 on any market |
| Faucet reserve | The mint authority's SOL balance | Under 1 SOL (≈8 new wallets) |
| Keeper process | Supervisor log | Any restart, or no pass logged in 6 minutes |
| Error rate | `level:"error"` lines | More than 5 a minute |

The log is one JSON object per line on stdout, so any drain will take it
without a parser. Keys worth indexing: `event`, `route`, `requestId`,
`status`, `ms`. Secret-shaped keys are redacted before they are written —
`secret`, `private`, `key`, `token`, `authorization`, `cookie`, `password`,
`mnemonic`, `seed`.

`requestId` is the thread between a user's complaint and the trace: it is in
the `X-Request-Id` header, in the body of any 500, and on every log line for
that request.

### Metrics worth deriving

There is no metrics backend wired up. Everything below is already in the log
lines, which is deliberate — a counter nobody reads is worse than a log line
somebody greps.

- request rate, error rate and p99 `ms`, by `route`
- `event: "rate_limited"` by route — a spike is either abuse or a client bug
- `event: "engine_price_drift"` — the keeper is behind or a source has moved
- `event: "signer_refused"` — **investigate every one**. The signer refusing is
  either a bug in the web app or an attempt to misuse it
- `event: "faucet_funded"` — the devnet spend rate
- `event: "boot_refused"` — a deployment went out missing its configuration

## Running it

### The keeper

```bash
scripts/keeper-supervise.sh          # restarts unless it exits 130
npm run keeper -- --loop --every=120 # or directly
```

It needs the oracle authority keypair and, if you want history, the Supabase
service role key. It does **not** need the web app, and the web app does not
need it to serve — a stale index shows as stale rather than as an outage.

**It currently runs on a laptop under `caffeinate`.** This is the largest open
operational risk in the project. A sleeping laptop is a stale index, and a
stale index is a market that pauses itself — which is the safe failure, but
still an outage. Moving it to a small always-on host is an owner decision and
the only thing on this page that cannot be done from inside the repository.

### The signer

```bash
PARALLEL_SIGNER_SECRET=… npm run signer -- --port=8787
```

Run it on the machine holding the keys, bound to loopback unless you have a
reason. Point the web app at it with `PARALLEL_SIGNER_URL` and the web app
stops holding keys at all. See ARCHITECTURE.md for what it will and will not
sign.

### The web app

```bash
npm run build --prefix web
npm run start --prefix web
```

In production it refuses to start without `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `PARALLEL_APP_SECRET`, an RPC, a Privy app id, and
a way to sign. That refusal is the feature: the alternative is a server that
boots happily and fails every write.

## Deployment notes

1. **Apply the schema first.** `psql "$SUPABASE_DB_URL" -f src/lib/store/schema.sql`,
   or paste it into the SQL editor. It is idempotent.
2. **Set the environment.** `.env.example` lists everything and marks what
   production requires. `PARALLEL_APP_SECRET` wants
   `openssl rand -base64 48`.
3. **Deploy the keeper before the app.** An app with no ticks shows every market
   paused, which is correct and alarming.
4. **Check `/api/ready`** before sending anyone to it. It will tell you which of
   the three dependencies is not there.
5. **Rotating `PARALLEL_APP_SECRET`** invalidates quotes and challenges in
   flight — at most 75 seconds of prepared trades. Safe to do at any time; it
   is not a key to anything persistent.
6. **A GitHub integration follows a repository by id, not by name.** After the
   repository swap, any deploy hook is still watching the old one.

## Backup and recovery

**What cannot be recovered from the chain** is the only thing that needs
backing up: the index history in `index_ticks`, the rolled `candles`, and the
`hedges` intents. Positions, balances and liquidations live on devnet and are
authoritative there.

| | |
| --- | --- |
| Supabase | Daily automatic backups on the project. Verify the retention setting is on; it is off by default on the free tier |
| Manual snapshot | `pg_dump "$SUPABASE_DB_URL" -t index_ticks -t candles -t trades -t hedges -t faucet_claims > parallel-$(date +%F).sql` |
| Keypairs | In `wallets/`, gitignored, **never committed**. There is no backup but the owner's own. Losing a liquidity authority means re-creating that market's vault; losing the oracle authority means re-creating the markets |
| The registry | `market-registry.json` is committed, which is its backup |

### Restoring

- **Index history lost.** `npm run backfill` rebuilds the official-rate series.
  The *street* history cannot be rebuilt — it was a measurement at a moment —
  so the charts simply start from the restore point. Say so rather than
  interpolating.
- **Trade rows lost.** Recoverable from the chain: see reconciliation below.
- **A market account lost or upgraded under us.** `npm run markets:create` and
  `npm run vaults:create` rebuild from the registry. Existing positions on the
  old market are not transferable.

## Reconciliation

A trade can be confirmed on devnet and still fail to reach the `trades` table —
the browser can be closed between the signature and the POST, and the client
already reports `recorded: false` for exactly that case.

The chain is the source of truth, so the gap is closeable:

```bash
npm run reconcile              # report what is missing
npm run reconcile -- --write   # and write it
```

It walks the Percolator signatures touching each registry market, rebuilds the
row from the confirmed instruction bytes, and writes anything absent. Writes
are idempotent on `tx_signature`, so running it twice changes nothing and
running it during normal operation is safe.

Worth running after any incident that interrupted the app, and on a schedule if
the rate of `recorded: false` is ever non-trivial.

## Incident procedure

Small team, so this is short enough to actually follow.

1. **Say what is broken, in the status page's own words.** `/status` reads the
   same endpoints as everything else; if it is green and a trader says
   otherwise, believe the trader and find the gap.
2. **Decide whether to pause.** A market with no healthy index pauses itself,
   which is the correct behaviour and needs no intervention. Pausing by hand is
   for the cases the rules do not cover — a source we no longer trust, an
   engine upgrade, a signer we cannot reach. Stop the keeper pushing before
   stopping anything else: a stale mark that nobody is trading against is
   harmless.
3. **Never close somebody's position for them.** Closes keep working on a
   paused market on purpose.
4. **Fix forward.** The two most likely causes are both named on this page: the
   keeper's host, and a price source that started refusing our egress.
5. **Write it down.** `DECISIONS.md` carries the full account, including what was
   tried and did not work. An incident nobody wrote up happens again.

### Severities

| | | Response |
| --- | --- | --- |
| **1** | Trading is wrong — a mispriced fill, a position on the wrong side, a bad liquidation | Stop the keeper pushing, stop accepting trades, then diagnose. Being down beats being wrong |
| **2** | Trading is unavailable — readiness failing, the signer unreachable, the database down | Fix, and say so on `/status` |
| **3** | A market is stale or paused, the faucet is dry, a source is blocked | Normal hours. The pause is the safety mechanism working |

A severity 1 is the only case where taking the app down is the *first* move
rather than the last.

## The honest list of what is not done

- The keeper is on a laptop (above).
- Rate limiting counts in one process's memory. Fine for one instance; the
  faucet's own cooldown is durable, so the path that moves value does not rely
  on it.
- No alerting is wired up. The signals are all exposed; nothing is paging
  anyone.
- Signing keys are read from disk or the environment. The signer service is the
  architectural step that makes a KMS possible — the keys are behind one
  interface now — but it is not a KMS.
- Four markets (EGP, GHS, KES, PKR) sit on one live source and therefore pause
  themselves. Their P2P venues block our egress. That needs either a different
  venue or an egress that is not this network.
