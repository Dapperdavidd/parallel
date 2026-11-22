-- Parallel — Supabase schema (PRD "Data model").
--
-- On-chain state stays the source of truth for positions, balances and
-- liquidations. This database is a cache and a history: it exists so the
-- charts, the public index page and the traction stats can be served without
-- replaying the chain.
--
-- Apply with:  psql "$SUPABASE_DB_URL" -f src/lib/store/schema.sql
-- or paste into the Supabase SQL editor.

-- ---------------------------------------------------------------- markets --
-- The market registry. Mirrors src/lib/markets.ts, plus the on-chain
-- addresses that only exist once the market has been created on devnet.
create table if not exists markets (
  id            text primary key,              -- 'USD/NGN'
  currency      text not null,                 -- 'NGN'
  symbol        text not null,                 -- 'USD/NGN', kept for the PRD's field name
  unit          integer not null,              -- 1000  (units of local currency per contract)
  unit_label    text not null,                 -- 'kNGN'
  status        text not null
                check (status in ('live', 'beta', 'paused', 'stretch')),
  region        text not null,
  max_leverage  integer not null,
  slab_pubkey   text,                          -- Percolator market account
  vault_pubkey  text,                          -- collateral vault ATA
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- sources --
-- Source configuration per market. Mirrors src/lib/sources.ts so the public
-- index page can describe the method without shipping the code.
create table if not exists sources (
  id          text primary key,                -- 'ngn:quidax'
  market_id   text not null references markets(id) on delete cascade,
  name        text not null,                   -- 'Quidax'
  endpoint    text not null,
  kind        text not null check (kind in ('street', 'official')),
  active      boolean not null default true
);
create index if not exists sources_market_idx on sources (market_id);

-- ------------------------------------------------------------ index_ticks --
-- Every 2-minute calculation, with its per-source breakdown. Feeds the
-- charts and the public index page, and records what was pushed on-chain.
create table if not exists index_ticks (
  id            bigserial primary key,
  market_id     text not null references markets(id) on delete cascade,
  ts            timestamptz not null,
  median        double precision,              -- local currency per USD; null when paused
  unit_price_usd double precision,             -- what Percolator is told
  official      double precision,
  premium       double precision,              -- percent over official
  status        text not null,                 -- ok | paused_few_sources | paused_official_band
  reason        text,
  sources_used  text[] not null default '{}',
  breakdown     jsonb not null default '[]',   -- every reading, including failures
  pushed_tx     text,                          -- signature, when this tick went on-chain
  pushed_slot   bigint
);
create index if not exists index_ticks_market_ts_idx on index_ticks (market_id, ts desc);
-- One row per market per tick: re-running the service must not duplicate history.
create unique index if not exists index_ticks_market_ts_key on index_ticks (market_id, ts);

-- ---------------------------------------------------------------- candles --
-- Pre-rolled OHLC so a chart is one query rather than a reduction over ticks.
create table if not exists candles (
  market_id   text not null references markets(id) on delete cascade,
  timeframe   text not null check (timeframe in ('1H', '4H', '1D', '1W', '1M')),
  open_ts     timestamptz not null,
  open        double precision not null,
  high        double precision not null,
  low         double precision not null,
  close       double precision not null,
  ticks       integer not null default 0,
  primary key (market_id, timeframe, open_ts)
);

-- ------------------------------------------------------------------ users --
create table if not exists users (
  id         bigserial primary key,
  auth_id    text not null unique,             -- Privy DID
  wallet     text not null unique,             -- Solana address
  funded_at  timestamptz,                      -- mock USDC airdropped once
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- trades --
-- Activity feed, portfolio history and traction stats. The chain remains
-- authoritative; this is what makes those screens fast.
create table if not exists trades (
  id            bigserial primary key,
  market_id     text not null references markets(id) on delete cascade,
  wallet        text not null,
  side          text not null check (side in ('long', 'short')),
  action        text not null default 'open' check (action in ('open', 'close', 'liquidation')),
  size_usdc     double precision not null,
  leverage      integer not null,
  price         double precision not null,     -- unit price in USD at execution
  tx_signature  text not null unique,
  ts            timestamptz not null default now()
);
create index if not exists trades_market_ts_idx on trades (market_id, ts desc);
create index if not exists trades_wallet_ts_idx on trades (wallet, ts desc);

-- ----------------------------------------------------------------- hedges --
-- A hedge is an ordinary long position plus the two things that make it a
-- hedge rather than a trade: how much local currency the person is protecting,
-- and the date they need it by. The position itself lives in `trades`; these
-- rows only carry the intent. `tx_signature` is the link, and it is unique, so
-- recording the same hedge twice is a no-op rather than a duplicate.
create table if not exists hedges (
  id           bigserial primary key,
  wallet       text not null,
  market_id    text not null references markets(id) on delete cascade,
  amount_local double precision not null,
  amount_usd   double precision not null,
  due_date     date not null,
  tx_signature text not null unique,
  created_at   timestamptz not null default now()
);
create index if not exists hedges_wallet_idx on hedges (wallet);

-- ------------------------------------------------------------------- RLS --
-- Everything here is public information — published prices and on-chain
-- trades. Reads are open; writes belong to the service role only, which
-- bypasses RLS, so no write policy is granted to anon.
alter table markets     enable row level security;
alter table sources     enable row level security;
alter table index_ticks enable row level security;
alter table candles     enable row level security;
alter table trades      enable row level security;
alter table hedges      enable row level security;
alter table users       enable row level security;

-- New Supabase projects can be created with automatic Data API grants
-- disabled. RLS policies do not grant SQL privileges by themselves, so make
-- the intended boundary explicit: anonymous/authenticated clients may read
-- only public market data, while the server-only secret role owns all writes.
grant usage on schema public to anon, authenticated, service_role;
grant select on markets, sources, index_ticks, candles, trades
  to anon, authenticated;
grant all privileges on markets, sources, index_ticks, candles, trades, hedges, users
  to service_role;
grant usage, select on all sequences in schema public to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'markets' and policyname = 'public read') then
    create policy "public read" on markets     for select using (true);
    create policy "public read" on sources     for select using (true);
    create policy "public read" on index_ticks for select using (true);
    create policy "public read" on candles     for select using (true);
    create policy "public read" on trades      for select using (true);
  end if;
end $$;

-- `users` and `hedges` hold a person's own activity: no anon read policy, so
-- they are reachable only through the service role.
