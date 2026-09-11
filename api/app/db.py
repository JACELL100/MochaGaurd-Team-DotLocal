'''asyncpg access layer. Every query in the system lives here.

Connects to the Supabase transaction pooler (port 6543), so prepared statements are disabled
(``statement_cache_size=0``). Nothing in ``engine/`` or ``state.py`` imports this module:
the evaluate loop makes zero database calls.
'''
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None
SCHEMA_PATH = Path(__file__).with_name('schema.sql')


async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    await conn.set_type_codec('json', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')


async def init() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not settings.db_configured:
            raise RuntimeError('DATABASE_URL is missing or still contains template placeholders')
        _pool = await asyncpg.create_pool(
            settings.database_url, min_size=1, max_size=8, statement_cache_size=0,
            command_timeout=60, init=_init_conn,
        )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError('database not initialised; call db.init() first')
    return _pool


async def migrate() -> None:
    sql = SCHEMA_PATH.read_text(encoding='utf-8')
    async with pool().acquire() as conn:
        await conn.execute(sql)


def _ts(value) -> datetime:
    """Accept an ISO string or a datetime. Engine payloads are JSON-shaped, asyncpg is not."""
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value


def _uuid(v: str | uuid.UUID | None) -> uuid.UUID | None:
    if v is None:
        return None
    return v if isinstance(v, uuid.UUID) else uuid.UUID(str(v))


# ============================================================================ market data

async def upsert_symbols(rows: list[dict]) -> None:
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into symbols (symbol, name, asset_type, exchange, active)
               values ($1, $2, $3, $4, true)
               on conflict (symbol) do update set name = coalesce(excluded.name, symbols.name),
                   asset_type = excluded.asset_type, exchange = coalesce(excluded.exchange, symbols.exchange),
                   active = true''',
            [(r['symbol'], r.get('name'), r.get('asset_type', 'equity'), r.get('exchange')) for r in rows])


async def list_symbols(active_only: bool = True) -> list[str]:
    q = 'select symbol from symbols' + (' where active' if active_only else '') + ' order by symbol'
    return [r['symbol'] for r in await pool().fetch(q)]


async def upsert_bars_daily(symbol: str, bars: list[dict]) -> int:
    if not bars:
        return 0
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into bars_daily (symbol, d, open, high, low, close, adj_close, volume, split_coef, dividend)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               on conflict (symbol, d) do update set open = excluded.open, high = excluded.high, low = excluded.low,
                   close = excluded.close, adj_close = excluded.adj_close, volume = excluded.volume,
                   split_coef = excluded.split_coef, dividend = excluded.dividend''',
            [(symbol, b['d'], b['open'], b['high'], b['low'], b['close'], b['adj_close'], b['volume'],
              b.get('split_coef', 1.0), b.get('dividend', 0.0)) for b in bars])
    return len(bars)


async def latest_daily_date(symbol: str) -> date | None:
    return await pool().fetchval('select max(d) from bars_daily where symbol = $1', symbol)


