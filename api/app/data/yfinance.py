"""Small yfinance adapter used as a no-key fallback for price history and quotes.

Yahoo data is fetched only after Alpha Vantage is unavailable/rate-limited, or when no Alpha
key is configured. It is intentionally not used for earnings or provider-specific market APIs.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any

import yfinance as yf

from .alpha_vantage import Quote


class YFinanceError(RuntimeError):
    pass


def _number(row: Any, name: str, default: float = 0.0) -> float:
    value = row.get(name, default)
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


class YFinance:
    """Run yfinance's synchronous client outside the FastAPI event loop."""

    async def daily(self, symbol: str, period: str = '5y') -> list[dict]:
        return await asyncio.to_thread(self._daily, symbol, period)

    async def intraday(self, symbol: str, period: str = '60d', interval: str = '5m') -> list[dict]:
        return await asyncio.to_thread(self._intraday, symbol, period, interval)

    @staticmethod
    def _intraday(symbol: str, period: str, interval: str) -> list[dict]:
        try:
            frame = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False,
                                              prepost=False, actions=False, raise_errors=False)
        except Exception as exc:
            raise YFinanceError(f'Yahoo Finance intraday history lookup failed for {symbol}') from exc
        if frame is None or frame.empty:
            raise YFinanceError(f'Yahoo Finance returned no intraday history for {symbol}')
        out = []
        for index, row in frame.iterrows():
            close = _number(row, 'Close')
            if close <= 0 or not hasattr(index, 'to_pydatetime'):
                continue
            ts = index.to_pydatetime()
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            out.append({'ts': ts, 'open': _number(row, 'Open', close), 'high': _number(row, 'High', close),
                        'low': _number(row, 'Low', close), 'close': close, 'volume': _number(row, 'Volume')})
        if not out:
            raise YFinanceError(f'Yahoo Finance returned no usable intraday history for {symbol}')
        return out

    @staticmethod
    def _daily(symbol: str, period: str) -> list[dict]:
        try:
            frame = yf.Ticker(symbol).history(period=period, interval='1d', auto_adjust=False, actions=True,
                                              raise_errors=False)
        except Exception as exc:  # yfinance exposes transport/provider errors as several concrete types
            raise YFinanceError(f'Yahoo Finance history lookup failed for {symbol}') from exc
        if frame is None or frame.empty:
            raise YFinanceError(f'Yahoo Finance returned no daily history for {symbol}')
        out = []
        for index, row in frame.iterrows():
            d = index.date() if hasattr(index, 'date') else date.fromisoformat(str(index)[:10])
            close = _number(row, 'Close')
            if close <= 0:
                continue
            split = _number(row, 'Stock Splits', 0.0) or 1.0
            out.append({'d': d, 'open': _number(row, 'Open', close), 'high': _number(row, 'High', close),
                        'low': _number(row, 'Low', close), 'close': close,
                        'adj_close': _number(row, 'Adj Close', close), 'volume': _number(row, 'Volume'),
                        'dividend': _number(row, 'Dividends'), 'split_coef': split})
        if not out:
            raise YFinanceError(f'Yahoo Finance returned no usable daily history for {symbol}')
        return out

    async def splits(self, symbol: str) -> list[dict]:
        bars = await self.daily(symbol)
        return [{'effective_date': bar['d'], 'kind': 'split', 'ratio': bar['split_coef']}
                for bar in bars if bar['split_coef'] != 1.0]

    async def quote(self, symbol: str) -> Quote | None:
        return await asyncio.to_thread(self._quote, symbol)

    @staticmethod
    def _quote(symbol: str) -> Quote | None:
        try:
            frame = yf.Ticker(symbol).history(period='1d', interval='1m', auto_adjust=False, prepost=False,
                                              raise_errors=False)
        except Exception as exc:
            raise YFinanceError(f'Yahoo Finance quote lookup failed for {symbol}') from exc
        if frame is None or frame.empty:
            return None
        row = frame.iloc[-1]
        price = _number(row, 'Close')
        if price <= 0:
            return None
        index = frame.index[-1]
        ts = index.to_pydatetime() if hasattr(index, 'to_pydatetime') else datetime.now(tz=timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        prev_close = _number(frame.iloc[0], 'Open') or None
        return Quote(symbol=symbol, price=price, volume=_number(row, 'Volume'), ts=ts, prev_close=prev_close)

    async def market_query(self, kind: str, **query) -> dict:
        """Support the quote views in the public market explorer during an Alpha outage."""
        function = str(query.get('function', '')).upper()
        if kind not in {'stocks', 'index'} or function not in {'GLOBAL_QUOTE', 'REALTIME_BULK_QUOTES'}:
            raise YFinanceError('Yahoo Finance fallback supports stock and index quote requests only')
        symbols = str(query.get('symbol') or '').split(',')
        symbols = [symbol.strip().upper() for symbol in symbols if symbol.strip()]
        if not symbols:
            raise YFinanceError('A symbol is required for a Yahoo Finance quote')
        quotes = [quote for quote in await asyncio.gather(*(self.quote(symbol) for symbol in symbols)) if quote]
        if not quotes:
            raise YFinanceError('Yahoo Finance returned no quote')
        if function == 'GLOBAL_QUOTE':
            q = quotes[0]
            return {'Global Quote': {'01. symbol': q.symbol, '05. price': str(q.price),
                                     '06. volume': str(q.volume), '07. latest trading day': q.ts.date().isoformat(),
                                     '08. previous close': str(q.prev_close or '')}}
        return {'data': [{'symbol': q.symbol, 'close': q.price, 'volume': q.volume,
                          'timestamp': q.ts.isoformat()} for q in quotes]}
