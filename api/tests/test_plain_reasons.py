'''Plain-language reasons must exist for every decision, and must not contradict the decision.

The engine keeps a terse machine `reason` for logs and audit. Anything a person reads goes
through explain.py, so these tests pin two properties: coverage (no action falls through to a
raw string) and honesty (the words agree with the numbers).
'''
from datetime import datetime

import pytest

from app.copilot import explain
from app.copilot.facts import fmt_money
from app.demo import DEMO_DAY, demo_book
from app.engine.calendar import ET


ACTIONS = ['freeze', 'reduce', 'margin_call', 'close', 'hold']


@pytest.mark.parametrize('action', ACTIONS)
def test_every_action_gets_plain_language(action):
    plain = explain.explain_decision({
        'action': action, 'symbol': 'NVDA', 'equity': 79_432.0, 'margin_required': 95_000.0,
        'qty_to_reduce': 226.5, 'adverse_move': 0.0644, 'max_leverage': 4.58,
        'reason': 'equity=79432 margin_req=95000',
    })
    assert plain['headline'] and plain['why']
    assert plain['severity'] in {'ok', 'info', 'warning', 'critical'}
    # No machine syntax may leak into prose a customer reads.
    for field in ('headline', 'why', 'next'):
        assert 'margin_req=' not in plain[field]
        assert 'equity=' not in plain[field]


def test_split_freeze_says_nobody_lost_money():
    '''The hard gate. The explanation must state the split is not a crash.'''
    plain = explain.explain_decision({'action': 'freeze', 'symbol': 'GME',
                                      'reason': 'guards=split_effective'})
    assert 'split' in plain['why'].lower()
    assert 'without anyone losing money' in plain['why']
    assert 'No position in this symbol will be liquidated' in plain['next']


def test_halt_explains_the_price_is_untradeable():
    plain = explain.explain_decision({'action': 'freeze', 'symbol': 'X', 'reason': 'guards=halted'})
    assert 'halted' in plain['why']
    assert 'not one we could trade on' in plain['why']


def test_implausible_move_is_quantified_in_words():
    plain = explain.explain_decision({'action': 'freeze', 'symbol': 'X',
                                      'reason': 'guards=implausible_move=0.412'})
    assert '41%' in plain['why']


def test_reduce_tells_the_customer_what_to_sell_and_by_when():
    plain = explain.explain_decision({
        'action': 'reduce', 'symbol': 'NVDA', 'equity': 50_000.0, 'margin_required': 65_000.0,
        'qty_to_reduce': 120.0, 'adverse_move': 0.064, 'max_leverage': 4.5, 'reason': ''})
    assert '120' in plain['next']
    assert '4:00 PM' in plain['next']
    assert '3:45 PM' in plain['next']            # the automatic action, stated up front
    assert fmt_money(15_000.0) in plain['why']   # the actual shortfall, not a vague phrase


def test_negative_equity_renders_the_sign_outside_the_currency():
    plain = explain.explain_decision({'action': 'close', 'symbol': None, 'equity': -1200.0,
                                      'margin_required': 30_000.0, 'reason': ''})
    assert '-$1,200' in plain['why']
    assert '$-1,200' not in plain['why']


def test_book_explanation_reports_broker_loss_honestly():
    exposed = explain.explain_book({
        'phase': 'closed', 'accounts': 100, 'accounts_at_risk': 12,
        'broker_loss_at_p99': 250_000.0, 'worst_case_loss': 900_000.0,
        'frozen_symbols': [], 'earnings_tonight': [], 'top_concentration': []})
    assert exposed['severity'] == 'critical'
    assert 'we would' in exposed['exposure'] or 'absorb' in exposed['exposure']

    clean = explain.explain_book({
        'phase': 'open', 'accounts': 100, 'accounts_at_risk': 0,
        'broker_loss_at_p99': 0.0, 'worst_case_loss': 900_000.0,
        'frozen_symbols': [], 'earnings_tonight': [], 'top_concentration': []})
    assert clean['severity'] == 'ok'
    assert 'none of it would fall on us' in clean['exposure']


def test_book_explanation_surfaces_crowding():
    plain = explain.explain_book({
        'phase': 'closed', 'accounts': 400, 'accounts_at_risk': 60, 'broker_loss_at_p99': 0.0,
        'worst_case_loss': 1.0, 'frozen_symbols': [], 'earnings_tonight': [],
        'top_concentration': [{'symbol': 'NVDA', 'share': 0.31}, {'symbol': 'SPY', 'share': 0.30}]})
    crowding = ' '.join(plain['drivers'])
    assert 'NVDA' in crowding and 'SPY' in crowding
    assert 'one position' in crowding


def test_frozen_symbol_leverage_explanation_says_zero_and_no_liquidation():
    book = demo_book(50)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 11, 0, tzinfo=ET)
    result = book.symbol_leverage('GME', ts, 50_000)      # synthetic split day
    assert result.frozen and result.max_leverage == 0.0
    plain = explain.explain_leverage(result, book.symbol_risk('GME'), 50_000, ts)
    assert plain['driver'] == 'frozen'
    assert 'no liquidation' in plain['headline'] or 'frozen' in plain['headline']


def test_negligible_participation_is_described_not_rounded_to_zero():
    assert '0.000%' not in explain._share_of_volume(1.7e-6)
    assert 'tiny' in explain._share_of_volume(1.7e-6)


def test_verification_never_claims_proof_it_does_not_have():
    assert explain.explain_verification({'found': False})['severity'] == 'warning'
    pending = explain.explain_verification({'found': True, 'anchored': False})
    assert pending['severity'] == 'info'
    assert 'not yet' in pending['headline']
    ok = explain.explain_verification({'found': True, 'anchored': True, 'valid': True})
    assert ok['severity'] == 'ok'
    bad = explain.explain_verification({'found': True, 'anchored': True, 'valid': False,
                                        'error': 'root mismatch'})
    assert bad['severity'] == 'critical'
