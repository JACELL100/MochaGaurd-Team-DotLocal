'''Alpha Vantage client with a per-minute limiter and a daily budget guard.

Free keys get 25 requests/day, premium keys 75+/minute. Every call is counted in ``av_usage`` so
the seed, the scheduler and the quote poller share one budget and stop cleanly instead of
burning the day's allowance on error retries.
'''
from __future__ import annotations

import asyncio
import csv
import io
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import httpx

from .. import db
from ..config import settings

log = logging.getLogger('mochaguard.av')
BASE = 'https://www.alphavantage.co/query'
ET = ZoneInfo('America/New_York')


class AVError(RuntimeError):
    pass


class QuotaExceeded(AVError):
    pass


class PremiumRequired(AVError):
    pass


def _provider_error(message: str) -> AVError:
    """Never pass provider text through to a browser: it can echo the API key."""
    low = message.lower()
    if 'premium' in low:
        return PremiumRequired('Alpha Vantage premium access is required for this request')
    if 'rate limit' in low or 'requests per day' in low or 'call frequency' in low:
        return QuotaExceeded('Alpha Vantage daily quota is exhausted')
    return AVError('Alpha Vantage rejected this request')


@dataclass
class Quote:
    symbol: str
    price: float
    volume: float
    ts: datetime
    prev_close: float | None = None


