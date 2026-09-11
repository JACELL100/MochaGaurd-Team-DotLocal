'''Build the in-memory ``BookState`` from Postgres. Called at startup and after any mutation.'''
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import numpy as np

from .. import db
from ..engine import calendar as cal
from . import sectors
from ..state import Account, BookState, DailySeries, IntradaySeries

log = logging.getLogger('mochaguard.loader')


def _daily_series(rows: list) -> DailySeries:
    dates = np.array([r['d'].toordinal() for r in rows], dtype=np.int64)
    close = np.array([r['close'] for r in rows], dtype=float)
    adj = np.array([r['adj_close'] if r['adj_close'] else r['close'] for r in rows], dtype=float)
    factor = np.where(close > 0, adj / np.where(close > 0, close, 1.0), 1.0)
    open_adj = np.array([r['open'] if r['open'] else r['close'] for r in rows], dtype=float) * factor
    vol = np.array([r['volume'] or 0.0 for r in rows], dtype=float)
    return DailySeries(dates, open_adj, adj, vol)


def _intraday_series(rows: list) -> IntradaySeries:
    ts = np.array([int(r['ts'].timestamp() * 1e9) for r in rows], dtype=np.int64)
    px = np.array([r['close'] for r in rows], dtype=float)
    vol = np.array([r['volume'] or 0.0 for r in rows], dtype=float)
    return IntradaySeries(ts, px, vol)


async def load_book(intraday_start: datetime | None = None, intraday_end: datetime | None = None) -> BookState:
    payload = await db.load_book_payload()
    symbols = payload['symbols']
    if not symbols:
        log.warning('no active symbols in the database; run scripts/seed.py')

    daily: dict[str, list] = {}
    for r in payload['daily']:
        daily.setdefault(r['symbol'], []).append(r)
    daily_series = {s: _daily_series(rows) for s, rows in daily.items() if rows}

    if intraday_start is None or intraday_end is None:
        # today's session (ET) by default; the poller appends live prints
        now_et = datetime.now(tz=cal.ET)
        d = now_et.date()
        intraday_start = cal.session_open(d) - timedelta(hours=6)
        intraday_end = cal.session_close(d) + timedelta(hours=8)
    intraday_rows = await db.intraday_between(intraday_start, intraday_end, symbols)
    intraday = {s: _intraday_series(rows) for s, rows in intraday_rows.items() if rows}

    earnings: dict[str, list[tuple[date, str | None]]] = {}
    for r in payload['earnings']:
        earnings.setdefault(r['symbol'], []).append((r['report_date'], r['timing']))
    splits: dict[str, set[date]] = {}
    for r in payload['splits']:
        splits.setdefault(r['symbol'], set()).add(r['effective_date'])
    halts: dict[str, list[tuple[datetime, datetime | None]]] = {}
    for r in payload['halts']:
        halts.setdefault(r['symbol'], []).append((r['started_at'], r['ended_at']))

    accounts = [Account(id=str(a['id']), tz=a['tz'] or 'UTC', cash=float(a['cash'] or 0.0), email=a['email'],
                        display_name=a['display_name']) for a in payload['accounts']]
    sym_set = set(symbols)
    positions = [(str(p['account_id']), p['symbol'], float(p['qty']),
                  float(p['avg_price']) if p.get('avg_price') else None)
                 for p in payload['positions'] if p['symbol'] in sym_set]
    dropped = len(payload['positions']) - len(positions)
    if dropped:
        log.warning('%d positions reference symbols outside the universe and were ignored', dropped)

    # Sector peers that trade during the US overnight window (TSMC, ASML, Nifty ...). Loaded
    # here so the engine can read them without a database call while deciding.
    peer_rows = await db.latest_sector_moves(sectors.all_peer_tickers(), date.today())

    book = BookState(symbols=symbols, risk=payload['risk'], accounts=accounts, positions=positions,
                     earnings=earnings, splits=splits, halts=halts, daily=daily_series,
                     intraday=intraday, sector_moves=peer_rows)
    log.info('book loaded: %d symbols, %d accounts, %d positions, %d symbols with intraday prints',
             len(symbols), len(accounts), len(positions), len(intraday))
    return book
