'''Cross-market sector signal: use the markets that trade while the US is shut.

Two properties make this a risk measure instead of a price forecast, and both are easy to break
by accident, so they are pinned here:

  * It can only widen the gap, never narrow it. A calm night in Asia is not permission to
    exceed the symbol's own historical p99.
  * It is direction-agnostic. A +5% sector rally widens exactly as much as -5%, because the
    engine sizes for how violent the night is, not for which way it went.

Plus the one that actually bit during development: before the US close, tonight's overseas
sessions have not happened, so the signal must be neutral.
'''
from datetime import date, datetime

import pytest

from app.data import sectors
from app.demo import DEMO_DAY, demo_book
from app.engine import leverage
from app.engine.calendar import ET, Phase


def test_only_widens_never_narrows():
    assert leverage.sector_widen([(0.0, 1.0), (0.0, 1.0)]) == 1.0
    assert leverage.sector_widen([(-0.05, 1.0), (-0.04, 1.0)]) > 1.0
    # every result is a multiplier >= 1
    for moves in ([(0.001, 1.0)] * 2, [(-0.2, 1.0)] * 3, [(0.5, 2.0), (-0.5, 1.0)]):
        assert leverage.sector_widen(moves) >= 1.0


def test_direction_agnostic():
    down = leverage.sector_widen([(-0.05, 1.5), (-0.04, 1.2)])
    up = leverage.sector_widen([(0.05, 1.5), (0.04, 1.2)])
    assert down == up == pytest.approx(down)
    assert down > 1.0


def test_quiet_session_is_ignored():
    '''An ordinary overseas day carries no information and must not move the limit.'''
    assert leverage.sector_widen([(0.002, 1.5), (-0.001, 1.2)]) == 1.0


def test_needs_more_than_one_peer():
    '''One thin foreign print must not be able to move a leverage limit on its own.'''
    assert leverage.sector_widen([(-0.09, 1.5)]) == 1.0


def test_widening_is_capped():
    assert leverage.sector_widen([(-0.9, 1.0), (-0.8, 1.0)]) == leverage.SECTOR_MAX_WIDEN


def test_multiplier_scales_with_severity():
    mild = leverage.sector_widen([(-0.01, 1.0), (-0.012, 1.0)])
    bad = leverage.sector_widen([(-0.03, 1.0), (-0.035, 1.0)])
    worse = leverage.sector_widen([(-0.06, 1.0), (-0.055, 1.0)])
    assert 1.0 < mild < bad < worse


def test_sector_only_touches_the_overnight_term():
    '''Intraday risk is the 5-minute exit move; an Asian selloff says nothing about it.'''
    args = dict(intraday_p99=0.009, gap_p99=0.064, earnings_gap_p99=0.26,
                earnings_tonight=False, ramp=0.0)
    calm = leverage.adverse_move(**args, phase=Phase.OPEN, sector_mult=1.0)
    stressed = leverage.adverse_move(**args, phase=Phase.OPEN, sector_mult=2.0)
    assert calm == stressed                      # market open: unchanged
    night_calm = leverage.adverse_move(**{**args, 'ramp': 1.0}, phase=Phase.CLOSED, sector_mult=1.0)
    night_bad = leverage.adverse_move(**{**args, 'ramp': 1.0}, phase=Phase.CLOSED, sector_mult=2.0)
    assert night_bad > night_calm                # overnight: widened


def test_no_signal_before_the_us_close():
    '''The bug this caught: at 15:45 tonight's Asian session has not happened yet.'''
    book = demo_book(30)
    book.sector_moves = {p.ticker: {'move': -0.06, 'session_d': DEMO_DAY}
                         for p in sectors.peers_for('NVDA')}
    for hour, minute in ((11, 0), (15, 45), (15, 59)):
        ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, hour, minute, tzinfo=ET)
        mult, _, _ = book.sector_signal('NVDA', ts)
        assert mult == 1.0, f'look-ahead at {hour}:{minute:02d}'


def test_signal_arrives_as_foreign_sessions_finish():
    book = demo_book(30)
    nxt = date.fromordinal(DEMO_DAY.toordinal() + 1)
    book.sector_moves = {p.ticker: {'move': -0.06, 'session_d': nxt}
                         for p in sectors.peers_for('NVDA')}
    # 02:00 ET the following morning: Taiwan and Korea have closed.
    late = datetime(nxt.year, nxt.month, nxt.day, 2, 0, tzinfo=ET)
    mult, note, detail = book.sector_signal('NVDA', late)
    assert mult > 1.0
    assert sum(1 for d in detail if d['counted']) >= 2
    assert 'semiconductors' in note


def test_unmapped_symbol_gets_no_adjustment():
    '''Better no signal than a wrong one: an unknown ticker has no sector peers.'''
    book = demo_book(30)
    assert sectors.peers_for('GME') == ()
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 20, 0, tzinfo=ET)
    assert book.sector_signal('GME', ts) == (1.0, '', [])


def test_leverage_result_reports_the_signal():
    risk = leverage.SymbolRisk('NVDA', gap_p99=0.064, intraday_p99=0.009,
                               earnings_gap_p99=0.26, adv_dollar=2.8e10)
    stressed = leverage.max_leverage(risk, 50_000, Phase.CLOSED, 1.0, False, 0.30, 20.0,
                                     sector_mult=1.8, sector_note='chips sold off in Asia')
    calm = leverage.max_leverage(risk, 50_000, Phase.CLOSED, 1.0, False, 0.30, 20.0)
    assert stressed.max_leverage < calm.max_leverage
    assert stressed.sector_mult == 1.8
    assert 'sector=1.80' in stressed.reason
