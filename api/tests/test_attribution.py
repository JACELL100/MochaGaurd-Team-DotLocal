'''Leverage attribution: the waterfall behind "why only this much?".

The single property that matters: the steps must reconcile. cap - sum(lost) has to equal the
limit actually granted, for every input. A waterfall that does not add up is worse than no
waterfall, because it invites the reader to trust a picture that is wrong.
'''
from datetime import datetime

import pytest

from app.config import settings
from app.copilot import explain
from app.demo import DEMO_DAY, demo_book
from app.engine.calendar import ET

CASES = [
    ('SPY', 11, 0, 50_000),              # midday mega cap: near the cap
    ('SPY', 20, 0, 50_000),              # overnight
    ('SPY', 20, 0, 2_000_000_000),       # whale: size dominates
    ('NVDA', 11, 0, 50_000),
    ('NVDA', 15, 45, 50_000),            # mid-ramp
    ('NVDA', 20, 0, 50_000),             # earnings night in the demo fixture
    ('GME', 11, 0, 50_000),              # split freeze
    ('SMCI', 20, 0, 5_000_000),
    ('COIN', 6, 0, 100_000),             # pre-market thin tape
]


@pytest.mark.parametrize('symbol,hour,minute,notional', CASES)
def test_waterfall_reconciles(symbol, hour, minute, notional):
    book = demo_book(60)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, hour, minute, tzinfo=ET)
    result = book.symbol_leverage(symbol, ts, notional)
    attr = explain.leverage_attribution(result, book.symbol_risk(symbol), notional)

    assert attr['cap'] == settings.headline_cap
    assert attr['granted'] == result.max_leverage
    lost = sum(step['lost'] for step in attr['steps'])
    assert attr['cap'] - lost == pytest.approx(attr['granted'], abs=0.011), attr['steps']


@pytest.mark.parametrize('symbol,hour,minute,notional', CASES)
def test_steps_are_monotone_and_positive(symbol, hour, minute, notional):
    '''Each step removes leverage and the running remainder only ever falls.'''
    book = demo_book(60)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, hour, minute, tzinfo=ET)
    result = book.symbol_leverage(symbol, ts, notional)
    attr = explain.leverage_attribution(result, book.symbol_risk(symbol), notional)
    remaining = [attr['cap']] + [s['remaining'] for s in attr['steps']]
    assert remaining == sorted(remaining, reverse=True), remaining
    assert all(s['lost'] > 0 for s in attr['steps'])


def test_utilisation_is_the_share_of_the_cap_granted():
    book = demo_book(40)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 11, 0, tzinfo=ET)
    result = book.symbol_leverage('SPY', ts, 50_000)
    attr = explain.leverage_attribution(result, book.symbol_risk('SPY'), 50_000)
    assert attr['utilisation'] == pytest.approx(attr['granted'] / attr['cap'], abs=1e-4)
    assert 0.0 <= attr['utilisation'] <= 1.0


def test_frozen_symbol_attributes_everything_to_the_freeze():
    book = demo_book(40)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 11, 0, tzinfo=ET)
    result = book.symbol_leverage('GME', ts, 50_000)      # synthetic split day
    assert result.frozen
    attr = explain.leverage_attribution(result, book.symbol_risk('GME'), 50_000)
    assert attr['granted'] == 0.0
    assert attr['utilisation'] == 0.0
    assert [s['kind'] for s in attr['steps']] == ['freeze']
    assert attr['steps'][0]['lost'] == attr['cap']


def test_market_closure_is_reported_separately_from_volatility(monkeypatch):
    '''The 17.5-hour blind spot is the product thesis; it must not be folded into "volatility".'''
    monkeypatch.setattr(settings, 'safety', 0.30)
    book = demo_book(40)
    night = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 20, 0, tzinfo=ET)
    result = book.symbol_leverage('AAPL', night, 50_000)
    attr = explain.leverage_attribution(result, book.symbol_risk('AAPL'), 50_000)
    kinds = [s['kind'] for s in attr['steps']]
    assert 'phase' in kinds, kinds
    assert 'volatility' in kinds, kinds

    # ... and it must be absent while the market is open, where we *can* sell.
    day = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 11, 0, tzinfo=ET)
    open_attr = explain.leverage_attribution(
        book.symbol_leverage('AAPL', day, 50_000), book.symbol_risk('AAPL'), 50_000)
    assert 'phase' not in [s['kind'] for s in open_attr['steps']]


def test_size_dominates_for_a_whale_ticket():
    book = demo_book(40)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 20, 0, tzinfo=ET)
    result = book.symbol_leverage('SPY', ts, 2_000_000_000)
    attr = explain.leverage_attribution(result, book.symbol_risk('SPY'), 2_000_000_000)
    biggest = max(attr['steps'], key=lambda s: s['lost'])
    assert biggest['kind'] in {'slippage', 'concentration'}, attr['steps']


def test_every_step_carries_a_human_explanation():
    book = demo_book(40)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 20, 0, tzinfo=ET)
    for symbol in ('NVDA', 'SPY', 'SMCI'):
        attr = explain.leverage_attribution(
            book.symbol_leverage(symbol, ts, 50_000), book.symbol_risk(symbol), 50_000)
        for step in attr['steps']:
            assert step['label'] and step['detail']
            assert len(step['detail']) > 40
            # no machine syntax leaking into prose
            assert 'p99=' not in step['detail'] and 'adverse=' not in step['detail']