async def upsert_bars_intraday(symbol: str, bars: list[dict], source: str = 'alpha_vantage') -> int:
    if not bars:
        return 0
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into bars_intraday (symbol, ts, open, high, low, close, volume, source)
               values ($1, $2, $3, $4, $5, $6, $7, $8)
               on conflict (symbol, ts) do update set open = excluded.open, high = excluded.high, low = excluded.low,
                   close = excluded.close, volume = excluded.volume, source = excluded.source''',
            [(symbol, b['ts'], b.get('open'), b.get('high'), b.get('low'), b['close'], b.get('volume'), source)
             for b in bars])
    return len(bars)


async def intraday_between(start: datetime, end: datetime, symbols: list[str] | None = None) -> dict[str, list[asyncpg.Record]]:
    if symbols is None:
        rows = await pool().fetch(
            'select symbol, ts, close, volume from bars_intraday where ts >= $1 and ts < $2 order by symbol, ts', start, end)
    else:
        rows = await pool().fetch(
            '''select symbol, ts, close, volume from bars_intraday
               where ts >= $1 and ts < $2 and symbol = any($3::text[]) order by symbol, ts''', start, end, symbols)
    out: dict[str, list] = {}
    for r in rows:
        out.setdefault(r['symbol'], []).append(r)
    return out


async def upsert_halts(rows: list[dict]) -> int:
    """Record trading halts. Idempotent on (symbol, started_at)."""
    if not rows:
        return 0
    async with pool().acquire() as conn:
        await conn.executemany(
            """insert into halts (symbol, started_at, ended_at, reason, source)
               values ($1, $2, $3, $4, $5)
               on conflict (symbol, started_at) do update
                   set ended_at = excluded.ended_at, reason = excluded.reason""",
            [(r['symbol'], _ts(r['started_at']),
              _ts(r['ended_at']) if r.get('ended_at') else None,
              r.get('reason'), r.get('source', 'inferred')) for r in rows])
    return len(rows)


async def halt_count() -> int:
    return await pool().fetchval('select count(*) from halts') or 0


async def upsert_sector_moves(rows: list[dict]) -> int:
    """Record the last completed session move for each foreign sector peer."""
    if not rows:
        return 0
    async with pool().acquire() as conn:
        await conn.executemany(
            """insert into sector_moves (ticker, session_d, close_price, prev_close, move)
               values ($1, $2, $3, $4, $5)
               on conflict (ticker, session_d) do update
                   set close_price = excluded.close_price, prev_close = excluded.prev_close,
                       move = excluded.move, observed_at = now()""",
            [(r['ticker'], r['session_d'], r.get('close_price'), r.get('prev_close'), r.get('move'))
             for r in rows])
    return len(rows)


async def latest_sector_moves(tickers: list[str], on_or_before: date) -> dict[str, dict]:
    """Most recent completed session per peer, at or before ``on_or_before``.

    Bounded by date so a replay of an old session cannot see a move that had not happened yet.
    """
    if not tickers:
        return {}
    rows = await pool().fetch(
        """select distinct on (ticker) ticker, session_d, close_price, prev_close, move
           from sector_moves
           where ticker = any($1::text[]) and session_d <= $2
           order by ticker, session_d desc""", tickers, on_or_before)
    return {r['ticker']: dict(r) for r in rows}


async def latest_daily_date_any() -> date | None:
    """Most recent session that has a *following* session stored.

    A replay needs the next open to score its gap, so the newest bar in the table is not a
    usable session date -- the one before it is.
    """
    return await pool().fetchval(
        """select d from (select distinct d from bars_daily order by d desc limit 2) t
           order by d asc limit 1""")


async def next_open_prices(symbols: list[str], after: date) -> dict[str, float]:
    """Split-adjusted opening price of the first session strictly after ``after``, per symbol.

    Used only to score a replay once its decisions are made. Adjusted so a split between the
    two sessions cannot masquerade as an overnight gap.
    """
    rows = await pool().fetch(
        """select distinct on (symbol) symbol, open, close, adj_close
           from bars_daily
           where symbol = any($1::text[]) and d > $2 and open is not null
           order by symbol, d asc""", symbols, after)
    out: dict[str, float] = {}
    for r in rows:
        close, adj = r['close'], r['adj_close']
        factor = (float(adj) / float(close)) if (close and adj and float(close) > 0) else 1.0
        out[r['symbol']] = float(r['open']) * factor
    return out


async def intraday_all(symbol: str, as_of: date | None = None) -> list[asyncpg.Record]:
    '''Every stored intraday print for one symbol, oldest first.

    ``as_of`` clips the series to bars the engine could already have seen, so recomputing a
    historical risk profile never uses a price from after that date (no look-ahead).
    '''
    if as_of is None:
        return await pool().fetch(
            'select ts, close, volume from bars_intraday where symbol = $1 order by ts', symbol)
    return await pool().fetch(
        '''select ts, close, volume from bars_intraday
           where symbol = $1 and ts < (($2::date + 1)::timestamp at time zone 'America/New_York')
           order by ts''', symbol, as_of)


async def intraday_count() -> int:
    return await pool().fetchval('select count(*) from bars_intraday') or 0


async def upsert_earnings(symbol: str, rows: list[dict]) -> None:
    if not rows:
        return
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into earnings (symbol, report_date, timing, fiscal_period_end, estimate)
               values ($1, $2, $3, $4, $5)
               on conflict (symbol, report_date) do update set timing = coalesce(excluded.timing, earnings.timing),
                   fiscal_period_end = coalesce(excluded.fiscal_period_end, earnings.fiscal_period_end),
                   estimate = coalesce(excluded.estimate, earnings.estimate)''',
            [(symbol, r['report_date'], r.get('timing'), r.get('fiscal_period_end'), r.get('estimate')) for r in rows])


