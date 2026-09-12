"""Seed market data and demo book — callable from scripts or the /internal/seed/* endpoints."""
from __future__ import annotations

import logging
from typing import Any

import numpy as np

from .. import db
from ..config import settings
from .alpha_vantage import AVError, AlphaVantage, QuotaExceeded
from . import halts, sectors
from .precompute import compute_all
from .yfinance import YFinance, YFinanceError

log = logging.getLogger('mochaguard.seed')

# ──────────────────────────────────────────────────────────────────────────────
# Market data
# ──────────────────────────────────────────────────────────────────────────────

async def seed_market(symbols: list[str], include_earnings: bool = True) -> dict[str, Any]:
    """Download price history + risk stats for *symbols* into Postgres.

    Uses Alpha Vantage when configured; falls back to yfinance for everything
    it can supply.  Returns a summary dict suitable for an API response.
    """
    if not settings.alpha_vantage_api_key and not settings.yfinance_enabled:
        raise RuntimeError('Configure ALPHA_VANTAGE_API_KEY or set YFINANCE_ENABLED=true')

    av = AlphaVantage() if settings.alpha_vantage_api_key else None
    yf = YFinance() if settings.yfinance_enabled else None

    loaded: list[str] = []
    failed: list[str] = []
    intraday_count = 0

    try:
        await db.upsert_symbols([{'symbol': s, 'asset_type': 'equity'} for s in symbols])

        for symbol in symbols:
            try:
                # ── daily bars ──────────────────────────────────────────────
                try:
                    if av is None:
                        raise QuotaExceeded('Alpha Vantage not configured')
                    bars = await av.daily(symbol, full=True)
                    splits = await av.splits(symbol)
                    source = 'alpha_vantage'
                except (AVError, QuotaExceeded):
                    if yf is None:
                        raise
                    bars = await yf.daily(symbol)
                    splits = await yf.splits(symbol)
                    source = 'yfinance'

                log.info('Loaded %s daily bars from %s (%d rows)', symbol, source, len(bars))
                await db.upsert_bars_daily(symbol, bars)

                # ── intraday bars ───────────────────────────────────────────
                try:
                    if av is not None and settings.alpha_vantage_premium:
                        try:
                            intraday = await av.intraday(symbol, interval='5min', full=True)
                            intraday_source = 'alpha_vantage'
                        except (AVError, QuotaExceeded):
                            intraday = await yf.intraday(symbol) if yf else []
                            intraday_source = 'yfinance'
                    elif yf is not None:
                        intraday = await yf.intraday(symbol)
                        intraday_source = 'yfinance'
                    else:
                        intraday, intraday_source = [], 'none'
                    intraday_count += await db.upsert_bars_intraday(symbol, intraday, source=intraday_source)
                except (AVError, QuotaExceeded, YFinanceError) as exc:
                    log.warning('%s: intraday unavailable (%s); continuing', symbol, exc)

                # ── corporate actions ───────────────────────────────────────
                await db.upsert_corporate_actions(symbol, splits)

                # ── earnings (AV only) ──────────────────────────────────────
                if include_earnings and av is not None:
                    try:
                        await db.upsert_earnings(symbol, await av.earnings_history(symbol))
                    except AVError as exc:
                        log.warning('%s: AV earnings unavailable (%s); skipped', symbol, exc)

                loaded.append(symbol)
            except Exception as exc:  # noqa: BLE001
                log.error('%s: failed to load (%s)', symbol, exc)
                failed.append(symbol)

        # ── risk, halts, sector peers ───────────────────────────────────────
        risk_rows = await compute_all(loaded)
        halt_info = await halts.detect_all(loaded)
        peer_info = await sectors.refresh_sector_moves()

    finally:
        if av:
            await av.aclose()

    return {
        'symbols_loaded': len(loaded),
        'symbols_failed': len(failed),
        'failed': failed,
        'intraday_bars': intraday_count,
        'risk_profiles': len(risk_rows),
        'halts_found': halt_info.get('halts_found', 0),
        'sector_peers': peer_info.get('stored', 0),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Demo book (sample accounts + positions)
# ──────────────────────────────────────────────────────────────────────────────

SAMPLE_DOMAIN = 'sample.mochaguard.local'
_TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Asia/Singapore',
              'America/New_York', 'Europe/Berlin']
