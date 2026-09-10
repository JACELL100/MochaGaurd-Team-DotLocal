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
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import db
from .anchor import publisher
from .auth import Principal, SupabaseAuth, get_principal
from .config import settings
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
from .engine import leverage as leverage_engine
from .engine import replay as replay_engine

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
        self._background_tasks: set[asyncio.Task] = set()
        self._reload_lock = asyncio.Lock()
        self._evaluate_lock = asyncio.Lock()
        self._persist_lock = asyncio.Lock()
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

    async def _backfill_intraday(self) -> None:
        if not self.yf and not (self.av and settings.alpha_vantage_premium):
            return
        book = self.require_book()
        for symbol in book.symbols:
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
        if self._background_tasks:
            _, pending = await asyncio.wait(
                set(self._background_tasks), timeout=settings.llm_timeout_s + 2.0,
            )
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        if self.av:
            await self.av.aclose()
        await self.auth.aclose()
        await copilot.close()
        await db.close()

    def _start_background(self, coro, *, name: str) -> None:
        task = asyncio.create_task(coro, name=name)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

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
            except Exception:
                log.exception('scheduled risk evaluation failed')
            await asyncio.sleep(max(15, settings.engine_evaluate_seconds))

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
            self._start_background(self._persist_evaluation(book, result), name='decision-log')
        return result

    async def _persist_evaluation(self, book, result) -> None:
        async with self._persist_lock:
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
                await copilot.ensure_daily_briefs(book, result)
            except Exception:
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
            'alpha_vantage': bool(service.av), 'yfinance': bool(service.yf), 'groq': bool(settings.groq_api_key),
            'chain_configured': settings.chain_configured}


@app.get('/me')
async def me(request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    account = await service_of(request).account_for(principal)
    return {'user_id': principal.user_id, 'email': principal.email, 'account_id': str(account['id'])}


@app.get('/dashboard/book')
async def dashboard_book(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    result = await service.current_result()
    brief = await copilot.ops_brief_for_request(service.require_book(), result)
    if brief is None:
        brief = copilot.deterministic_ops_brief(service.require_book(), result)
    # Every decision carries its own plain-language reason, so no screen ever shows a bare
    # machine string like "equity=79432 margin_req=95000" to a person.
    decisions = [{**decision_json(d), 'plain': explain.explain_decision(decision_json(d))}
                 for d in result.decisions]
    return {'summary': result.summary, 'ops_brief': brief['body'],
            'ops_brief_model': brief.get('model', 'template'),
            'plain': explain.explain_book(result.summary), 'decisions': decisions}


@app.get('/dashboard/accounts')
async def dashboard_accounts(request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    accounts = await db.list_accounts()
    result = await service.current_result()
    book = service.require_book()
    out = []
    for account in accounts:
        account_id = str(account['id'])
        if account_id not in book.acct_idx:
            continue
        view = book.account_view(account_id, result)
        out.append({'id': account_id, 'display_name': view['display_name'], 'tz': view['tz'], 'equity': view['equity'],
                    'status': account_status(result, account_id)})
    return out


@app.get('/tonight/{account_id}')
async def tonight(account_id: str, request: Request, principal: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    await accessible_account(account_id)
    result = await service.current_result()
    book = service.require_book()
    if account_id not in book.acct_idx:
        raise HTTPException(status_code=404, detail='Account has no live portfolio in the risk book')
    view = book.account_view(account_id, result)
    decisions = copilot.decisions_for_account(book, result, account_id, view)
    for decision in decisions:
        decision['plain'] = explain.explain_decision(decision, tz=view.get('tz'))

    symbols = [position['symbol'] for position in view['positions']]
    saved = await db.latest_relevant_decisions(account_id, symbols)
    explanations = await db.explanations_for_decisions([int(row['id']) for row in saved], account_id)
    cards = []
    for decision in decisions:
        matching = next((row for row in saved
                         if row.get('symbol') == decision.get('symbol')
                         and row['action'] == decision['action']
                         and service._fingerprint(row) == service._fingerprint(decision)), None)
        explanation = explanations.get(int(matching['id'])) if matching else None
        if matching and decision.get('id') is None:
            decision['id'] = matching['id']
        card = copilot.deterministic_decision_card(decision, view, result.ts)
        if explanation:
            card.update({
                'decision_id': explanation['decision_id'],
                'headline': explanation['headline'],
                'body': explanation['body'],
                'action_hint': explanation['action_hint'],
                'model': explanation['model'],
            })
        cards.append(card)

    digest = copilot.deterministic_tonight_digest(view, decisions, result)
    brief_date = cal.to_et(result.ts).date()
    saved_digest = await db.daily_digest(account_id, brief_date)
    if saved_digest is None and copilot.digest_due(result.ts):
        saved_digest = await copilot.ensure_account_digest(view, decisions, result)
    if saved_digest:
        digest.update({
            'headline': saved_digest['headline'],
            'summary': saved_digest['body'],
            'model': saved_digest['model'],
        })
    return {'account': view, 'as_of': result.ts.isoformat(), 'decisions': decisions, 'cards': cards, **digest}


@app.get('/ops/daily-brief')
async def daily_ops_brief(request: Request, _: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    result = await service.current_result()
    brief = await copilot.ops_brief_for_request(service.require_book(), result)
    if brief is None:
        brief = {
            **copilot.deterministic_ops_brief(service.require_book(), result),
            'ts': result.ts,
            'brief_date': cal.to_et(result.ts).date(),
        }
    return {
        'date': str(brief.get('brief_date') or cal.to_et(result.ts).date()),
        'as_of': (brief.get('ts') or result.ts).isoformat(),
        'headline': brief.get('headline') or 'Daily risk brief',
        'body': brief['body'],
        'model': brief.get('model') or 'template',
    }


@app.post('/leverage')
async def leverage(input: LeverageInput, request: Request, _: Annotated[Principal, Depends(get_principal)]):
    service = service_of(request)
    ts = input.ts or datetime.now(tz=timezone.utc)
    if ts.tzinfo is None:
        raise HTTPException(status_code=422, detail='ts must include a timezone offset')
    book = service.require_book()
    try:
        result = book.symbol_leverage(input.symbol, ts, input.notional)
    except KeyError:
        raise HTTPException(status_code=404, detail=f'{input.symbol} is not in the live risk universe') from None
    risk = book.symbol_risk(input.symbol)
    sector_mult, sector_note, peers = book.sector_signal(input.symbol, ts)
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
        except Exception:
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
