'''Perpetual-futures risk: carry, oracle basis, and closures longer than one night.

Mochatrade's real product is perps on US stocks, traded 24/7. Three things follow that the
spot engine did not price, and each is tested for the property that makes it trustworthy:

  * funding -- a rate is not actionable; the deadline it implies is
  * basis   -- the contract can drift from a stock that is not trading
  * closure -- a weekend is ~65 hours, not 17.5
'''
from datetime import datetime, timedelta

import pytest

from app.engine import basis, funding
from app.engine import calendar as cal
from app.engine.calendar import ET, Phase
from app.engine.leverage import SymbolRisk, adverse_move, max_leverage

NIGHT = datetime(2026, 9, 10, 20, 0, tzinfo=ET)       # Thursday night
FRIDAY = datetime(2026, 9, 11, 20, 0, tzinfo=ET)      # Friday night -> weekend
MIDDAY = datetime(2026, 9, 10, 11, 0, tzinfo=ET)


# ----------------------------------------------------------------- funding / carry
def _assess(hourly, qty=1000, price=200.0, equity=10_000.0, margin=9_000.0, ts=NIGHT):
    return funding.assess(funding.FundingRate('NVDA', hourly), symbol='NVDA', qty=qty,
                          price=price, ts=ts, equity=equity, margin_required=margin)


def test_long_pays_and_short_earns_a_positive_rate():
    '''The venue convention: a positive rate means longs pay shorts.'''
    long_side = _assess(0.0005, qty=1000)
    short_side = _assess(0.0005, qty=-1000)
    assert long_side.pays and long_side.daily_cost > 0
    assert not short_side.pays and short_side.daily_cost < 0


def test_carry_alone_produces_a_deadline():
    '''The whole point: turn a percentage into a date the trader can act on.'''
    cost = _assess(0.0005)                     # 0.05%/hr on 20x
    assert cost.hours_to_liquidation is not None
    assert cost.liquidation_at is not None
    # $1,000 spare against $100/hr of carry is about ten hours.
    assert 8 < cost.hours_to_liquidation < 12


def test_faster_carry_means_a_sooner_deadline():
    slow = _assess(0.00005).hours_to_liquidation
    fast = _assess(0.0005).hours_to_liquidation
    assert slow is not None and fast is not None
    assert fast < slow


def test_no_deadline_when_earning_or_flat():
    assert _assess(0.0).hours_to_liquidation is None
    assert _assess(0.0005, qty=-1000).hours_to_liquidation is None   # short earns


def test_distant_deadline_is_withheld_rather_than_faked():
    '''Quoting a date months out is false precision -- the rate will change many times.'''
    assert _assess(1e-9).hours_to_liquidation is None


def test_already_breached_is_not_blamed_on_carry():
    cost = _assess(0.0005, equity=8_000.0, margin=9_000.0)
    assert cost.hours_to_liquidation == 0.0


def test_carry_is_charged_on_notional_not_equity():
    '''At 20x the cost scales with the position, which is why carry can be fatal.'''
    small = _assess(0.0005, qty=100).daily_cost
    big = _assess(0.0005, qty=1000).daily_cost
    assert big == pytest.approx(small * 10, rel=1e-6)


def test_book_carry_nets_payers_against_earners():
    costs = [_assess(0.0005, qty=1000), _assess(0.0005, qty=-500)]
    book = funding.book_carry(costs)
    assert book['positions_paying'] == 1
    assert book['positions_earning'] == 1
    assert book['daily_net'] == pytest.approx(book['daily_paid'] - book['daily_earned'])


def test_humanised_horizons_are_readable():
    assert funding.humanise_hours(None) == 'not at this rate'
    assert 'minutes' in funding.humanise_hours(0.5)
    assert 'hours' in funding.humanise_hours(10)
    assert 'days' in funding.humanise_hours(72)


def test_describe_warns_hard_when_the_deadline_is_close():
    assert funding.describe(_assess(0.0005))['severity'] == 'critical'
    assert funding.describe(_assess(0.0005, qty=-1000))['severity'] == 'ok'


# ----------------------------------------------------------------- oracle / basis
def test_basis_widens_only_while_the_underlying_is_shut():
    '''With the market open, arbitrage tethers the contract: no extra margin.'''
    assert basis.widen(0.03, underlying_open=True) == 1.0
    assert basis.widen(0.03, underlying_open=False) > 1.0


