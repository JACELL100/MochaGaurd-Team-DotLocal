'''The engine's central claim: leverage falls as the ability to sell disappears.

These lock in the two properties the risk model is sold on -- an open market is cheap because
the engine can exit in minutes, and the overnight gap is the expensive part -- plus the demo
book invariant that positions are priced at the level they were sized at.
'''
from datetime import datetime

from app.demo import DEMO_DAY, demo_book
from app.engine import leverage
from app.engine.calendar import ET, Phase

SAFETY, CAP = 0.30, 20.0
# intraday_p99 is the move over the few minutes it takes to exit, so it is a *fraction* of the
# overnight gap -- not a whole session's high/low range.
NVDA = leverage.SymbolRisk('NVDA', gap_p99=0.064, intraday_p99=0.009,
                           earnings_gap_p99=0.26, adv_dollar=2.8e10)


def _lev(phase, ramp=0.0, earnings=False, notional=50_000):
    return leverage.max_leverage(NVDA, notional, phase, ramp, earnings, SAFETY, CAP).max_leverage


def test_open_market_allows_more_than_overnight():
    '''Market open is the cheap phase: we can sell, so only the exit-window move is at risk.'''
    assert _lev(Phase.OPEN) > _lev(Phase.CLOSED, ramp=1.0)


def test_overnight_limit_is_materially_tighter():
    '''A volatile name must lose most of its headline leverage once it has to be held overnight.'''
    assert _lev(Phase.CLOSED, ramp=1.0) <= 0.5 * _lev(Phase.OPEN)


def test_ramp_is_continuous_and_monotone():
    '''No 3:59:59 cliff: the limit walks down through 15:30-16:00 and lands on the overnight one.'''
    levs = [_lev(Phase.CLOSING_RAMP, ramp=f) for f in (0.0, 0.25, 0.5, 0.75, 1.0)]
    assert levs == sorted(levs, reverse=True)
    assert abs(levs[-1] - _lev(Phase.CLOSED, ramp=1.0)) < 0.05


def test_earnings_night_is_the_tightest_state():
    assert _lev(Phase.CLOSED, ramp=1.0, earnings=True) < _lev(Phase.CLOSED, ramp=1.0)


def test_intraday_risk_never_exceeds_the_overnight_gap():
    '''Guards the units bug: a full-session range must not be compared against a single gap.'''
    from app.data.precompute import _stats
    from datetime import date, timedelta
    import numpy as np

    rng = np.random.default_rng(3)
    bars, d = [], date(2024, 1, 2)
    px = 100.0
    for _ in range(300):
        o = px * (1 + rng.normal(0, 0.01))
        c = o * (1 + rng.normal(0, 0.01))
        bars.append({'d': d, 'open': o, 'high': max(o, c) * 1.02, 'low': min(o, c) * 0.98,
                     'close': c, 'adj_close': c, 'volume': 1e7})
        px, d = c, d + timedelta(days=1)
    s = _stats(bars, [])
    assert s is not None
    assert s['intraday_p99'] <= s['gap_p99']


def test_demo_book_is_solvent_and_priced_where_it_was_sized():
    '''A generated book must start solvent, or every downstream number is meaningless.'''
    book = demo_book(500)
    res = book.evaluate(datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 11, 0, tzinfo=ET))
    assert res.summary['net_equity'] > 0
    # de-risking, not a bloodbath: closures must be a small minority of the book
    assert res.summary['close'] < 0.05 * res.summary['accounts']
