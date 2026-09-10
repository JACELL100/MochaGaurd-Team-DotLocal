'''Replay harness: the loop that turns decisions into a score.

These cover the properties the harness is only useful if it has -- no look-ahead, no free
liquidations, worst-account-first sequencing, and healthy accounts left alone.
'''
from datetime import datetime, timedelta

import numpy as np
import pytest

from app.demo import DEMO_DAY, DEMO_GAPS, demo_book
from app.engine import liquidate, replay
from app.engine.calendar import ET, next_trading_day


def _gapped(book, default=-0.005):
    nxt = book.last_close.copy()
    for i, s in enumerate(book.symbols):
        nxt[i] = book.last_close[i] * (1.0 + DEMO_GAPS.get(s, default))
    return nxt


def test_replay_runs_and_scores_a_session():
    book = demo_book(300).clone()
    r = replay.run_session(book, DEMO_DAY, _gapped(book), run_id='t', step_minutes=30)
    assert r.steps and r.series
    for key in ('broker_loss', 'capital_efficiency', 'user_trust', 'positions_reduced'):
        assert key in r.scores
    assert r.scores['capital_efficiency'] > 0
    assert 0.0 <= r.scores['user_trust'] <= 1.0


def test_ramp_is_sampled_not_jumped():
    '''The 15:30-16:00 walk-down must appear as several steps, not one cliff.'''
    book = demo_book(200).clone()
    r = replay.run_session(book, DEMO_DAY, _gapped(book), run_id='t', step_minutes=30)
    ramps = sorted({round(s.ramp, 2) for s in r.steps if s.phase == 'closing_ramp'})
    assert len(ramps) >= 4, ramps
    assert ramps == sorted(ramps)


def test_unwind_is_worst_account_first():
    orders = [
        liquidate.Order('healthy', 'AAPL', 100, 200.0, 50_000, margin_ratio=2.5),
        liquidate.Order('broke', 'AAPL', 100, 200.0, 50_000, margin_ratio=0.4),
        liquidate.Order('thin', 'AAPL', 100, 200.0, 50_000, margin_ratio=1.1),
    ]
    got = [f.account_id for f in liquidate.unwind(orders)]
    assert got == ['broke', 'thin', 'healthy']


def test_unwind_skips_healthy_accounts_and_frozen_symbols():
    book = demo_book(400).clone()
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 15, 45, tzinfo=ET)
    result = book.evaluate(ts)
    fills = replay.unwind_at_open(book, result, ts)
    touched = {f['account_id'] for f in fills}
    for a_i, acct in enumerate(book.accounts):
        req = float(result.margin_required[a_i])
        eq = float(result.equity[a_i])
        if req > 0 and eq / req >= 1.0 and eq > 0 and acct.id in touched:
            pytest.fail(f'healthy account {acct.id} was unwound')
    frozen = {book.symbols[i] for i in np.nonzero(result.frozen_sym)[0]}
    assert not (frozen & {f['symbol'] for f in fills}), 'unwound a frozen symbol'


def test_unwind_pays_slippage():
    '''No free liquidations: a large order must fill worse than the reference price.'''
    small = liquidate.unwind([liquidate.Order('a', 'X', 100, 100.0, 1_000_000, 0.5)])[0]
    whale = liquidate.unwind([liquidate.Order('a', 'X', 5_000_000, 100.0, 1_000_000, 0.5)])[0]
    assert small.fill_price < 100.0
    assert whale.fill_price < small.fill_price
    assert whale.minutes > 1                      # participation-capped across many minutes
    assert whale.slippage_bps > small.slippage_bps


def test_replay_never_sees_the_next_open_while_deciding():
    '''Look-ahead guard: a wildly different next open must not change any in-session decision.'''
    def decisions_with(gap_mult):
        book = demo_book(250).clone()
        nxt = book.last_close * gap_mult
        r = replay.run_session(book, DEMO_DAY, nxt, run_id='t', step_minutes=30)
        close_ts = ET and None
        # keep only steps strictly before the next session's open
        nxt_open = next_trading_day(DEMO_DAY)
        return [(d['ts'], d['account_id'], d['symbol'], d['action'])
                for d in r.decisions
                if datetime.fromisoformat(d['ts']).astimezone(ET).date() < nxt_open]

    calm = decisions_with(0.999)
    crash = decisions_with(0.60)
    assert calm == crash, 'in-session decisions changed with the next open: look-ahead'


def _both(base, recovered):
    '''Prices where symbol 0 recovered and symbol 1 did not.'''
    out = base.copy()
    out[0] = recovered[0]
    return out


def _score(book, next_open, closed, exits, notional=None, held=None):
    return replay.score(book, equity_open=np.zeros(1), equity_final=np.zeros(1),
                        exit_price=exits, next_open_price=next_open, closed_qty=closed,
                        leverage_samples=[5.0], exit_notional=notional, held_notional=held)


def test_user_trust_ignores_moves_inside_trading_costs():
    book = demo_book(50)
    px = book.last_close.copy()
    key = ('acct-0001', book.symbols[0])
    closed, exits = {key: 10.0}, {key: float(px[0])}

    tiny = px.copy(); tiny[0] = px[0] * (1.0 + replay.RECOVERY_TOLERANCE / 2)
    assert _score(book, tiny, closed, exits)['reduced_that_would_have_recovered'] == 0

    big = px.copy(); big[0] = px[0] * (1.0 + replay.RECOVERY_TOLERANCE * 5)
    s2 = _score(book, big, closed, exits)
    assert s2['reduced_that_would_have_recovered'] == 1
    assert s2['user_trust'] == 0.0


def test_user_trust_is_weighted_by_how_much_we_sold():
    """A small trim that recovers must cost far less trust than a full liquidation."""
    book = demo_book(50)
    px = book.last_close.copy()
    recovered_px = px.copy(); recovered_px[0] = px[0] * (1.0 + replay.RECOVERY_TOLERANCE * 5)
    a, b = ('acct-0001', book.symbols[0]), ('acct-0002', book.symbols[0])
    closed = {a: 10.0, b: 10.0}
    exits = {a: float(px[0]), b: float(px[0])}

    # account A was trimmed 1k of a 100k position; B was fully liquidated at 100k.
    trim = _score(book, recovered_px, {a: 10.0}, {a: exits[a]},
                  notional={a: 1_000.0}, held={a: 100_000.0})
    full = _score(book, recovered_px, {b: 10.0}, {b: exits[b]},
                  notional={b: 100_000.0}, held={b: 100_000.0})
    assert trim['user_trust'] == full['user_trust'] == 0.0   # both were unnecessary
    assert trim['notional_sold'] < full['notional_sold']
    assert trim['share_of_book_sold'] < full['share_of_book_sold']

    # A large *necessary* sale alongside a small needless trim must stay high-trust: the
    # regret is weighted by notional, so 1k of wasted selling against 99k of justified
    # selling is a near-perfect score, not a failing one.
    key_b = ('acct-0002', book.symbols[1])   # symbol 1 did not recover: selling it was right
    mixed = _score(book, _both(px, recovered_px),
                   {a: 10.0, key_b: 10.0}, {a: float(px[0]), key_b: float(px[1])},
                   notional={a: 1_000.0, key_b: 99_000.0},
                   held={a: 100_000.0, key_b: 100_000.0})
    assert mixed['notional_sold'] == 100_000.0
    assert mixed['notional_sold_unnecessarily'] == 1_000.0
    assert mixed['user_trust'] == 0.99
