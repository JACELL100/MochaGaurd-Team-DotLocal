'''Intraday quote poller: keeps the in-memory book priced during the session.

Premium keys: one REALTIME_BULK_QUOTES call per tick covers the whole universe.
Free keys: one GLOBAL_QUOTE per tick, round-robin, held symbols first. Stops for the day when
the budget is spent. Prints are persisted to ``bars_intraday`` so restarts and the replay
harness see the same prices the engine saw.
'''
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from .. import db
from ..config import settings
from ..engine import calendar as cal
from .alpha_vantage import AlphaVantage, AVError, QuotaExceeded
from .yfinance import YFinance, YFinanceError

log = logging.getLogger('mochaguard.poller')


class QuotePoller:
    def __init__(self, get_book, av: AlphaVantage | None, yf: YFinance | None = None):
        self.get_book = get_book
        self.av = av
        self.yf = yf
        self._rr = 0
        self.last_tick: datetime | None = None
        self.last_error: str | None = None
        self.prints = 0

    async def run(self) -> None:
        if settings.quote_poll_seconds <= 0:
            log.info('quote poller disabled (QUOTE_POLL_SECONDS=0)')
            return
        while True:
            try:
                await self.tick()
            except Exception as e:  # noqa: BLE001 - keep the service alive
                self.last_error = str(e)
                log.exception('poller tick failed')
            await asyncio.sleep(settings.quote_poll_seconds)

    async def tick(self) -> None:
        now = datetime.now(tz=timezone.utc)
        phase = cal.phase_at(now)
        if phase not in (cal.Phase.OPEN, cal.Phase.CLOSING_RAMP):
            return
        book = self.get_book()
        if book is None or not book.symbols:
            return
        symbols = book.held_symbols() or book.symbols
        sym = symbols[self._rr % len(symbols)]
        self._rr += 1
        source = 'alpha_vantage_quote'
        try:
            if self.av is None:
                raise QuotaExceeded('Alpha Vantage is not configured')
            if settings.alpha_vantage_premium:
                quotes = await self.av.bulk_quotes(book.symbols)
            else:
                q = await self.av.quote(sym)
                quotes = [q] if q else []
        except (AVError, QuotaExceeded) as exc:
            if self.yf is None:
                raise
            log.info('Alpha Vantage quote unavailable (%s); using Yahoo Finance fallback', exc)
            q = await self.yf.quote(sym)
            quotes = [q] if q else []
            source = 'yfinance_quote'
        rows_by_symbol: dict[str, list[dict]] = {}
        for q in quotes:
            ts = q.ts.replace(second=0, microsecond=0)
            if book.apply_quote(q.symbol, q.price, ts, q.volume):
                rows_by_symbol.setdefault(q.symbol, []).append({'ts': ts, 'close': q.price, 'volume': q.volume})
                self.prints += 1
        for sym, rows in rows_by_symbol.items():
            try:
                await db.upsert_bars_intraday(sym, rows, source=source)
            except Exception:  # noqa: BLE001
                log.exception('failed to persist quote for %s', sym)
        self.last_tick = now
        self.last_error = None