def test_basis_is_direction_agnostic():
    '''A rich contract converges down, a cheap one converges up; both hurt a holder.'''
    assert basis.widen(0.02, False) == basis.widen(-0.02, False)


def test_small_basis_is_tracking_not_risk():
    assert basis.widen(0.001, False) == 1.0


def test_basis_multiplier_is_capped_and_monotone():
    mults = [basis.widen(b, False) for b in (0.005, 0.01, 0.02, 0.05, 0.5)]
    assert mults == sorted(mults)
    assert mults[-1] == basis.BASIS_MAX_WIDEN


def test_basis_assess_reports_staleness_and_plain_language():
    stale = NIGHT - timedelta(hours=6)
    state = basis.assess('NVDA', 205.0, 200.0, stale, NIGHT)
    assert state.basis == pytest.approx(0.025, abs=1e-6)
    assert not state.underlying_open
    assert state.multiplier > 1.0
    described = basis.describe(state)
    assert 'NVDA' in described['headline']
    assert described['severity'] in {'warning', 'critical'}


def test_basis_handles_a_missing_reference():
    state = basis.assess('NVDA', 205.0, 0.0, NIGHT, NIGHT)
    assert state.multiplier == 1.0


# ----------------------------------------------------------------- closure length
def test_weekend_is_recognised_as_longer_than_a_night():
    assert cal.closure_hours(FRIDAY) > 3 * cal.closure_hours(NIGHT)
    assert cal.closure_label(FRIDAY) == 'the weekend'
    assert cal.closure_label(NIGHT) == 'overnight'


def test_open_session_prices_one_night_not_the_weekend():
    assert cal.phase_at(MIDDAY) == Phase.OPEN
    assert cal.closure_hours(MIDDAY) == pytest.approx(17.5, abs=0.6)
    assert cal.closure_multiplier(MIDDAY) == 1.0


def test_closure_scales_with_sqrt_time_and_is_capped():
    '''Two nights of news is not twice one night's move.'''
    weekend = cal.closure_multiplier(FRIDAY)
    assert 1.7 < weekend < 2.0                      # ~sqrt(62/17.5)
    assert weekend <= cal.CLOSURE_MAX_WIDEN


def test_weekend_materially_cuts_allowed_leverage():
    risk = SymbolRisk('NVDA', gap_p99=0.064, intraday_p99=0.009,
                      earnings_gap_p99=0.26, adv_dollar=2.8e10)
    night = max_leverage(risk, 50_000, Phase.CLOSED, 1.0, False, 0.30, 20.0,
                         closure_mult=cal.closure_multiplier(NIGHT))
    weekend = max_leverage(risk, 50_000, Phase.CLOSED, 1.0, False, 0.30, 20.0,
                           closure_mult=cal.closure_multiplier(FRIDAY))
    assert weekend.max_leverage < night.max_leverage * 0.7


# ----------------------------------------------------------------- interaction
def test_the_three_signals_only_touch_the_overnight_term():
    '''None of them says anything about the 5 minutes it takes to exit intraday.'''
    args = dict(intraday_p99=0.009, gap_p99=0.064, earnings_gap_p99=0.26,
                earnings_tonight=False, ramp=0.0)
    plain = adverse_move(**args, phase=Phase.OPEN)
    loaded = adverse_move(**args, phase=Phase.OPEN, sector_mult=2.0,
                          closure_mult=2.0, basis_mult=2.5)
    assert plain == loaded

    night_plain = adverse_move(**{**args, 'ramp': 1.0}, phase=Phase.CLOSED)
    night_loaded = adverse_move(**{**args, 'ramp': 1.0}, phase=Phase.CLOSED,
                                closure_mult=1.9, basis_mult=1.5)
    assert night_loaded > night_plain


def test_multipliers_can_only_widen_never_narrow():
    args = dict(intraday_p99=0.009, gap_p99=0.064, earnings_gap_p99=0.26,
                earnings_tonight=False, phase=Phase.CLOSED, ramp=1.0)
    baseline = adverse_move(**args)
    # A multiplier below 1 must be clamped, never used to grant more leverage.
    assert adverse_move(**args, closure_mult=0.1, basis_mult=0.2, sector_mult=0.5) == baseline