class AlphaVantage:
    def __init__(self, api_key: str | None = None):
        self.key = api_key or settings.alpha_vantage_api_key
        if not self.key:
            raise RuntimeError('ALPHA_VANTAGE_API_KEY is not set')
        self._client = httpx.AsyncClient(timeout=30.0)
        self._lock = asyncio.Lock()
        self._recent: list[float] = []
        self._exhausted_for: date | None = None

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------ plumbing
    async def _throttle(self) -> None:
        loop = asyncio.get_running_loop()
        async with self._lock:
            now = loop.time()
            self._recent = [t for t in self._recent if now - t < 60.0]
            if len(self._recent) >= settings.av_calls_per_minute:
                wait = 60.0 - (now - self._recent[0]) + 0.25
                log.info('AV throttle: sleeping %.1fs', wait)
                await asyncio.sleep(wait)
            self._recent.append(loop.time())

    async def _budget_check(self) -> None:
        today = datetime.now(tz=timezone.utc).date()
        if self._exhausted_for == today:
            raise QuotaExceeded('Alpha Vantage daily budget exhausted (cached)')
        try:
            used = await db.av_calls_today(today)
        except RuntimeError:
            return  # db not initialised (scripts); rely on the API's own limit
        if not settings.alpha_vantage_premium and used >= settings.av_daily_budget:
            self._exhausted_for = today
            raise QuotaExceeded(f'Alpha Vantage daily budget of {settings.av_daily_budget} calls spent')

    async def _get(self, **params) -> dict | str:
        await self._budget_check()
        await self._throttle()
        params['apikey'] = self.key
        r = await self._client.get(BASE, params=params)
        try:
            await db.av_bump(datetime.now(tz=timezone.utc).date())
        except RuntimeError:
            pass
        r.raise_for_status()
        if params.get('datatype') == 'csv' or r.headers.get('content-type', '').startswith('text/csv') \
                or params.get('function') == 'EARNINGS_CALENDAR':
            return r.text
        data = r.json()
        if isinstance(data, dict):
            msg = data.get('Information') or data.get('Note') or data.get('Error Message')
            if msg:
                error = _provider_error(str(msg))
                if isinstance(error, QuotaExceeded):
                    self._exhausted_for = datetime.now(tz=timezone.utc).date()
                raise error
        return data

    # ------------------------------------------------------------------ daily bars
    async def daily(self, symbol: str, full: bool = True) -> list[dict]:
        '''Split/dividend-adjusted daily bars. Tries the adjusted endpoint first, falls back to the
        unadjusted series + SPLITS (adjusting closes ourselves) when the key is not premium.'''
        size = 'full' if full else 'compact'
        if settings.alpha_vantage_premium:
            try:
                data = await self._get(function='TIME_SERIES_DAILY_ADJUSTED', symbol=symbol, outputsize=size)
                series = data.get('Time Series (Daily)', {})
                out = []
                for d, v in series.items():
                    out.append({'d': date.fromisoformat(d), 'open': float(v['1. open']), 'high': float(v['2. high']),
                                'low': float(v['3. low']), 'close': float(v['4. close']),
                                'adj_close': float(v['5. adjusted close']), 'volume': float(v['6. volume']),
                                'dividend': float(v.get('7. dividend amount', 0) or 0),
                                'split_coef': float(v.get('8. split coefficient', 1) or 1)})
                out.sort(key=lambda b: b['d'])
                return out
            except PremiumRequired:
                log.warning('%s: adjusted history unavailable; adjusting unadjusted closes from SPLITS', symbol)
        # The free tier only offers the last 100 daily points. It still exceeds our 60-session
        # minimum and is more honest than issuing an unsupported premium request.
        query_size = size if settings.alpha_vantage_premium else 'compact'
        data = await self._get(function='TIME_SERIES_DAILY', symbol=symbol, outputsize=query_size)
        series = data.get('Time Series (Daily)', {})
        bars = []
        for d, v in series.items():
            bars.append({'d': date.fromisoformat(d), 'open': float(v['1. open']), 'high': float(v['2. high']),
                         'low': float(v['3. low']), 'close': float(v['4. close']), 'volume': float(v['5. volume']),
                         'dividend': 0.0, 'split_coef': 1.0})
        bars.sort(key=lambda b: b['d'])
        splits = []
        try:
            splits = await self.splits(symbol)
        except AVError as e:
            log.warning('%s: SPLITS unavailable (%s); daily closes left unadjusted', symbol, e)
        # backwards cumulative split factor: prices before a split are divided by the ratio
        factor = 1.0
        by_date = {s['effective_date']: s['ratio'] for s in splits if s.get('ratio')}
        for b in reversed(bars):
            if b['d'] in by_date:
                factor *= by_date[b['d']]
                b['split_coef'] = by_date[b['d']]
            b['adj_close'] = b['close'] / factor
        return bars

    async def splits(self, symbol: str) -> list[dict]:
        data = await self._get(function='SPLITS', symbol=symbol)
        out = []
        for row in data.get('data', []):
            try:
                out.append({'effective_date': date.fromisoformat(row['effective_date']), 'kind': 'split',
                            'ratio': float(row['split_factor'])})
            except (KeyError, ValueError):
                continue
        return out

    # ------------------------------------------------------------------ intraday
    async def intraday(self, symbol: str, interval: str = '5min', month: str | None = None,
                       full: bool = True) -> list[dict]:
        params = dict(function='TIME_SERIES_INTRADAY', symbol=symbol, interval=interval, adjusted='true',
                      extended_hours='false', outputsize='full' if full else 'compact')
        if month:
            params['month'] = month
        data = await self._get(**params)
        key = next((k for k in data if k.startswith('Time Series')), None)
        if not key:
            return []
        out = []
        for ts, v in data[key].items():
            # Alpha Vantage intraday timestamps are US/Eastern, bar *end* time labelled at start
            naive = datetime.strptime(ts, '%Y-%m-%d %H:%M:%S')
            out.append({'ts': naive.replace(tzinfo=ET), 'open': float(v['1. open']), 'high': float(v['2. high']),
                        'low': float(v['3. low']), 'close': float(v['4. close']), 'volume': float(v['5. volume'])})
        out.sort(key=lambda b: b['ts'])
        return out

    # ------------------------------------------------------------------ quotes
    async def quote(self, symbol: str) -> Quote | None:
        data = await self._get(function='GLOBAL_QUOTE', symbol=symbol)
        q = data.get('Global Quote') or {}
        if not q.get('05. price'):
            return None
        return Quote(symbol=symbol, price=float(q['05. price']), volume=float(q.get('06. volume') or 0),
                     ts=datetime.now(tz=timezone.utc), prev_close=float(q.get('08. previous close') or 0) or None)

    async def bulk_quotes(self, symbols: list[str]) -> list[Quote]:
        '''REALTIME_BULK_QUOTES: premium only, up to 100 symbols per call.'''
        out: list[Quote] = []
        for i in range(0, len(symbols), 100):
            chunk = symbols[i:i + 100]
            data = await self._get(function='REALTIME_BULK_QUOTES', symbol=','.join(chunk))
            for row in data.get('data', []):
                try:
                    ts = datetime.strptime(row['timestamp'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=ET)
                except (KeyError, ValueError):
                    ts = datetime.now(tz=timezone.utc)
                try:
                    out.append(Quote(symbol=row['symbol'], price=float(row['close']),
                                     volume=float(row.get('volume') or 0), ts=ts,
                                     prev_close=float(row.get('previous_close') or 0) or None))
                except (KeyError, ValueError):
                    continue
        return out

    # ------------------------------------------------------------------ fundamentals / calendar
    async def earnings_calendar(self, symbol: str | None = None, horizon: str = '12month') -> list[dict]:
        params = dict(function='EARNINGS_CALENDAR', horizon=horizon)
        if symbol:
            params['symbol'] = symbol
        text = await self._get(**params)
        if not isinstance(text, str):
            return []
        out = []
        for row in csv.DictReader(io.StringIO(text)):
            try:
                out.append({'symbol': row['symbol'], 'report_date': date.fromisoformat(row['reportDate']),
                            'fiscal_period_end': date.fromisoformat(row['fiscalDateEnding']) if row.get('fiscalDateEnding') else None,
                            'estimate': float(row['estimate']) if row.get('estimate') else None,
                            'timing': None})
            except (KeyError, ValueError):
                continue
        return out

    async def earnings_history(self, symbol: str) -> list[dict]:
        '''Past report dates (quarterly), used to compute earnings-gap statistics.'''
        data = await self._get(function='EARNINGS', symbol=symbol)
        out = []
        for row in data.get('quarterlyEarnings', []):
            try:
                rd = row.get('reportedDate')
                if not rd:
                    continue
                timing = (row.get('reportTime') or '').lower()
                out.append({'report_date': date.fromisoformat(rd),
                            'fiscal_period_end': date.fromisoformat(row['fiscalDateEnding']) if row.get('fiscalDateEnding') else None,
                            'estimate': float(row['estimatedEPS']) if row.get('estimatedEPS') not in (None, 'None', '') else None,
                            'timing': 'amc' if 'post' in timing else 'bmo' if 'pre' in timing else None})
            except (KeyError, ValueError):
                continue
        return out

    async def overview(self, symbol: str) -> dict:
        data = await self._get(function='OVERVIEW', symbol=symbol)
        return data if isinstance(data, dict) else {}

    async def news_sentiment(self, tickers: list[str], limit: int = 20) -> list[dict]:
        data = await self._get(function='NEWS_SENTIMENT', tickers=','.join(tickers), limit=str(limit), sort='LATEST')
        return data.get('feed', []) if isinstance(data, dict) else []

    async def market_query(self, kind: str, **query) -> dict | str:
        """Small, allow-listed gateway for live Alpha Vantage products.

        This deliberately does not expose the provider's generic ``function`` parameter: users
        cannot turn the product into an unaudited proxy or consume an unexpected amount of quota.
        """
        allowed = {
            'stocks': {'GLOBAL_QUOTE', 'REALTIME_BULK_QUOTES'},
            'crypto': {'DIGITAL_CURRENCY_DAILY', 'CRYPTO_INTRADAY'},
            'forex': {'FX_DAILY', 'FX_INTRADAY', 'CURRENCY_EXCHANGE_RATE'},
            'commodity': {'WTI', 'BRENT', 'NATURAL_GAS', 'COPPER', 'ALUMINUM', 'WHEAT', 'CORN', 'COTTON', 'SUGAR', 'COFFEE'},
            'etf': {'ETF_PROFILE'},
            'index': {'REALTIME_BULK_QUOTES', 'GLOBAL_QUOTE'},
            'fundamentals': {'OVERVIEW', 'INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW', 'EARNINGS'},
            'news': {'NEWS_SENTIMENT'},
            'technical': {'SMA', 'EMA', 'RSI', 'MACD', 'BBANDS', 'ADX', 'OBV', 'STOCH', 'CCI', 'AROON'},
            'economic': {'REAL_GDP', 'REAL_GDP_PER_CAPITA', 'TREASURY_YIELD', 'FEDERAL_FUNDS_RATE', 'CPI', 'INFLATION',
                         'RETAIL_SALES', 'DURABLES', 'UNEMPLOYMENT', 'NONFARM_PAYROLL'},
        }
        function = str(query.pop('function', '')).upper()
        if function not in allowed.get(kind, set()):
            raise ValueError(f'Unsupported {kind} function')
        safe: dict[str, str] = {'function': function}
        for key, value in query.items():
            if value is None or value == '':
                continue
            if key not in {'symbol', 'market', 'from_symbol', 'to_symbol', 'interval', 'time_period', 'series_type',
                           'month', 'outputsize', 'datatype', 'horizon', 'tickers', 'topics', 'limit', 'sort', 'maturity'}:
                raise ValueError(f'Unsupported parameter: {key}')
            safe[key] = str(value).upper() if key in {'symbol', 'market', 'from_symbol', 'to_symbol'} else str(value)
        return await self._get(**safe)
