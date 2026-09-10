'''Infer trading halts from the recorded intraday tape.

Neither Alpha Vantage nor Yahoo publishes a LULD halt feed, but a halt leaves an unmistakable
signature in the bars we already store: during market hours the price stops changing and volume
goes to zero for several consecutive minutes. That is precisely the trap the problem statement
describes -- a flat tape reads as "very safe" to a naive engine, when in fact trading has
stopped and the risk has not.

Marking these lets the freeze guard do its job on real data: a halted symbol takes on no new
exposure and is never liquidated into a stale print. Rows are written with source='inferred' so
they are never confused with an official feed; a real feed can be added later and will simply
overwrite the same (symbol, started_at) key.
'''
from __future__ import annotations

import logging
from datetime import timedelta

from .. import db
from ..engine import calendar as cal

log = logging.getLogger('mochaguard.halts')

MIN_FLAT_BARS = 3          # consecutive unchanged, zero-volume bars before we call it a halt
RESUME_PAD = timedelta(minutes=1)


def _detect(bars: list[dict]) -> list[dict]:
    '''Runs of >= MIN_FLAT_BARS bars with an unchanged close and no volume, in market hours.'''
    out: list[dict] = []
    run: list[dict] = []

    def flush() -> None:
        if len(run) >= MIN_FLAT_BARS:
            out.append({'started_at': run[0]['ts'],
                        'ended_at': run[-1]['ts'] + RESUME_PAD,
                        'bars': len(run)})
        run.clear()

    prev = None
    for bar in bars:
        ts, close = bar['ts'], bar.get('close')
        vol = bar.get('volume') or 0.0
        if close is None or cal.phase_at(ts) != cal.Phase.OPEN:
            flush()
            prev = bar
            continue
        # A halt is a *stopped* tape: same print, no trades. Either alone is normal.
        if prev is not None and prev.get('close') == close and vol == 0:
            if not run:
                run.append(prev)
            run.append(bar)
        else:
            flush()
        prev = bar
    flush()
    return out


async def detect_symbol(symbol: str) -> list[dict]:
    bars = [dict(r) for r in await db.intraday_all(symbol)]
    if len(bars) < MIN_FLAT_BARS + 1:
        return []
    return [{'symbol': symbol, 'started_at': h['started_at'], 'ended_at': h['ended_at'],
             'reason': f"inferred: {h['bars']} flat zero-volume bars during regular hours",
             'source': 'inferred'} for h in _detect(bars)]


async def detect_all(symbols: list[str] | None = None) -> dict:
    symbols = symbols or await db.list_symbols()
    found: list[dict] = []
    for symbol in symbols:
        try:
            found.extend(await detect_symbol(symbol))
        except Exception:  # noqa: BLE001
            log.exception('halt detection failed for %s', symbol)
    written = await db.upsert_halts(found)
    by_symbol: dict[str, int] = {}
    for h in found:
        by_symbol[h['symbol']] = by_symbol.get(h['symbol'], 0) + 1
    return {'symbols_scanned': len(symbols), 'halts_found': written, 'by_symbol': by_symbol}
