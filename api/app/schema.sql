-- MochaGuard schema. Applied by `python scripts/migrate.py`. Idempotent.
-- RLS is ON for every table; FastAPI connects with the service role (bypasses RLS);
-- Next.js never touches the database directly.

create extension if not exists pgcrypto;

create table if not exists symbols (
  symbol      text primary key,
  name        text,
  asset_type  text not null default 'equity',   -- equity | etf
  exchange    text,
  active      boolean not null default true,
  added_at    timestamptz not null default now()
);

create table if not exists bars_daily (
  symbol      text not null references symbols on delete cascade,
  d           date not null,
  open        double precision,
  high        double precision,
  low         double precision,
  close       double precision,
  adj_close   double precision,
  volume      double precision,
  split_coef  double precision not null default 1.0,
  dividend    double precision not null default 0.0,
  primary key (symbol, d)
);

create table if not exists bars_intraday (
  symbol      text not null references symbols on delete cascade,
  ts          timestamptz not null,
  open        double precision,
  high        double precision,
  low         double precision,
  close       double precision,
  volume      double precision,
  source      text not null default 'alpha_vantage',
  primary key (symbol, ts)
);
create index if not exists bars_intraday_ts_idx on bars_intraday (ts);

create table if not exists earnings (
  symbol            text not null references symbols on delete cascade,
  report_date       date not null,
  timing            text,                         -- 'amc' | 'bmo' | null (unknown => treated as bmo)
  fiscal_period_end date,
  estimate          double precision,
  primary key (symbol, report_date)
);

create table if not exists corporate_actions (
  id              bigserial primary key,
  symbol          text not null references symbols on delete cascade,
  effective_date  date not null,
  kind            text not null,                 -- 'split' | 'dividend'
  ratio           double precision,
  unique (symbol, effective_date, kind)
);

create table if not exists halts (
  id          bigserial primary key,
  symbol      text not null references symbols on delete cascade,
  started_at  timestamptz not null,
  ended_at    timestamptz,
  reason      text,
  source      text not null default 'inferred'   -- 'inferred' from tape gaps, or a real feed
);
alter table halts add column if not exists source text not null default 'inferred';
create unique index if not exists halts_symbol_start_idx on halts (symbol, started_at);

-- Sector peers that trade while the US market is shut (TSMC, SK Hynix, ASML, Nifty ...).
-- Stores the *last completed* session move per peer, so overnight leverage can react to a
-- sector selloff that has already happened somewhere else.
create table if not exists sector_moves (
  ticker      text not null,
  session_d   date not null,                  -- the peer's own session date
  close_price double precision,
  prev_close  double precision,
  move        double precision,               -- close/prev_close - 1
  observed_at timestamptz not null default now(),
  primary key (ticker, session_d)
);
create index if not exists sector_moves_d_idx on sector_moves (session_d desc);

create table if not exists symbol_risk (
  symbol            text primary key references symbols on delete cascade,
  as_of             date not null,
  gap_p50           double precision,
  gap_p99           double precision,
  intraday_p99      double precision,
  earnings_gap_p99  double precision,
  adv_dollar        double precision,
  adv_shares        double precision,
  last_close        double precision,
  n_days            int,
  n_earnings        int,
  computed_at       timestamptz not null default now()
);

create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  display_name  text,
  tz            text not null default 'UTC',
  cash          double precision not null default 0,
  auth_user_id  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists accounts_auth_user_id_key on accounts (auth_user_id) where auth_user_id is not null;

create table if not exists positions (
  account_id  uuid not null references accounts on delete cascade,
  symbol      text not null references symbols,
  qty         double precision not null,
  avg_price   double precision,
  updated_at  timestamptz not null default now(),
  primary key (account_id, symbol)
);

create table if not exists risk_decisions (
  id               bigserial primary key,
  ts               timestamptz not null,
  account_id       uuid,
  symbol           text,
  action           text not null,                -- freeze | reduce | margin_call | close
  max_leverage     double precision,
  adverse_move     double precision,
  equity           double precision,
  margin_required  double precision,
  qty_to_reduce    double precision,
  reason           text,
  run_id           text not null default '',     -- '' = live; otherwise a replay run id
  created_at       timestamptz not null default now()
);
create index if not exists risk_decisions_ts_idx on risk_decisions (ts);
create index if not exists risk_decisions_acct_idx on risk_decisions (account_id, ts);
create index if not exists risk_decisions_run_idx on risk_decisions (run_id, ts);

create table if not exists liquidations (
  id            bigserial primary key,
  decision_id   bigint references risk_decisions,
  ts            timestamptz not null,
  account_id    uuid,
  symbol        text,
  qty           double precision,
  ref_price     double precision,
  fill_price    double precision,
  slippage_bps  double precision,
  minutes       int,
  proceeds      double precision,
  kind          text,                            -- auto_derisk | open_unwind
  run_id        text not null default ''
);

create table if not exists book_snapshots (
  id          bigserial primary key,
  ts          timestamptz not null,
  phase       text,
  summary     jsonb not null,
  run_id      text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists book_snapshots_ts_idx on book_snapshots (ts desc);

-- AI copilot output: one row per user-facing explanation
create table if not exists decision_explanations (
  id           bigserial primary key,
  decision_id  bigint references risk_decisions,
  account_id   uuid,
  ts           timestamptz not null,
  audience     text not null,                    -- 'user' | 'ops'
  headline     text,
  body         text,
  action_hint  text,
  model        text,                             -- llm model id or 'template'
  created_at   timestamptz not null default now()
);
create index if not exists decision_explanations_acct_idx on decision_explanations (account_id, ts desc);
create index if not exists decision_explanations_decision_idx on decision_explanations (decision_id);

-- On-chain anchoring
create table if not exists anchor_batches (
  id                 bigserial primary key,
  batch_date         date not null,
  run_id             text not null default '',
  merkle_root        text not null,              -- 0x-prefixed bytes32 hex
  decision_count     int not null,
  first_decision_id  bigint,
  last_decision_id   bigint,
  tx_hash            text,                       -- sepolia tx, null until sent
  contract_address   text,
  chain_id           int,
  anchored_at        timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  unique (batch_date, run_id)
);

-- per-decision proof material (leaf hash + sibling path)
create table if not exists decision_proofs (
  decision_id  bigint primary key references risk_decisions,
  batch_id     bigint not null references anchor_batches on delete cascade,
  leaf_hash    text not null,
  merkle_path  jsonb not null
);

create table if not exists replay_runs (
  run_id        text primary key,
  session_date  date not null,
  summary       jsonb not null,
  events        jsonb not null,
  series        jsonb not null,                  -- per-symbol {ts[], price[], max_leverage[], phase[], ramp[], frozen[]}
  created_at    timestamptz not null default now()
);
create index if not exists replay_runs_date_idx on replay_runs (session_date desc);

create table if not exists av_usage (
  d      date primary key,
  calls  int not null default 0
);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Wallet integration
alter table symbols add column if not exists chain text;
alter table symbols add column if not exists contract_address text;

create table if not exists wallet_connections (
  id             bigserial primary key,
  account_id     uuid not null references accounts on delete cascade,
  wallet_address text not null,
  chain_id       int not null default 1,
  label          text,
  connected_at   timestamptz not null default now(),
  last_synced    timestamptz,
  unique (account_id, wallet_address, chain_id)
);
alter table wallet_connections enable row level security;
