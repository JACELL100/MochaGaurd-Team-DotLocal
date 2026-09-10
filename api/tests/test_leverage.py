from datetime import datetime

from app.demo import DEMO_DAY, demo_book
from app.engine import leverage
from app.engine.calendar import ET, Phase

SAFETY, CAP = 0.8, 20.0
SPY = leverage.SymbolRisk('SPY', gap_p99=0.02, intraday_p99=0.015, earnings_gap_p99=0.02, adv_dollar=3e10)
NVDA = leverage.SymbolRisk('NVDA', gap_p99=0.08, intraday_p99=0.045, earnings_gap_p99=0.18, adv_dollar=3e10)


def test_mega_cap_gets_headline_cap_intraday():
    r = leverage.max_leverage(SPY, 10_000, Phase.OPEN, 0.0, False, SAFETY, CAP)
    assert r.max_leverage == CAP


def test_earnings_night_tightens_at_least_3x():
    intraday = leverage.max_leverage(NVDA, 10_000, Phase.OPEN, 0.0, False, SAFETY, CAP)
    tonight = leverage.max_leverage(NVDA, 10_000, Phase.CLOSED, 1.0, True, SAFETY, CAP)
    assert intraday.max_leverage / tonight.max_leverage >= 3.0
    assert tonight.max_leverage < 5.0


def test_earnings_night_tighter_than_normal_night():
    normal = leverage.max_leverage(NVDA, 10_000, Phase.CLOSED, 1.0, False, SAFETY, CAP)
    tonight = leverage.max_leverage(NVDA, 10_000, Phase.CLOSED, 1.0, True, SAFETY, CAP)
    assert tonight.max_leverage < normal.max_leverage


def test_closing_ramp_is_monotone():
    levs = [leverage.max_leverage(NVDA, 10_000, Phase.CLOSING_RAMP, f, True, SAFETY, CAP).max_leverage
            for f in (0.0, 0.25, 0.5, 0.75, 1.0)]
    assert levs == sorted(levs, reverse=True)


def test_crowding_reduces_leverage():
    small = leverage.max_leverage(NVDA, 10_000, Phase.OPEN, 0.0, False, SAFETY, CAP)
    whale = leverage.max_leverage(NVDA, 2e9, Phase.OPEN, 0.0, False, SAFETY, CAP)
    assert whale.max_leverage < small.max_leverage
    assert whale.concentration_haircut < 1.0


def test_book_knows_nvda_reports_tonight():
    book = demo_book(50)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 15, 45, tzinfo=ET)
    r = book.symbol_leverage('NVDA', ts)
    assert r.earnings_tonight and r.max_leverage < 6.0
    assert book.symbol_leverage('GME', ts).frozen  # synthetic split day
