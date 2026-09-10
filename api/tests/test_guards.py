from datetime import datetime, timedelta

from app.engine import guards
from app.engine.calendar import ET

TS = datetime(2025, 5, 28, 14, 0, tzinfo=ET)


def snap(**kw):
    base = dict(symbol='X', last_price=100.0, last_price_ts=TS, prev_close=100.0)
    base.update(kw)
    return guards.SymbolSnapshot(**base)


def test_normal_symbol_not_frozen():
    assert not guards.check(snap(), TS).frozen


def test_split_day_freezes():
    # a 4-for-1 split looks like a -75% crash on unadjusted data: must freeze, never liquidate
    r = guards.check(snap(last_price=25.0, split_today=True), TS)
    assert r.frozen and 'split_effective' in r.reasons


def test_halt_freezes():
    r = guards.check(snap(halted=True), TS)
    assert r.frozen and 'halted' in r.reasons


def test_stale_price_freezes_in_session():
    r = guards.check(snap(last_price_ts=TS - timedelta(minutes=20)), TS)
    assert r.frozen and 'stale_price' in r.reasons


def test_stale_price_ignored_when_closed():
    closed = datetime(2025, 5, 28, 20, 0, tzinfo=ET)
    r = guards.check(snap(last_price_ts=closed - timedelta(hours=3)), closed)
    assert not r.frozen


def test_implausible_move_freezes_unless_earnings():
    assert guards.check(snap(last_price=55.0), TS).frozen
    assert not guards.check(snap(last_price=55.0, earnings_window=True), TS).frozen
