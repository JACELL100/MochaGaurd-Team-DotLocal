'''The overnight digest: the last thing a user reads before going to sleep.

Three things had gone wrong here and each is pinned below: the headline was repeated as the
first line of the body, "You are safe tonight" promised something the engine cannot deliver
(it sizes against a 1-in-100 move, not against every possible one), and an account holding
nothing was told its "$0 equity" was safe.
'''
from datetime import datetime

import pytest

from app.copilot import service
from app.demo import DEMO_DAY, demo_book
from app.engine.calendar import ET


def _digest(*, with_positions=True, n=80):
    book = demo_book(n)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 20, 0, tzinfo=ET)
    result = book.evaluate(ts)
    for acct in book.accounts:
        view = book.account_view(acct.id, result)
        if bool(view['positions']) != with_positions:
            continue
        decisions = [d.to_dict() for d in result.decisions if d.account_id == acct.id]
        return service.deterministic_tonight_digest(view, decisions, result), view
    pytest.skip(f'no account with positions={with_positions}')


def test_headline_is_not_repeated_in_the_body():
    '''The banner renders headline as title and summary as body; duplication looked like a bug.'''
    digest, _ = _digest()
    assert digest['headline'].rstrip('.').lower() not in digest['summary'].lower()


def test_never_promises_safety():
    '''The engine sizes against a 1-in-100 move. "You are safe" is a promise it cannot keep.'''
    for with_positions in (True, False):
        try:
            digest, _ = _digest(with_positions=with_positions)
        except BaseException:
            continue
        blob = (digest['headline'] + ' ' + digest['summary']).lower()
        assert 'you are safe' not in blob
        assert 'sleep well' not in blob


def test_safe_digest_states_the_confidence_level():
    '''A worst case has to be labelled as a percentile, not as a ceiling.'''
    digest, view = _digest()
    if digest['status'] != 'safe':
        pytest.skip('sampled account is not in the safe state')
    assert '1-in-100' in digest['summary']
    assert 'not a guarantee' in digest['summary']


def test_empty_account_is_not_told_about_zero_equity():
    '''An account holding nothing must not be shown "0% of your $0".'''
    digest, view = _digest(with_positions=False)
    assert not view['positions']
    assert '$0' not in digest['summary']
    assert 'not holding anything' in digest['summary']
    assert digest['headline'] == 'Nothing held overnight'


def test_action_needed_names_both_deadlines():
    '''The user's own deadline and the automatic one must both be present.'''
    book = demo_book(120)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 15, 45, tzinfo=ET)
    result = book.evaluate(ts)
    for acct in book.accounts:
        view = book.account_view(acct.id, result)
        decisions = [d.to_dict() for d in result.decisions if d.account_id == acct.id]
        digest = service.deterministic_tonight_digest(view, decisions, result)
        if digest['status'] != 'action_needed':
            continue
        assert '4:00 PM ET' in digest['summary']
        assert '3:45 PM ET' in digest['summary']
        assert 'never more than necessary' in digest['summary']
        return
    pytest.skip('no account needed action in the sample')