async def upsert_corporate_actions(symbol: str, rows: list[dict]) -> None:
    if not rows:
        return
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into corporate_actions (symbol, effective_date, kind, ratio) values ($1, $2, $3, $4)
               on conflict (symbol, effective_date, kind) do update set ratio = excluded.ratio''',
            [(symbol, r['effective_date'], r['kind'], r.get('ratio')) for r in rows])


async def upsert_symbol_risk(rows: list[dict]) -> None:
    if not rows:
        return
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into symbol_risk (symbol, as_of, gap_p50, gap_p99, intraday_p99, earnings_gap_p99,
                                        adv_dollar, adv_shares, last_close, n_days, n_earnings, computed_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
               on conflict (symbol) do update set as_of = excluded.as_of, gap_p50 = excluded.gap_p50,
                   gap_p99 = excluded.gap_p99, intraday_p99 = excluded.intraday_p99,
                   earnings_gap_p99 = excluded.earnings_gap_p99, adv_dollar = excluded.adv_dollar,
                   adv_shares = excluded.adv_shares, last_close = excluded.last_close, n_days = excluded.n_days,
                   n_earnings = excluded.n_earnings, computed_at = now()''',
            [(r['symbol'], r['as_of'], r['gap_p50'], r['gap_p99'], r['intraday_p99'], r['earnings_gap_p99'],
              r['adv_dollar'], r['adv_shares'], r['last_close'], r['n_days'], r['n_earnings']) for r in rows])


async def daily_bars(symbol: str) -> list[asyncpg.Record]:
    return await pool().fetch(
        'select d, open, high, low, close, adj_close, volume, split_coef from bars_daily where symbol = $1 order by d',
        symbol)


async def earnings_for(symbol: str) -> list[asyncpg.Record]:
    return await pool().fetch('select report_date, timing from earnings where symbol = $1 order by report_date', symbol)


async def load_book_payload() -> dict[str, Any]:
    '''Everything state.BookState needs, in one round of queries.'''
    async with pool().acquire() as conn:
        symbols = [r['symbol'] for r in await conn.fetch('select symbol from symbols where active order by symbol')]
        risk = {r['symbol']: dict(r) for r in await conn.fetch('select * from symbol_risk')}
        accounts = [dict(r) for r in await conn.fetch(
            'select id, email, display_name, tz, cash from accounts order by created_at')]
        positions = [dict(r) for r in await conn.fetch(
            'select account_id, symbol, qty, avg_price from positions where qty <> 0')]
        earnings = await conn.fetch(
            'select symbol, report_date, timing from earnings where report_date >= current_date - 400')
        splits = await conn.fetch(
            "select symbol, effective_date from corporate_actions where kind = 'split'")
        halts = await conn.fetch('select symbol, started_at, ended_at from halts')
        daily = await conn.fetch(
            'select symbol, d, open, close, adj_close, volume from bars_daily order by symbol, d')
    return {'symbols': symbols, 'risk': risk, 'accounts': accounts, 'positions': positions,
            'earnings': earnings, 'splits': splits, 'halts': halts, 'daily': daily}


