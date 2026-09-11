'''Per-position risk breakdown: the answer to "why is this risky?".

The engine on its own emits an instruction ("reduce TSLA by 653 shares"). These cover the
properties that make the *reason* behind it trustworthy: the weights are shares of a whole and
sum to 1, the ranking reflects what actually drives the risk, and every factor carries
something the trader can act on.
'''
from datetime import datetime

import pytest

from app.copilot import explain
from app.demo import DEMO_DAY, demo_book
from app.engine.calendar import ET


def _view(n=60, hour=20, minute=0):
    book = demo_book(n)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, hour, minute, tzinfo=ET)
    result = book.evaluate(ts)
    acct = next(a.id for a in book.accounts
                if len(book.positions_of(book.acct_idx[a.id])) >= 2)
    return book, result, book.account_view(acct, result)


def test_weights_are_shares_of_a_whole():
    _, result, view = _view()
    for row in view['positions']:
        risk = explain.position_risk(row, view, result)
        if not risk['factors']:
            continue
        total = sum(f['weight'] for f in risk['factors'])
        assert total == pytest.approx(1.0, abs=0.01), risk['factors']


def test_factors_are_ranked_biggest_first():
    _, result, view = _view()
    for row in view['positions']:
        risk = explain.position_risk(row, view, result)
        weights = [f['weight'] for f in risk['factors']]
        assert weights == sorted(weights, reverse=True)


def test_every_factor_says_what_helps():
    '''A risk the user cannot act on is just an alarm.'''
    _, result, view = _view()
    for row in view['positions']:
        for factor in explain.position_risk(row, view, result)['factors']:
            assert factor['what_helps'] and len(factor['what_helps']) > 20
            assert factor['detail'] and len(factor['detail']) > 30
            assert factor['label'] and not factor['label'].islower()


def test_market_closed_is_named_as_a_cause_overnight():
    '''The 17.5-hour blind spot must appear as a reason, not be buried in volatility.'''
    _, result, view = _view(hour=20)
    kinds = {f['kind'] for row in view['positions']
             for f in explain.position_risk(row, view, result)['factors']}
    assert 'closed' in kinds


def test_market_closed_is_absent_while_open():
    _, result, view = _view(hour=11)
    kinds = {f['kind'] for row in view['positions']
             for f in explain.position_risk(row, view, result)['factors']}
    assert 'closed' not in kinds
    assert 'volatility' in kinds


def test_earnings_outranks_plain_volatility():
    '''On an earnings night the announcement is the story, not the usual wobble.'''
    _, result, view = _view(hour=20)
    row = next((p for p in view['positions'] if p['earnings_tonight']), None)
    if row is None:
        pytest.skip('no earnings name held by the sampled account')
    factors = explain.position_risk(row, view, result)['factors']
    ranking = [f['kind'] for f in factors]
    assert 'earnings' in ranking
    assert ranking.index('earnings') < ranking.index('volatility')


def test_level_tracks_share_of_equity():
    _, result, view = _view()
    for row in view['positions']:
        risk = explain.position_risk(row, view, result)
        share = risk['share_of_equity']
        if share is None:
            continue
        if share >= 0.75:
            assert risk['level'] == 'severe'
        elif share < 0.15:
            assert risk['level'] == 'low'


def test_no_machine_syntax_leaks_into_the_prose():
    _, result, view = _view()
    for row in view['positions']:
        risk = explain.position_risk(row, view, result)
        blob = risk['summary'] + risk['headline'] + ''.join(
            f['detail'] + f['what_helps'] for f in risk['factors'])
        for token in ('p99=', 'adverse=', 'margin_req=', 'gap_p99', '_mult'):
            assert token not in blob


def test_frozen_position_is_reported_as_protected_not_actionable():
    book, result, view = _view()
    frozen = next((p for p in view['positions'] if p['frozen']), None)
    if frozen is None:
        pytest.skip('no frozen symbol held by the sampled account')
    factors = explain.position_risk(frozen, view, result)['factors']
    entry = next(f for f in factors if f['kind'] == 'frozen')
    assert 'not liquidate' in entry['detail'] or 'will not' in entry['detail']
    assert 'Nothing to do' in entry['what_helps']