_CROWD_WEIGHT = 6.0
_CROWD_SHARE = 0.45
_LEVERED_FRACTION = 0.18


async def _clear_samples() -> int:
    pool = db.pool()
    rows = await pool.fetch("select id from accounts where email like $1", f'%@{SAMPLE_DOMAIN}')
    if not rows:
        return 0
    ids = [r['id'] for r in rows]
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute('delete from positions where account_id = any($1::uuid[])', ids)
            await conn.execute('delete from accounts where id = any($1::uuid[])', ids)
    return len(ids)


async def seed_book(n_accounts: int = 400, seed_value: int = 7, clear: bool = False) -> dict[str, Any]:
    """Seed *n_accounts* sample accounts sized against real risk stats."""
    if clear:
        removed = await _clear_samples()
        return {'removed': removed}

    pool = db.pool()
    risk = {r['symbol']: dict(r) for r in await pool.fetch(
        'select symbol, last_close, adv_dollar, gap_p99 from symbol_risk')}
    symbols = [s for s, r in sorted(risk.items()) if (r.get('last_close') or 0) > 0]
    if not symbols:
        raise RuntimeError('No symbol_risk rows — run seed_market first')

    rng = np.random.default_rng(seed_value)
    prices = np.array([float(risk[s]['last_close']) for s in symbols])
    adv = np.array([float(risk[s].get('adv_dollar') or 0.0) for s in symbols])
    n_crowd = max(1, int(round(len(symbols) * _CROWD_SHARE)))
    crowd = set(np.argsort(adv)[::-1][:n_crowd].tolist())
    weights = np.array([_CROWD_WEIGHT if i in crowd else 1.0 for i in range(len(symbols))])
    weights /= weights.sum()

    await _clear_samples()

    accounts: list[tuple] = []
    positions: list[tuple] = []
    for i in range(n_accounts):
        tz = _TIMEZONES[i % len(_TIMEZONES)]
        equity = float(rng.lognormal(np.log(40_000), 0.9))
        hot = rng.random() < _LEVERED_FRACTION
        lev = float(rng.uniform(6.0, 14.0)) if hot else float(rng.uniform(1.0, 5.0))
        k = int(rng.integers(1, min(5, len(symbols)) + 1))
        picks = rng.choice(len(symbols), size=k, replace=False, p=weights)
        gross = equity * lev
        for p in picks:
            qty = gross / k / prices[p]
            drift = float(rng.normal(0.0, 0.06))
            entry = max(0.01, float(prices[p]) * (1.0 - drift))
            positions.append((f'sample-{i + 1:05d}', symbols[p], round(float(qty), 6),
                              round(entry, 4)))
        accounts.append((f'sample-{i + 1:05d}@{SAMPLE_DOMAIN}', f'Sample Trader {i + 1}', tz,
                         round(equity - gross, 2)))

    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                '''insert into accounts (email, display_name, tz, cash)
                   select * from unnest($1::text[], $2::text[], $3::text[], $4::double precision[])
                   returning id, email''',
                [a[0] for a in accounts], [a[1] for a in accounts],
                [a[2] for a in accounts], [a[3] for a in accounts])
            by_email = {r['email']: r['id'] for r in rows}
            handle_to_id = {e.split('@')[0]: i for e, i in by_email.items()}
            pos_rows = [(handle_to_id[h], sym, qty, avg) for h, sym, qty, avg in positions
                        if h in handle_to_id]
            await conn.executemany(
                'insert into positions (account_id, symbol, qty, avg_price) values ($1, $2, $3, $4)',
                pos_rows)

    crowded = sorted(symbols[i] for i in crowd)
    return {'accounts': len(accounts), 'positions': len(pos_rows),
            'symbols': len(symbols), 'crowded': crowded}