async def av_calls_today(d: date) -> int:
    return await pool().fetchval('select calls from av_usage where d = $1', d) or 0


async def av_bump(d: date) -> None:
    await pool().execute(
        'insert into av_usage (d, calls) values ($1, 1) on conflict (d) do update set calls = av_usage.calls + 1', d)


# ============================================================================ accounts

async def ensure_account(email: str, display_name: str | None, tz: str | None, auth_user_id: str | None) -> dict:
    row = await pool().fetchrow(
        '''insert into accounts (email, display_name, tz, auth_user_id)
           values ($1, $2, coalesce($3, 'UTC'), $4)
           on conflict (email) do update set
               display_name = coalesce(excluded.display_name, accounts.display_name),
               tz = coalesce($3, accounts.tz),
               auth_user_id = coalesce(excluded.auth_user_id, accounts.auth_user_id),
               updated_at = now()
           returning id, email, display_name, tz, cash''',
        email.lower(), display_name, tz, _uuid(auth_user_id))
    return dict(row)


async def get_account(account_id: str) -> dict | None:
    row = await pool().fetchrow('select id, email, display_name, tz, cash from accounts where id = $1', _uuid(account_id))
    return dict(row) if row else None


async def get_account_by_auth_user(auth_user_id: str) -> dict | None:
    row = await pool().fetchrow(
        'select id, email, display_name, tz, cash, auth_user_id from accounts where auth_user_id = $1',
        _uuid(auth_user_id))
    return dict(row) if row else None


async def list_accounts() -> list[dict]:
    rows = await pool().fetch(
        'select id, email, display_name, tz, cash, auth_user_id from accounts order by created_at')
    return [dict(row) for row in rows]


async def update_account(account_id: str, *, cash: float | None = None, tz: str | None = None,
                         display_name: str | None = None) -> None:
    await pool().execute(
        '''update accounts set cash = coalesce($2, cash), tz = coalesce($3, tz),
               display_name = coalesce($4, display_name), updated_at = now() where id = $1''',
        _uuid(account_id), cash, tz, display_name)


async def replace_positions(account_id: str, positions: list[dict]) -> None:
    aid = _uuid(account_id)
    async with pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute('delete from positions where account_id = $1', aid)
            rows = [(aid, p['symbol'].upper(), float(p['qty']), p.get('avg_price')) for p in positions if float(p['qty']) != 0]
            if rows:
                await conn.executemany(
                    'insert into positions (account_id, symbol, qty, avg_price) values ($1, $2, $3, $4)', rows)


# ============================================================================ decisions

async def log_decisions(decisions: list[dict], run_id: str = '') -> list[int]:
    '''Bulk insert, returns ids in input order. Called fire-and-forget from the live path.'''
    if not decisions:
        return []
    cols = [[] for _ in range(11)]
    for d in decisions:
        ts = d['ts']
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        vals = (ts, _uuid(d.get('account_id')), d.get('symbol'), d['action'], d.get('max_leverage'),
                d.get('adverse_move'), d.get('equity'), d.get('margin_required'), d.get('qty_to_reduce'),
                d.get('reason'), run_id)
        for c, v in zip(cols, vals):
            c.append(v)
    rows = await pool().fetch(
        '''insert into risk_decisions (ts, account_id, symbol, action, max_leverage, adverse_move, equity,
                                       margin_required, qty_to_reduce, reason, run_id)
           select * from unnest($1::timestamptz[], $2::uuid[], $3::text[], $4::text[], $5::float8[], $6::float8[],
                                $7::float8[], $8::float8[], $9::float8[], $10::text[], $11::text[])
           returning id''', *cols)
    return [r['id'] for r in rows]


async def get_decision(decision_id: int) -> dict | None:
    row = await pool().fetchrow('select * from risk_decisions where id = $1', decision_id)
    return dict(row) if row else None


