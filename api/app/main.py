"""Live Mochatrade risk service.

There are no synthetic accounts, prices, or fallback decisions in this process.  If Supabase has
not been migrated and populated with real market data, endpoints fail closed with a useful 503.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import db
from .anchor import publisher
from .auth import Principal, SupabaseAuth, get_principal
from .config import settings
from .copilot import chat as copilot_chat_module
from .copilot import explain
from .copilot import service as copilot
from .data import halts as halt_detect
from .data import sectors
from .data.alpha_vantage import AlphaVantage, AVError, QuotaExceeded
from .data.loader import load_book
from .data.poller import QuotePoller
from .data.precompute import compute_all
from .data.yfinance import YFinance, YFinanceError
from .engine import calendar as cal
from .engine import funding as funding_engine
from .engine import leverage as leverage_engine
from .engine import replay as replay_engine
from .wallet import fetch_wallet_data, CHAIN_NAMES as WALLET_CHAIN_NAMES

log = logging.getLogger('mochaguard.api')


class PositionInput(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    qty: float = Field(allow_inf_nan=False)
    avg_price: float | None = Field(default=None, gt=0, allow_inf_nan=False)

    @field_validator('symbol')
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.strip().upper()


class AccountSyncInput(BaseModel):
    auth_user_id: str
    email: str
    display_name: str | None = None
    tz: str = 'UTC'
    cash: float = Field(allow_inf_nan=False)
    positions: list[PositionInput]


class WalletConnectInput(BaseModel):
    wallet_address: str = Field(min_length=42, max_length=42,
                                description='EVM address (0x-prefixed, 42 chars)')
    chain_id: int = Field(default=1, description='EVM chain ID (1=Ethereum, 137=Polygon, etc.)')

    @field_validator('wallet_address')
    @classmethod
    def normalize_address(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith('0x'):
            raise ValueError('wallet_address must start with 0x')
        return v.lower()


class WalletDisconnectInput(BaseModel):
    wallet_address: str = Field(min_length=42, max_length=42)
    chain_id: int = Field(default=1)

    @field_validator('wallet_address')
    @classmethod
    def normalize_address(cls, v: str) -> str:
        return v.strip().lower()


class LeverageInput(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    notional: float = Field(gt=0, le=1_000_000_000, allow_inf_nan=False)
    ts: datetime | None = None

    @field_validator('symbol')
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.strip().upper()


class EvaluateInput(BaseModel):
    ts: datetime | None = None


class ReplayInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    symbol: str = Field(min_length=1, max_length=32)
    session_date: date | None = Field(default=None, alias='date')

    @field_validator('symbol')
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.strip().upper()


class SessionReplayInput(BaseModel):
    '''Replay one whole session over the book and score the outcome.'''
    model_config = ConfigDict(populate_by_name=True)
    session_date: date | None = Field(default=None, alias='date')
    step_minutes: int = Field(default=15, ge=1, le=60)
    persist: bool = True


class AnchorInput(BaseModel):
    run_id: str = Field(default='', max_length=100)


class MarketRefreshInput(BaseModel):
    symbols: list[str] | None = None
    include_earnings: bool = True


class LiveService:
    def __init__(self) -> None:
        self.book = None
        self.latest = None
        self.auth = SupabaseAuth()
        self.av: AlphaVantage | None = None
        self.yf: YFinance | None = None
        self.poller: QuotePoller | None = None
        self.tasks: list[asyncio.Task] = []
        self._reload_lock = asyncio.Lock()
        self._evaluate_lock = asyncio.Lock()
        self._last_fingerprints: dict[str, str] = {}
        self._decision_ids: dict[tuple[str, str], int] = {}

    async def start(self) -> None:
        await db.init()
        if settings.run_migrations_on_start:
            await db.migrate()
        self.book = await load_book()
        if settings.alpha_vantage_api_key:
            self.av = AlphaVantage()
        if settings.yfinance_enabled:
            self.yf = YFinance()
        if self.av or self.yf:
            self.poller = QuotePoller(lambda: self.book, self.av, self.yf)
        if settings.intraday_backfill_on_start and await db.intraday_count() == 0:
            self.tasks.append(asyncio.create_task(self._backfill_intraday(), name='intraday-backfill'))
        if settings.scheduler_enabled:
            if self.poller:
                self.tasks.append(asyncio.create_task(self.poller.run(), name='quote-poller'))
            self.tasks.append(asyncio.create_task(self._evaluation_loop(), name='risk-evaluator'))
            if settings.chain_configured:
                self.tasks.append(asyncio.create_task(self._anchor_loop(), name='anchor-scheduler'))

    async def _backfill_intraday(self) -> None:
        if not self.yf and not (self.av and settings.alpha_vantage_premium):
            return
        for symbol in self.book.symbols:
            try:
                await self._backfill_symbol_intraday(symbol)
            except (AVError, QuotaExceeded, YFinanceError) as exc:
                log.warning('intraday backfill unavailable for %s: %s', symbol, exc)
        await self.reload_book()

    async def _backfill_symbol_intraday(self, symbol: str) -> int:
        if self.av and settings.alpha_vantage_premium:
            try:
                bars = await self.av.intraday(symbol, interval='5min', full=True)
                source = 'alpha_vantage'
            except (AVError, QuotaExceeded):
                if not self.yf:
                    raise
                bars = await self.yf.intraday(symbol)
                source = 'yfinance'
        elif self.yf:
            bars = await self.yf.intraday(symbol)
            source = 'yfinance'
        else:
            return 0
        written = await db.upsert_bars_intraday(symbol, bars, source=source)
        log.info('intraday backfill: %s bars for %s from %s', written, symbol, source)
        return written

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        for task in self.tasks:
            with suppress(asyncio.CancelledError):
                await task
        if self.av:
            await self.av.aclose()
        await self.auth.aclose()
        await db.close()

    def require_book(self):
        if self.book is None or not self.book.symbols:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail='Live market data is not loaded. Run scripts/seed_market.py first.')
        return self.book

    async def reload_book(self) -> None:
        async with self._reload_lock:
            self.book = await load_book()
            self.latest = None

    async def _evaluation_loop(self) -> None:
        while True:
            try:
                if self.book and self.book.symbols:
                    await self.evaluate(datetime.now(tz=timezone.utc), record=True)
            except Exception:  # noqa: BLE001
                log.exception('scheduled risk evaluation failed')
            await asyncio.sleep(max(15, settings.engine_evaluate_seconds))

    async def _anchor_loop(self) -> None:
        '''Sleep until anchor_hour_et (ET) each day, then commit the day's live decisions to Sepolia.'''
        tz_et = ZoneInfo('America/New_York')
        while True:
            try:
                now = datetime.now(tz=timezone.utc).astimezone(tz_et)
                target = now.replace(hour=settings.anchor_hour_et, minute=0, second=0, microsecond=0)
                if now >= target:
                    target = target + timedelta(days=1)
                wait_s = (target - now).total_seconds()
                log.info('anchor-scheduler: sleeping %.0fs until %s ET', wait_s, target.strftime('%Y-%m-%d %H:%M'))
                await asyncio.sleep(wait_s)
                batch_date = target.date()
                decisions = await db.decisions_for_day(batch_date, '')
                if decisions:
                    await publisher.anchor_day(batch_date, '')
                    log.info('anchor-scheduler: anchored %d live decisions for %s', len(decisions), batch_date)
                else:
                    log.info('anchor-scheduler: no live decisions for %s, skipping', batch_date)
            except publisher.AnchorUnavailable as exc:
                log.warning('anchor-scheduler: chain unavailable: %s', exc)
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                return
            except Exception:  # noqa: BLE001
                log.exception('anchor-scheduler failed')
                await asyncio.sleep(300)

    async def evaluate(self, ts: datetime | None = None, *, record: bool = False):
        book = self.require_book()
        now = (ts or datetime.now(tz=timezone.utc)).astimezone(timezone.utc)
        async with self._evaluate_lock:
            result = book.evaluate(now)
            for decision in result.decisions:
                row = decision.to_dict()
                decision.id = self._decision_ids.get((self._decision_key(row), self._fingerprint(row)))
            self.latest = result
        if record:
            asyncio.create_task(self._persist_evaluation(book, result), name='decision-log')
        return result

    async def _persist_evaluation(self, book, result) -> None:
        try:
            decision_rows = [decision.to_dict() for decision in result.decisions]
            current = {self._decision_key(row): self._fingerprint(row) for row in decision_rows}
            changed = [row for row in decision_rows
                       if self._last_fingerprints.get(self._decision_key(row)) != self._fingerprint(row)]
            ids = await db.log_decisions(changed)
            self._last_fingerprints = current
            for row, decision_id in zip(changed, ids):
                row['id'] = decision_id
                self._decision_ids[(self._decision_key(row), self._fingerprint(row))] = decision_id
            for decision in result.decisions:
                row = decision.to_dict()
                decision.id = self._decision_ids.get((self._decision_key(row), self._fingerprint(row)))
            await db.insert_snapshot(result.ts, result.phase, result.summary)
            if changed:
                await copilot.explain_decisions(book, result, changed)
                await copilot.ops_brief(result)
        except Exception:  # noqa: BLE001
            # An audit/narration failure must never affect the completed decision.
            log.exception('failed to persist downstream decision artifacts')

    @staticmethod
    def _decision_key(row: dict) -> str:
        return '|'.join((str(row.get('account_id') or 'book'), str(row.get('symbol') or 'account'), str(row.get('action'))))

    @staticmethod
    def _fingerprint(row: dict) -> str:
        facts = {'max_leverage': row.get('max_leverage'), 'adverse_move': row.get('adverse_move'),
                 'equity': row.get('equity'), 'margin_required': row.get('margin_required'),
                 'qty_to_reduce': row.get('qty_to_reduce'), 'reason': row.get('reason')}
        return json.dumps(facts, sort_keys=True, default=str, separators=(',', ':'))

    async def current_result(self):
        return await self.evaluate(record=False)

    async def account_for(self, principal: Principal) -> dict:
        account = await db.get_account_by_auth_user(principal.user_id)
        if account is None:
            account = await db.ensure_account(principal.email, principal.display_name, 'UTC', principal.user_id)
            await self.reload_book()
        return account

    async def refresh_market(self, symbols: list[str] | None, include_earnings: bool) -> dict:
        requested = [s.upper().strip() for s in (symbols or settings.symbols) if s and s.strip()]
        if not requested:
            raise HTTPException(status_code=422, detail='At least one symbol is required')
        await db.upsert_symbols([{'symbol': symbol, 'asset_type': 'equity'} for symbol in requested])
        bars_count = 0
        intraday_count = 0
        earnings_count = 0
        actions_count = 0
        sources: dict[str, str] = {}
        for symbol in requested:
            try:
                if self.av is None:
                    raise QuotaExceeded('Alpha Vantage is not configured')
                bars = await self.av.daily(symbol, full=True)
                splits = await self.av.splits(symbol)
                sources[symbol] = 'alpha_vantage'
            except (AVError, QuotaExceeded) as exc:
                if self.yf is None:
                    raise HTTPException(status_code=503, detail=str(exc)) from exc
                log.warning('%s: Alpha Vantage unavailable (%s); using Yahoo Finance history', symbol, exc)
                try:
                    bars = await self.yf.daily(symbol)
                    splits = await self.yf.splits(symbol)
                except YFinanceError as yf_exc:
                    raise HTTPException(status_code=503, detail=f'Market-data providers are unavailable: {yf_exc}') from yf_exc
                sources[symbol] = 'yfinance'
            bars_count += await db.upsert_bars_daily(symbol, bars)
            try:
                if self.av is not None and settings.alpha_vantage_premium:
                    try:
                        intraday = await self.av.intraday(symbol, interval='5min', full=True)
                        intraday_source = 'alpha_vantage'
                    except (AVError, QuotaExceeded):
                        if self.yf is None:
                            raise
                        intraday = await self.yf.intraday(symbol)
                        intraday_source = 'yfinance'
                elif self.yf is not None:
                    intraday = await self.yf.intraday(symbol)
                    intraday_source = 'yfinance'
                else:
                    intraday = []
                    intraday_source = 'none'
                intraday_count += await db.upsert_bars_intraday(symbol, intraday, source=intraday_source)
            except (AVError, QuotaExceeded, YFinanceError) as exc:
                log.warning('%s: intraday history unavailable (%s); retaining daily history', symbol, exc)
            actions_count += len(splits)
            await db.upsert_corporate_actions(symbol, splits)
            if include_earnings and self.av is not None and sources[symbol] == 'alpha_vantage':
                try:
                    earnings = await self.av.earnings_history(symbol)
                    earnings_count += len(earnings)
                    await db.upsert_earnings(symbol, earnings)
                except AVError as exc:
                    # yfinance does not provide a like-for-like report-time history. Keep prior
                    # earnings data and still refresh the price/risk side of the book.
                    log.warning('%s: Alpha Vantage earnings unavailable (%s); retaining existing earnings', symbol, exc)
        risks = await compute_all(requested)
        await self.reload_book()
        return {'symbols': requested, 'daily_bars_written': bars_count, 'intraday_bars_written': intraday_count,
            'earnings_written': earnings_count, 'corporate_actions_written': actions_count,
            'risk_rows_computed': len(risks), 'sources': sources}


@asynccontextmanager
async def lifespan(app: FastAPI):
    service = LiveService()
    app.state.service = service
    await service.start()
    try:
        yield
    finally:
        await service.stop()


app = FastAPI(title='Mochatrade Risk API', version='1.0.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True,
                   allow_methods=['GET', 'POST', 'PUT'], allow_headers=['Authorization', 'Content-Type', 'X-Internal-Key'])


def service_of(request: Request) -> LiveService:
    return request.app.state.service


async def accessible_account(account_id: str) -> dict:
    requested = await db.get_account(account_id)
    if requested is None:
        raise HTTPException(status_code=404, detail='Account not found')
    return requested


def decision_json(decision) -> dict:
    return decision.to_dict() if hasattr(decision, 'to_dict') else decision


def account_status(result, account_id: str) -> str:
    actions = [d.action for d in result.decisions if d.account_id == account_id]
    if 'close' in actions:
        return 'auto_derisk'
    return 'action_needed' if any(a in {'reduce', 'margin_call'} for a in actions) else 'safe'


@app.get('/health')
async def health(request: Request):
    service = service_of(request)
    return {'ok': True, 'database': settings.db_configured, 'market_loaded': bool(service.book and service.book.symbols),
            'alpha_vantage': bool(service.av), 'yfinance': bool(service.yf), 'chain_configured': settings.chain_configured}


@app.get('/me')
async def me(request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    account = await service_of(request).account_for(principal)
    return {'user_id': principal.user_id, 'email': principal.email, 'account_id': str(account['id'])}


@app.get('/dashboard/book')
async def dashboard_book(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    result = await service.current_result()
    brief = await db.latest_ops_brief(datetime.now(tz=timezone.utc) - timedelta(days=1))
    # Every decision carries its own plain-language reason, so no screen ever shows a bare
    # machine string like "equity=79432 margin_req=95000" to a person.
    decisions = [{**decision_json(d), 'plain': explain.explain_decision(decision_json(d))}
                 for d in result.decisions]
    return {'summary': result.summary, 'ops_brief': brief['body'] if brief else None,
            'plain': explain.explain_book(result.summary), 'decisions': decisions}


@app.get('/dashboard/accounts')
async def dashboard_accounts(request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    accounts = await db.list_accounts()
    result = await service.current_result()
    out = []
    for account in accounts:
        account_id = str(account['id'])
        if account_id not in service.require_book().acct_idx:
            continue
        view = service.book.account_view(account_id, result)
        out.append({'id': account_id, 'display_name': view['display_name'], 'tz': view['tz'], 'equity': view['equity'],
                    'status': account_status(result, account_id)})
    return out


@app.get('/tonight/{account_id}')
async def tonight(account_id: str, request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    account = await accessible_account(account_id)
    result = await service.current_result()
    if account_id not in service.require_book().acct_idx:
        raise HTTPException(status_code=404, detail='Account has no live portfolio in the risk book')
    view = service.book.account_view(account_id, result)
    decisions = [decision_json(d) for d in result.decisions if d.account_id == account_id or
                 (d.action == 'freeze' and any(p['symbol'] == d.symbol for p in view['positions']))]
    for decision in decisions:
        decision['plain'] = explain.explain_decision(decision, tz=view.get('tz'))
    saved = await db.recent_decisions(datetime.now(tz=timezone.utc) - timedelta(days=1), account_id)
    explanations = await db.explanations_for_decisions([int(d['id']) for d in saved])
    cards = []
    for decision in decisions:
        matching = next((old for old in saved if old.get('symbol') == decision.get('symbol') and old['action'] == decision['action']), None)
        explanation = explanations.get(int(matching['id'])) if matching else None
        if explanation:
            cards.append({'decision_id': explanation['decision_id'], 'symbol': decision.get('symbol'), 'action': decision['action'],
                          'headline': explanation['headline'], 'body': explanation['body'], 'action_hint': explanation['action_hint'],
                          'qty_to_reduce': decision.get('qty_to_reduce'), 'max_leverage': decision.get('max_leverage'),
                          'model': explanation['model']})
    # Perp carry: what each position costs to hold, and when funding alone would liquidate it.
    rate_of = funding_engine.FundingRate
    costs = []
    for row in view['positions']:
        rate = rate_of(row['symbol'], settings.funding_hourly_default)
        costs.append(funding_engine.assess(
            rate, symbol=row['symbol'], qty=row['qty'], price=row['price'], ts=result.ts,
            equity=view['equity'], margin_required=view['margin_required']))
    funding_rows = []
    for row, cost in zip(view['positions'], costs):
        described = funding_engine.describe(cost, view.get('tz') or 'UTC')
        funding_rows.append({
            'symbol': cost.symbol, 'side': cost.side, 'hourly_rate': rate_of(
                cost.symbol, settings.funding_hourly_default).hourly,
            'hourly_cost': cost.hourly_cost, 'daily_cost': cost.daily_cost,
            'cost_to_next_open': cost.cost_to_next_open,
            'hours_to_next_open': cost.hours_to_next_open,
            'hours_to_liquidation': cost.hours_to_liquidation,
            'liquidation_at': cost.liquidation_at.isoformat() if cost.liquidation_at else None,
            'when': funding_engine.humanise_hours(cost.hours_to_liquidation),
            'daily_share_of_buffer': cost.daily_share_of_buffer,
            'pays': cost.pays, 'plain': described})
        row['funding'] = funding_rows[-1]

    closure = {'hours': round(cal.closure_hours(result.ts), 2),
               'label': cal.closure_label(result.ts),
               'multiplier': round(cal.closure_multiplier(result.ts), 3)}

    # Why each position is risky, ranked, in plain language. "Reduce TSLA by 653 shares" is an
    # instruction; this is the reason behind it, so a trader can see which factor to act on.
    result.summary.setdefault('closure', closure)
    risk_rows = []
    for row in view['positions']:
        breakdown = explain.position_risk(row, view, result, tz=view.get('tz') or 'UTC')
        row['risk'] = breakdown
        risk_rows.append(breakdown)
    risk_rows.sort(key=lambda r: r['worst_case_loss'], reverse=True)

    digest = copilot.deterministic_tonight_digest(view, decisions, result)
    return {'account': view, 'as_of': result.ts.isoformat(), 'decisions': decisions,
            'cards': cards, 'funding': funding_rows,
            'funding_book': funding_engine.book_carry(costs), 'closure': closure,
            'risk': risk_rows, **digest}


@app.get('/desk/{account_id}')
async def desk(account_id: str, request: Request,
               _: Annotated[Principal, Depends(get_principal)], hours: int = 48):
    """Chart series for the trading desk: real price bars with the allowed-leverage overlay.

    One series per held symbol. ``max_leverage`` is recomputed at every bar with the engine's
    own rule for that timestamp, so the line steps down through the 15:30 ramp and sits at the
    overnight level while the market is shut -- the picture a trader needs to see *before* the
    bell, not a static number.
    """
    service = service_of(request)
    book = service.require_book()
    await accessible_account(account_id)
    if account_id not in book.acct_idx:
        raise HTTPException(status_code=404, detail='Account has no live portfolio in the risk book')

    result = await service.current_result()
    view = book.account_view(account_id, result)
    symbols = [row['symbol'] for row in view['positions']]
    if not symbols:
        return {'account_id': account_id, 'as_of': result.ts.isoformat(), 'series': []}

    hours = max(6, min(int(hours), 24 * 14))
    end = datetime.now(tz=timezone.utc)
    rows = await db.intraday_between(end - timedelta(hours=hours), end + timedelta(minutes=5), symbols)

    series = []
    for row in view['positions']:
        symbol = row['symbol']
        bars = rows.get(symbol) or []
        if not bars:
            continue
        # Cap the number of points so a two-week window stays a chart, not a payload.
        stride = max(1, len(bars) // 320)
        risk = book.symbol_risk(symbol)
        points = []
        for bar in bars[::stride]:
            ts = bar['ts']
            phase = cal.phase_at(ts)
            sector_mult, _, _ = book.sector_signal(symbol, ts)
            limit = leverage_engine.max_leverage(
                risk, float(row['notional']) or 10_000.0, phase, cal.ramp_fraction(ts),
                cal.has_earnings_tonight(symbol, ts, book.earnings),
                settings.safety, settings.headline_cap, sector_mult=sector_mult)
            frozen = (cal.is_halted(symbol, ts, book.halts)
                      or cal.to_et(ts).date() in book.splits.get(symbol, set()))
            points.append({'ts': ts.isoformat(), 'price': round(float(bar['close']), 4),
                           'max_leverage': 0.0 if frozen else limit.max_leverage,
                           'phase': phase.value, 'frozen': frozen})
        if not points:
            continue
        first, last = points[0]['price'], points[-1]['price']
        series.append({
            'symbol': symbol, 'points': points,
            'qty': row['qty'], 'notional': row['notional'], 'price': row['price'],
            'avg_price': row['avg_price'], 'unrealised_pnl': row['unrealised_pnl'],
            'unrealised_pct': row['unrealised_pct'],
            'max_leverage': row['max_leverage'], 'adverse_move': row['adverse_move'],
            'earnings_tonight': row['earnings_tonight'], 'frozen': row['frozen'],
            'window_change': round(last / first - 1.0, 6) if first else 0.0,
            'window_low': round(min(pt['price'] for pt in points), 4),
            'window_high': round(max(pt['price'] for pt in points), 4),
            'leverage_low': round(min(pt['max_leverage'] for pt in points), 2),
            'leverage_high': round(max(pt['max_leverage'] for pt in points), 2),
        })

    return {'account_id': account_id, 'as_of': result.ts.isoformat(), 'phase': result.phase,
            'headline_cap': settings.headline_cap, 'hours': hours, 'series': series}


@app.post('/leverage')
async def leverage(input: LeverageInput, request: Request, _: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    ts = input.ts or datetime.now(tz=timezone.utc)
    if ts.tzinfo is None:
        raise HTTPException(status_code=422, detail='ts must include a timezone offset')
    try:
        result = service.require_book().symbol_leverage(input.symbol, ts, input.notional)
    except KeyError:
        raise HTTPException(status_code=404, detail=f'{input.symbol} is not in the live risk universe') from None
    risk = service.book.symbol_risk(input.symbol)
    sector_mult, sector_note, peers = service.book.sector_signal(input.symbol, ts)
    # The explanation is computed, not generated: no model call, no network, always present.
    return {**result.__dict__, 'ramp': cal.ramp_fraction(ts),
            'sector': {'sector': sectors.sector_of(input.symbol), 'multiplier': round(sector_mult, 4),
                       'note': sector_note, 'peers': peers},
            'explanation': explain.explain_leverage(result, risk, input.notional, ts),
            'risk': {'symbol': risk.symbol, 'gap_p99': risk.gap_p99, 'intraday_p99': risk.intraday_p99,
                     'earnings_gap_p99': risk.earnings_gap_p99, 'adv_dollar': risk.adv_dollar}}


@app.post('/evaluate')
async def evaluate(input: EvaluateInput, request: Request, _: Annotated[Principal, Depends(get_principal)]):
    ts = input.ts
    if ts and ts.tzinfo is None:
        raise HTTPException(status_code=422, detail='ts must include a timezone offset')
    result = await service_of(request).evaluate(ts, record=True)
    return {'summary': result.summary, 'plain': explain.explain_book(result.summary),
            'decisions': [{**decision_json(d), 'plain': explain.explain_decision(decision_json(d))}
                          for d in result.decisions]}


@app.post('/replay')
async def replay(input: ReplayInput, request: Request, _: Annotated[Principal, Depends(get_principal)]):
    """Apply current rules to persisted, *actual* intraday bars; never creates trades or prices."""
    service = service_of(request)
    book = service.require_book()
    if input.symbol not in book.sym_idx:
        raise HTTPException(status_code=404, detail=f'{input.symbol} is not in the live risk universe')
    session_date = input.session_date or await db.latest_daily_date(input.symbol)
    if session_date is None:
        raise HTTPException(status_code=404, detail='No daily market history is available for this symbol')
    rows = (await db.intraday_between(cal.session_open(session_date), cal.session_close(session_date), [input.symbol])).get(input.symbol, [])
    if not rows:
        try:
            await service._backfill_symbol_intraday(input.symbol)
        except (AVError, QuotaExceeded, YFinanceError) as exc:
            raise HTTPException(status_code=503, detail=f'Intraday market history is unavailable: {exc}') from exc
        rows = (await db.intraday_between(cal.session_open(session_date), cal.session_close(session_date), [input.symbol])).get(input.symbol, [])
    if not rows:
        raise HTTPException(status_code=404, detail='No real intraday bars are available for this session.')
    risk = book.symbol_risk(input.symbol)
    points = []
    for row in rows:
        ts = row['ts']
        phase = cal.phase_at(ts)
        ramp = cal.ramp_fraction(ts)
        earnings = cal.has_earnings_tonight(input.symbol, ts, book.earnings)
        result = leverage_engine.max_leverage(risk, 10_000.0, phase, ramp, earnings, settings.safety, settings.headline_cap)
        frozen = cal.is_halted(input.symbol, ts, book.halts) or cal.to_et(ts).date() in book.splits.get(input.symbol, set())
        points.append({'ts': ts.isoformat(), 'price': round(float(row['close']), 4), 'max_leverage': result.max_leverage,
                       'phase': phase.value, 'ramp': round(ramp, 3), 'frozen': frozen})
    events = []
    ramp_point = next((point for point in points if point['phase'] == 'closing_ramp'), None)
    if ramp_point:
        events.append({'ts': ramp_point['ts'], 'kind': 'ramp_start', 'symbol': input.symbol, 'account_id': None,
                       'decision_id': None, 'qty': None, 'fill_price': None, 'slippage_bps': None,
                       'note': 'The actual session entered the 3:30 PM ET overnight-risk ramp.'})
    if any(point['frozen'] for point in points):
        first = next(point for point in points if point['frozen'])
        events.append({'ts': first['ts'], 'kind': 'freeze', 'symbol': input.symbol, 'account_id': None,
                       'decision_id': None, 'qty': None, 'fill_price': None, 'slippage_bps': None,
                       'note': 'A recorded halt or corporate action froze risk actions for this symbol.'})
    first, last = points[0], points[-1]
    return {'date': session_date.isoformat(), 'symbol': input.symbol, 'symbols': book.symbols, 'points': points,
            'events': events, 'summary': {'date': session_date.isoformat(), 'bars': len(points),
                                           'open_price': first['price'], 'close_price': last['price'],
                                           'price_change': round(last['price'] / first['price'] - 1, 6) if first['price'] else 0,
                                           'min_allowed_leverage': min(point['max_leverage'] for point in points),
                                           'close_allowed_leverage': last['max_leverage']}}


@app.post('/replay/session')
async def replay_session(input: SessionReplayInput, request: Request,
                         _: Annotated[Principal, Depends(get_principal)]):
    """Job 3 end to end: step a real session, hold through the gap, unwind at the open, score it.

    Runs on a *clone* of the live book so the replay can mutate positions and cash without
    touching live state. The next session's open is used only to score decisions that were
    already made -- the engine never sees it while deciding.
    """
    service = service_of(request)
    book = service.require_book()
    session_date = input.session_date
    if session_date is None:
        session_date = await db.latest_daily_date_any()
    if session_date is None:
        raise HTTPException(status_code=503, detail='No daily market history is loaded. Run scripts/seed_market.py.')
    if not cal.is_trading_day(session_date):
        raise HTTPException(status_code=422, detail=f'{session_date} is not a trading day')

    next_open = await db.next_open_prices(book.symbols, session_date)
    missing = [s for s in book.symbols if s not in next_open]
    if len(missing) == len(book.symbols):
        raise HTTPException(
            status_code=404,
            detail=(f'No recorded open after {session_date} for any symbol. Replay scores the gap '
                    f'against the next session, so a later trading day must be seeded.'))

    clone = book.clone()
    prices = clone.last_close.copy()
    for i, symbol in enumerate(clone.symbols):
        if symbol in next_open:
            prices[i] = next_open[symbol]

    run_id = f'replay-{session_date.isoformat()}-{uuid.uuid4().hex[:8]}'
    result = await asyncio.to_thread(replay_engine.run_session, clone, session_date, prices,
                                     run_id=run_id, step_minutes=input.step_minutes)

    steps = [{'ts': st.ts.isoformat(), 'phase': st.phase, 'ramp': st.ramp,
              'accounts_at_risk': st.summary['accounts_at_risk'], 'reduce': st.summary['reduce'],
              'margin_call': st.summary['margin_call'], 'close': st.summary['close'],
              'gross_exposure': st.summary['gross_exposure'], 'net_equity': st.summary['net_equity'],
              'avg_leverage_used': st.summary['avg_leverage_used'],
              'worst_case_loss': st.summary['worst_case_loss']} for st in result.steps]
    next_session = cal.next_trading_day(session_date).isoformat()
    summary = {'run_id': run_id, 'session_date': session_date.isoformat(),
               'next_session': next_session,
               'steps': len(steps), 'decisions': len(result.decisions), 'fills': len(result.fills),
               'auto_derisk_fills': sum(1 for f in result.fills if f['kind'] == 'auto_derisk'),
               'unwind_fills': sum(1 for f in result.fills if f['kind'] == 'open_unwind'),
               'symbols_missing_next_open': missing, 'scores': result.scores, 'timeline': steps,
               'plain': explain.explain_scores(result.scores, session_date=session_date.isoformat(),
                                               next_session=next_session)}

    if input.persist:
        try:
            ids = await db.log_decisions(result.decisions, run_id=run_id)
            for decision, decision_id in zip(result.decisions, ids):
                decision['id'] = decision_id
            await db.insert_liquidations(result.fills, run_id=run_id)
            await db.save_replay(run_id, session_date, summary, result.events, result.series)
            # Anchor the replay's decisions to Sepolia as a background task so the response
            # is not blocked by a chain round-trip.  Failures are logged, never surfaced here.
            if settings.chain_configured and ids:
                asyncio.create_task(
                    _anchor_replay_safe(session_date, run_id),
                    name=f'anchor-replay-{run_id}',
                )
        except Exception:  # noqa: BLE001
            log.exception('replay persistence failed for %s', run_id)

    # Fills are persisted in full; the response carries a bounded sample so a 2,000-account
    # replay does not return a multi-megabyte payload to a dashboard.
    return {**summary, 'events': result.events, 'series': result.series,
            'fill_sample': result.fills[:50]}


@app.get('/replay/runs')
async def replay_runs(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    return {'runs': [{'run_id': r['run_id'], 'session_date': r['session_date'].isoformat(),
                      'created_at': r['created_at'].isoformat(),
                      'scores': (r['summary'] or {}).get('scores')} for r in await db.list_replays()]}


@app.get('/replay/runs/{run_id}')
async def replay_run(run_id: str, request: Request, _: Annotated[Principal, Depends(get_principal)]):
    row = await db.get_replay(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail='No replay run with that id')
    return {'run_id': row['run_id'], 'session_date': row['session_date'].isoformat(),
            **(row['summary'] or {}), 'events': row['events'], 'series': row['series']}


async def _anchor_replay_safe(batch_date: date, run_id: str) -> None:
    '''Background helper: anchor a persisted replay without blocking the HTTP response.'''
    try:
        await publisher.anchor_day(batch_date, run_id)
        log.info('replay anchor complete: %s / %s', batch_date, run_id)
    except publisher.AnchorUnavailable as exc:
        log.warning('replay anchor unavailable for %s/%s: %s', batch_date, run_id, exc)
    except Exception:  # noqa: BLE001
        log.exception('replay anchor failed for %s/%s', batch_date, run_id)


@app.get('/anchor/status')
async def anchor_status(_: Annotated[Principal, Depends(get_principal)]):
    '''Recent anchor batches — shows judges the last few on-chain commitments at a glance.'''
    batches = await db.recent_anchor_batches(limit=10)
    out = []
    for b in batches:
        tx = b.get('tx_hash')
        out.append({
            'id': b['id'],
            'batch_date': b['batch_date'].isoformat() if b.get('batch_date') else None,
            'run_id': b.get('run_id', ''),
            'merkle_root': b.get('merkle_root'),
            'decision_count': b.get('decision_count'),
            'tx_hash': tx,
            'contract_address': b.get('contract_address'),
            'anchored_at': b['anchored_at'].isoformat() if b.get('anchored_at') else None,
            'error': b.get('error'),
            'created_at': b['created_at'].isoformat() if b.get('created_at') else None,
            'etherscan_url': f'https://sepolia.etherscan.io/tx/{tx}' if tx else None,
        })
    contract = settings.contract_address if settings.chain_configured else None
    return {
        'batches': out,
        'chain_configured': settings.chain_configured,
        'contract_address': contract,
        'contract_url': f'https://sepolia.etherscan.io/address/{contract}' if contract else None,
    }


@app.post('/anchor/{batch_date}')
async def anchor(batch_date: date, input: AnchorInput, _: Annotated[Principal, Depends(get_principal)]):
    try:
        row = await publisher.anchor_day(batch_date, input.run_id)
    except (ValueError, publisher.AnchorUnavailable) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {'batch_id': row['id'], 'batch_date': row['batch_date'].isoformat(), 'merkle_root': row['merkle_root'],
            'tx_hash': row.get('tx_hash'), 'contract_address': row.get('contract_address')}


@app.get('/verify/{decision_id}')
async def verify(decision_id: int, request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    payload = await publisher.verify_decision(decision_id)
    decision = payload.get('decision')
    if decision:
        payload['plain'] = explain.explain_decision(decision)
    payload['plain_proof'] = explain.explain_verification(payload)
    return payload


@app.get('/market/symbols')
async def market_symbols(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    return {'symbols': service_of(request).require_book().symbols}


@app.get('/market/{kind}')
async def market(kind: str, request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    query = dict(request.query_params)
    try:
        if service.av is None:
            raise QuotaExceeded('Alpha Vantage is not configured')
        data = await service.av.market_query(kind, **query)
        source = 'alpha_vantage'
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AVError as exc:
        if service.yf is None:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        try:
            data = await service.yf.market_query(kind, **query)
            source = 'yfinance'
        except YFinanceError as yf_exc:
            raise HTTPException(status_code=503, detail=f'Live market data unavailable: {yf_exc}') from yf_exc
    return {'source': source, 'retrieved_at': datetime.now(tz=timezone.utc).isoformat(), 'data': data}


@app.post('/admin/market/refresh')
async def refresh_market(input: MarketRefreshInput, request: Request, _: Annotated[Principal, Depends(get_principal)]):
    return await service_of(request).refresh_market(input.symbols, input.include_earnings)


@app.post('/admin/halts/detect')
async def detect_halts(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    """Scan the stored tape for halts and record them.

    A halt is a stopped tape, not a calm one: consecutive unchanged prints with no volume during
    regular hours. Marking them is what lets the freeze guard refuse to liquidate into a stale
    price on real data.
    """
    service = service_of(request)
    result = await halt_detect.detect_all(service.require_book().symbols)
    await service.reload_book()
    return result


@app.post('/admin/sectors/refresh')
async def refresh_sectors(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    """Pull the latest completed session move for every foreign sector peer.

    These are the markets that trade while the US is shut (TSMC, SK Hynix, ASML, Nifty, Nikkei).
    Overnight leverage widens when a symbol's sector has already moved hard somewhere else.
    """
    result = await sectors.refresh_sector_moves()
    await service_of(request).reload_book()
    return result


@app.get('/sectors')
async def sector_state(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    """Current sector-peer picture and the multiplier each held symbol is carrying."""
    service = service_of(request)
    book = service.require_book()
    now = datetime.now(tz=timezone.utc)
    out = []
    for symbol in book.symbols:
        mult, note, peers = book.sector_signal(symbol, now)
        if not peers:
            continue
        out.append({'symbol': symbol, 'sector': sectors.sector_of(symbol),
                    'multiplier': round(mult, 4), 'note': note, 'peers': peers})
    return {'as_of': now.isoformat(), 'symbols': out}


@app.post('/internal/accounts/sync')
async def sync_account(input: AccountSyncInput, request: Request, x_internal_key: Annotated[str | None, Header()] = None):
    if not settings.internal_api_key or x_internal_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail='Valid X-Internal-Key is required')
    account = await db.ensure_account(input.email, input.display_name, input.tz, input.auth_user_id)
    await db.update_account(str(account['id']), cash=input.cash, tz=input.tz, display_name=input.display_name)
    await db.replace_positions(str(account['id']), [position.model_dump() for position in input.positions])
    await service_of(request).reload_book()
    return {'account_id': str(account['id']), 'positions_synced': len(input.positions)}


# ─────────────────────────────────────────────────────── wallet integration ──

@app.post('/wallet/connect')
async def wallet_connect(
    input: WalletConnectInput,
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
):
    """Connect a real EVM wallet: fetch on-chain balances via Alchemy, price via CoinGecko,
    compute risk parameters, and push everything into the user's account in one shot."""
    if not settings.alchemy_api_key or not settings.coingecko_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Wallet integration is not configured on this server (missing ALCHEMY_API_KEY or COINGECKO_API_KEY)',
        )

    service    = service_of(request)
    account    = await service.account_for(principal)
    account_id = str(account['id'])

    try:
        wallet_data = await fetch_wallet_data(
            input.wallet_address,
            input.chain_id,
            settings.alchemy_api_key,
            settings.coingecko_api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        log.error('Wallet fetch failed for %s: %s', input.wallet_address, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f'Failed to fetch wallet data: {exc}',
        )

    # ── Persist everything through the existing DB layer ─────────────────────
    if wallet_data['symbols_to_upsert']:
        await db.upsert_symbols(wallet_data['symbols_to_upsert'])

    for symbol, bars in wallet_data['daily_bars'].items():
        await db.upsert_bars_daily(symbol, bars)

    for symbol, bars in wallet_data['intraday_bars'].items():
        await db.upsert_bars_intraday(symbol, bars, source='coingecko')

    if wallet_data['risk_rows']:
        await db.upsert_symbol_risk(wallet_data['risk_rows'])

    positions_for_db = [
        {'symbol': p['symbol'], 'qty': p['qty'], 'avg_price': p.get('avg_price')}
        for p in wallet_data['positions']
    ]
    await db.replace_positions(account_id, positions_for_db)
    await db.update_account(account_id, cash=wallet_data['cash_usd'])
    await db.save_wallet_connection(account_id, input.wallet_address, input.chain_id)

    # Reload book so the risk engine immediately evaluates the new positions
    await service.reload_book()

    return {
        'account_id':       account_id,
        'positions_synced': len(positions_for_db),
        **wallet_data['summary'],
    }


@app.get('/wallet/connections')
async def wallet_connections(
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
):
    """List all wallets the current user has connected."""
    service    = service_of(request)
    account    = await service.account_for(principal)
    account_id = str(account['id'])
    rows = await db.get_wallet_connections(account_id)
    # Serialize datetimes for JSON
    return [
        {
            **r,
            'connected_at': r['connected_at'].isoformat() if r.get('connected_at') else None,
            'last_synced':  r['last_synced'].isoformat()  if r.get('last_synced')  else None,
            'chain_name':   WALLET_CHAIN_NAMES.get(r['chain_id'], f"chain-{r['chain_id']}"),
        }
        for r in rows
    ]


@app.post('/wallet/disconnect')
async def wallet_disconnect(
    input: WalletDisconnectInput,
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
):
    """Disconnect a wallet. Does NOT wipe positions — call /wallet/connect on another wallet to replace them."""
    service    = service_of(request)
    account    = await service.account_for(principal)
    account_id = str(account['id'])
    await db.delete_wallet_connection(account_id, input.wallet_address, input.chain_id)
    return {'ok': True, 'wallet_address': input.wallet_address, 'chain_id': input.chain_id}


# ── Copilot chat ──────────────────────────────────────────────────────────────

class ChatMessageInput(BaseModel):
    role: str
    content: Any  # str | list[dict] for multimodal (text + image_url)


class ChatInput(BaseModel):
    messages: list[ChatMessageInput]
    account_id: str | None = None


@app.post('/copilot/chat')
async def copilot_chat_endpoint(
    body: ChatInput,
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
):
    """Streaming chat with the MochaGuard copilot.

    Accepts a conversation history and an optional account_id so the copilot can answer
    specific questions about live positions. Returns SSE tokens as they stream from Groq.
    The risk engine's decisions are never modified here; this is narration only.
    """
    service = service_of(request)

    # Inject live account context when available so the copilot can reference real numbers.
    context_lines: list[str] = []
    if body.account_id:
        try:
            result = await service.current_result()
            view = service.book.account_view(str(body.account_id), result)
            context_lines += [
                f"Trader: {view.get('display_name') or 'Anonymous'}",
                f"Equity: ${view.get('equity', 0):,.0f}",
                f"Margin Required: ${view.get('margin_required', 0):,.0f}",
                f"Gross Exposure: ${view.get('gross_exposure', 0):,.0f}",
                f"Leverage Used: {view.get('leverage_used') or 0:.1f}x",
                f"Worst-Case Loss (p99 gap): ${view.get('worst_case_loss', 0):,.0f}",
            ]
            positions = view.get('positions') or []
            if positions:
                context_lines.append(f"Open Positions ({len(positions)}):")
                for p in positions:
                    context_lines.append(
                        f"  {p['symbol']}: qty={p['qty']:,.0f} @ ${p['price']:,.2f}"
                        f" | notional=${p['notional']:,.0f}"
                        f" | max_leverage={p['max_leverage']:.1f}x"
                        f" | adverse_move={p['adverse_move'] * 100:.1f}%"
                        + (' | EARNINGS TONIGHT' if p.get('earnings_tonight') else '')
                        + (' | FROZEN' if p.get('frozen') else '')
                    )
        except Exception as exc:
            log.debug('Could not inject account context for %s: %s', body.account_id, exc)

    context = '\n'.join(context_lines) if context_lines else None
    messages = [m.model_dump() for m in body.messages]

    async def event_stream():
        async for token in copilot_chat_module.stream_chat(messages, context=context):
            yield f'data: {json.dumps({"token": token})}\n\n'
        yield 'data: [DONE]\n\n'

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )
