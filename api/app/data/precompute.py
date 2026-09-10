'''symbol_risk from adjusted daily bars. Everything the leverage formula needs, as-of a date.

All returns use split-adjusted prices (``adj_close`` and an adjusted open derived from the same
factor), so a 4-for-1 split never shows up as a -75% gap. Stats are computed strictly from bars
with ``d <= as_of`` so the replay harness can rebuild history without look-ahead.
'''
from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from .. import db

MIN_DAYS = 60
ADV_WINDOW = 60
EARNINGS_FLOOR_MULT = 2.5   # with too few observed earnings gaps, assume 2.5x the normal p99

# While the market is open the engine can sell, so the only risk it carries is the move that
# happens *inside the time it takes to get out* -- not a whole session's high-to-low range.
# LIQ_HORIZON_MIN is that exit window; intraday risk is the p99 adverse move over it, measured
# from real 1-5 minute bars when available and otherwise scaled down from the daily range by
# sqrt(time), which is why an open-market limit is far higher than an overnight one.
LIQ_HORIZON_MIN = 5.0
SESSION_MIN = 390.0
INTRADAY_FLOOR = 0.004


def _horizon_p99(bars: list[dict]) -> float | None:
    '''p99 adverse move over LIQ_HORIZON_MIN, measured from real intraday prints.'''
    px = np.array([float(b['close']) for b in bars if b.get('close')], dtype=float)
    if len(px) < 200:
        return None
    step = max(1, int(round(LIQ_HORIZON_MIN / _bar_minutes(bars))))
    if len(px) <= step:
        return None
    moves = np.abs(px[step:] / px[:-step] - 1.0)
    moves = moves[np.isfinite(moves)]
    if len(moves) < 100:
        return None
    return float(np.percentile(moves, 99))


def _bar_minutes(bars: list[dict]) -> float:
    '''Median spacing of the intraday series in minutes (handles 1min and 5min feeds).'''
    ts = [b['ts'] for b in bars if b.get('ts')]
    if len(ts) < 3:
        return 5.0
    deltas = np.diff(np.array([t.timestamp() for t in ts], dtype=float)) / 60.0
    deltas = deltas[(deltas > 0) & (deltas <= 30)]
    return float(np.median(deltas)) if len(deltas) else 5.0


def _stats(bars: list[dict], earnings: list[tuple[date, str | None]], as_of: date | None = None,
           intraday_bars: list[dict] | None = None) -> dict | None:
    rows = [b for b in bars if b['adj_close'] and b['close'] and (as_of is None or b['d'] <= as_of)]
    if len(rows) < MIN_DAYS:
        return None
    d = np.array([b['d'].toordinal() for b in rows])
    close = np.array([b['close'] for b in rows], dtype=float)
    adj = np.array([b['adj_close'] for b in rows], dtype=float)
    factor = adj / close
    open_adj = np.array([b['open'] for b in rows], dtype=float) * factor
    high = np.array([b['high'] if b['high'] else b['close'] for b in rows], dtype=float)
    low = np.array([b['low'] if b['low'] else b['close'] for b in rows], dtype=float)
    vol = np.array([b['volume'] or 0.0 for b in rows], dtype=float)

    gaps = np.abs(open_adj[1:] / adj[:-1] - 1.0)                                   # overnight
    # high/low are unadjusted; ratios within a day are split-invariant, so use the raw open
    raw_open = np.array([b['open'] for b in rows], dtype=float)
    day_range = np.maximum(np.abs(high / raw_open - 1.0), np.abs(low / raw_open - 1.0))
    day_range = day_range[np.isfinite(day_range)]
    # Scale the full-session range down to the exit window by sqrt(time).
    intraday = day_range * np.sqrt(LIQ_HORIZON_MIN / SESSION_MIN)

    # earnings gaps: AMC report on day t -> gap into t+1; BMO/unknown on day t -> gap into t
    ord_index = {int(o): i for i, o in enumerate(d)}
    earn_gaps = []
    for rd, timing in earnings:
        if as_of is not None and rd > as_of:
            continue
        target = rd if (timing or 'bmo') != 'amc' else rd + timedelta(days=1)
        # find first bar on/after target
        k = int(np.searchsorted(d, target.toordinal(), side='left'))
        if 1 <= k < len(d) and d[k] - target.toordinal() <= 4:
            earn_gaps.append(gaps[k - 1])
    earn_gaps = np.array(earn_gaps, dtype=float)

    gap_p99 = float(np.percentile(gaps, 99)) if len(gaps) else 0.05
    gap_p50 = float(np.percentile(gaps, 50)) if len(gaps) else 0.01
    intraday_p99 = float(np.percentile(intraday, 99)) if len(intraday) else 0.005
    if intraday_bars:
        observed = _horizon_p99(intraday_bars)
        if observed is not None:
            intraday_p99 = observed
    # Intraday exposure can never exceed the overnight gap it is a fraction of.
    intraday_p99 = float(min(max(intraday_p99, INTRADAY_FLOOR), max(gap_p99, INTRADAY_FLOOR)))
    if len(earn_gaps) >= 4:
        earnings_gap_p99 = float(max(np.percentile(earn_gaps, 90), earn_gaps.max(), gap_p99))
    elif len(earn_gaps):
        earnings_gap_p99 = float(max(earn_gaps.max(), gap_p99 * EARNINGS_FLOOR_MULT))
    else:
        earnings_gap_p99 = float(gap_p99 * EARNINGS_FLOOR_MULT)

    w = min(ADV_WINDOW, len(rows))
    adv_shares = float(np.mean(vol[-w:])) if w else 1e6
    adv_dollar = float(np.mean(vol[-w:] * close[-w:])) if w else 1e8
    return {
        'as_of': rows[-1]['d'], 'gap_p50': round(gap_p50, 5), 'gap_p99': round(gap_p99, 5),
        'intraday_p99': round(intraday_p99, 5), 'earnings_gap_p99': round(earnings_gap_p99, 5),
        'adv_dollar': round(adv_dollar, 2), 'adv_shares': round(adv_shares, 2),
        'last_close': float(close[-1]), 'n_days': len(rows), 'n_earnings': int(len(earn_gaps)),
    }


async def compute_symbol(symbol: str, as_of: date | None = None) -> dict | None:
    bars = [dict(r) for r in await db.daily_bars(symbol)]
    earnings = [(r['report_date'], r['timing']) for r in await db.earnings_for(symbol)]
    intraday_bars = [dict(r) for r in await db.intraday_all(symbol, as_of)]
    s = _stats(bars, earnings, as_of, intraday_bars)
    if s is None:
        return None
    return {'symbol': symbol, **s}


async def compute_all(symbols: list[str] | None = None, as_of: date | None = None, persist: bool = True) -> list[dict]:
    symbols = symbols or await db.list_symbols()
    out = []
    for s in symbols:
        r = await compute_symbol(s, as_of)
        if r:
            out.append(r)
    if persist and out and as_of is None:
        await db.upsert_symbol_risk(out)
    return out