async def decisions_for_day(batch_date: date, run_id: str = '') -> list[dict]:
    '''All decisions whose ET session date is ``batch_date`` (ordered by id: the Merkle leaf order).'''
    rows = await pool().fetch(
        '''select * from risk_decisions
           where run_id = $2 and (ts at time zone 'America/New_York')::date = $1
           order by id''', batch_date, run_id)
    return [dict(r) for r in rows]


async def recent_decisions(since: datetime, account_id: str | None = None, run_id: str = '') -> list[dict]:
    if account_id:
        rows = await pool().fetch(
            'select * from risk_decisions where ts >= $1 and account_id = $2 and run_id = $3 order by id desc',
            since, _uuid(account_id), run_id)
    else:
        rows = await pool().fetch(
            'select * from risk_decisions where ts >= $1 and run_id = $2 order by id desc limit 500', since, run_id)
    return [dict(r) for r in rows]


async def insert_liquidations(fills: list[dict], run_id: str = '') -> None:
    if not fills:
        return
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into liquidations (decision_id, ts, account_id, symbol, qty, ref_price, fill_price, slippage_bps,
                                         minutes, proceeds, kind, run_id)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)''',
            [(f.get('decision_id'), _ts(f['ts']), _uuid(f.get('account_id')), f['symbol'], f['qty'],
              f['ref_price'], f['fill_price'], f['slippage_bps'], f.get('minutes'), f.get('proceeds'),
              f.get('kind'), run_id) for f in fills])


async def insert_snapshot(ts: datetime, phase: str, summary: dict, run_id: str = '') -> None:
    await pool().execute('insert into book_snapshots (ts, phase, summary, run_id) values ($1, $2, $3, $4)',
                         ts, phase, summary, run_id)


async def latest_snapshot(run_id: str = '') -> dict | None:
    row = await pool().fetchrow(
        'select ts, phase, summary from book_snapshots where run_id = $1 order by ts desc limit 1', run_id)
    return dict(row) if row else None


# ============================================================================ copilot

async def insert_explanations(rows: list[dict]) -> None:
    if not rows:
        return
    async with pool().acquire() as conn:
        await conn.executemany(
            '''insert into decision_explanations (decision_id, account_id, ts, audience, headline, body, action_hint, model)
               values ($1, $2, $3, $4, $5, $6, $7, $8)''',
            [(r.get('decision_id'), _uuid(r.get('account_id')), r['ts'], r['audience'], r.get('headline'),
              r.get('body'), r.get('action_hint'), r.get('model')) for r in rows])


async def explanations_for_decisions(decision_ids: list[int]) -> dict[int, dict]:
    if not decision_ids:
        return {}
    rows = await pool().fetch(
        '''select distinct on (decision_id) * from decision_explanations
           where decision_id = any($1::bigint[]) and audience = 'user' order by decision_id, created_at desc''',
        decision_ids)
    return {r['decision_id']: dict(r) for r in rows}


async def latest_ops_brief(since: datetime) -> dict | None:
    row = await pool().fetchrow(
        '''select * from decision_explanations where audience = 'ops' and ts >= $1
           order by created_at desc limit 1''', since)
    return dict(row) if row else None


# ============================================================================ anchoring

async def get_batch(batch_date: date, run_id: str = '') -> dict | None:
    row = await pool().fetchrow('select * from anchor_batches where batch_date = $1 and run_id = $2', batch_date, run_id)
    return dict(row) if row else None


async def store_batch(batch_date: date, run_id: str, root: str, decision_ids: list[int], leaves: list[str],
                      paths: list[list[str]], contract_address: str | None, chain_id: int | None) -> int:
    async with pool().acquire() as conn:
        async with conn.transaction():
            batch_id = await conn.fetchval(
                '''insert into anchor_batches (batch_date, run_id, merkle_root, decision_count, first_decision_id,
                                               last_decision_id, contract_address, chain_id)
                   values ($1, $2, $3, $4, $5, $6, $7, $8)
                   on conflict (batch_date, run_id) do update set merkle_root = excluded.merkle_root,
                       decision_count = excluded.decision_count, first_decision_id = excluded.first_decision_id,
                       last_decision_id = excluded.last_decision_id, contract_address = excluded.contract_address,
                       chain_id = excluded.chain_id, error = null
                   returning id''',
                batch_date, run_id, root, len(decision_ids), min(decision_ids), max(decision_ids),
                contract_address, chain_id)
            await conn.execute('delete from decision_proofs where batch_id = $1', batch_id)
            await conn.executemany(
                '''insert into decision_proofs (decision_id, batch_id, leaf_hash, merkle_path) values ($1, $2, $3, $4)
                   on conflict (decision_id) do update set batch_id = excluded.batch_id, leaf_hash = excluded.leaf_hash,
                       merkle_path = excluded.merkle_path''',
                [(did, batch_id, leaf, path) for did, leaf, path in zip(decision_ids, leaves, paths)])
    return batch_id


async def mark_anchored(batch_id: int, tx_hash: str) -> None:
    await pool().execute('update anchor_batches set tx_hash = $2, anchored_at = $3, error = null where id = $1',
                         batch_id, tx_hash, datetime.now(tz=timezone.utc))


async def mark_anchor_error(batch_id: int, error: str) -> None:
    await pool().execute('update anchor_batches set error = $2 where id = $1', batch_id, error[:2000])


async def get_proof(decision_id: int) -> dict | None:
    row = await pool().fetchrow(
        '''select p.decision_id, p.leaf_hash, p.merkle_path, b.id as batch_id, b.batch_date, b.run_id, b.merkle_root,
                  b.tx_hash, b.contract_address, b.chain_id, b.anchored_at, b.error
           from decision_proofs p join anchor_batches b on b.id = p.batch_id where p.decision_id = $1''', decision_id)
    return dict(row) if row else None


async def unanchored_batches() -> list[dict]:
    rows = await pool().fetch('select * from anchor_batches where tx_hash is null order by created_at')
    return [dict(r) for r in rows]


# ============================================================================ replay

async def save_replay(run_id: str, session_date: date, summary: dict, events: list, series: dict) -> None:
    await pool().execute(
        '''insert into replay_runs (run_id, session_date, summary, events, series) values ($1, $2, $3, $4, $5)
           on conflict (run_id) do update set summary = excluded.summary, events = excluded.events,
               series = excluded.series''', run_id, session_date, summary, events, series)


async def get_replay(run_id: str) -> dict | None:
    row = await pool().fetchrow('select * from replay_runs where run_id = $1', run_id)
    return dict(row) if row else None


async def list_replays(limit: int = 20) -> list[dict]:
    rows = await pool().fetch(
        'select run_id, session_date, summary, created_at from replay_runs order by created_at desc limit $1', limit)
    return [dict(r) for r in rows]


# ============================================================================ wallet connections

async def save_wallet_connection(account_id: str, wallet_address: str, chain_id: int) -> None:
    await pool().execute(
        '''insert into wallet_connections (account_id, wallet_address, chain_id)
           values ($1, $2, $3)
           on conflict (account_id, wallet_address, chain_id)
           do update set last_synced = now()''',
        _uuid(account_id), wallet_address.lower(), chain_id)


async def get_wallet_connections(account_id: str) -> list[dict]:
    rows = await pool().fetch(
        '''select wallet_address, chain_id, label, connected_at, last_synced
           from wallet_connections where account_id = $1 order by connected_at''',
        _uuid(account_id))
    return [dict(r) for r in rows]


async def delete_wallet_connection(account_id: str, wallet_address: str, chain_id: int) -> None:
    await pool().execute(
        '''delete from wallet_connections
           where account_id = $1 and wallet_address = $2 and chain_id = $3''',
        _uuid(account_id), wallet_address.lower(), chain_id)
