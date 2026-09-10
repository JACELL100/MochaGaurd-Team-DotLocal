from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.copilot import service
from app.copilot.facts import numbers_are_grounded
from app.copilot.llm import LLMUnavailable


TS = datetime(2026, 9, 10, 19, 30, tzinfo=timezone.utc)  # 15:30 ET


def account_view(account_id: str = 'acct-1') -> dict:
    return {
        'account_id': account_id,
        'display_name': 'Ava',
        'tz': 'Asia/Kolkata',
        'cash': 10_000.0,
        'equity': 50_000.0,
        'gross_exposure': 90_000.0,
        'margin_required': 65_000.0,
        'worst_case_loss': 20_000.0,
        'leverage_used': 1.8,
        'positions': [{
            'symbol': 'NVDA',
            'qty': 300.0,
            'notional': 60_000.0,
            'adverse_move': 0.18,
            'max_leverage': 4.0,
            'earnings_tonight': True,
            'frozen': False,
        }],
    }


def reduce_decision(account_id: str = 'acct-1') -> dict:
    return {
        'id': 42,
        'ts': TS,
        'account_id': account_id,
        'symbol': 'NVDA',
        'action': 'reduce',
        'max_leverage': 4.0,
        'adverse_move': 0.18,
        'equity': 50_000.0,
        'margin_required': 65_000.0,
        'qty_to_reduce': 120.0,
        'reason': 'phase=closing_ramp adverse=0.18',
    }


class FakeBook:
    def __init__(self, views: dict[str, dict]):
        self.views = views
        self.accounts = [SimpleNamespace(id=account_id) for account_id in views]

    def account_view(self, account_id, _result):
        return self.views[account_id]


def test_number_guard_rejects_numbers_not_in_fact_pack():
    facts = {'qty_to_reduce': '120', 'deadline': '4:00 PM ET'}
    assert numbers_are_grounded('Sell 120 shares before 4:00 PM ET.', facts)
    assert not numbers_are_grounded('Sell 30 shares before 4:00 PM ET.', facts)


@pytest.mark.asyncio
async def test_unexpected_groq_error_stores_template_fallback(monkeypatch):
    rows = []

    async def broken_completion(*_args, **_kwargs):
        raise RuntimeError('malformed provider response')

    async def capture(inserted):
        rows.extend(inserted)

    monkeypatch.setattr(service.llm, 'complete_json', broken_completion)
    monkeypatch.setattr(service.db, 'insert_explanations', capture)

    decision = reduce_decision()
    result = SimpleNamespace(ts=TS)
    await service.explain_decisions(FakeBook({'acct-1': account_view()}), result, [decision])

    assert len(rows) == 1
    assert rows[0]['decision_id'] == 42
    assert rows[0]['model'] == 'template'
    assert '120' in rows[0]['action_hint']
    assert 'after the close' not in rows[0]['body']


@pytest.mark.asyncio
async def test_grounded_groq_decision_is_accepted(monkeypatch):
    rows = []

    async def grounded_completion(*_args, **_kwargs):
        return {
            'headline': 'NVDA is capped at 4x tonight.',
            'body': 'Its 99th percentile move is 18%.',
            'action_hint': 'Sell 120 shares before 4:00 PM ET or we act at 3:45 PM ET.',
        }

    async def capture(inserted):
        rows.extend(inserted)

    monkeypatch.setattr(service.llm, 'complete_json', grounded_completion)
    monkeypatch.setattr(service.db, 'insert_explanations', capture)

    await service.explain_decisions(
        FakeBook({'acct-1': account_view()}), SimpleNamespace(ts=TS), [reduce_decision()],
    )

    assert rows[0]['model'] == service.llm.model
    assert rows[0]['headline'] == 'NVDA is capped at 4x tonight.'


@pytest.mark.asyncio
async def test_ungrounded_groq_number_uses_template(monkeypatch):
    rows = []

    async def invented_completion(*_args, **_kwargs):
        return {
            'headline': 'NVDA is capped at 4x tonight.',
            'body': 'Its 99th percentile move is 18%.',
            'action_hint': 'Sell 777 shares before 4:00 PM ET.',
        }

    async def capture(inserted):
        rows.extend(inserted)

    monkeypatch.setattr(service.llm, 'complete_json', invented_completion)
    monkeypatch.setattr(service.db, 'insert_explanations', capture)

    await service.explain_decisions(
        FakeBook({'acct-1': account_view()}), SimpleNamespace(ts=TS), [reduce_decision()],
    )

    assert rows[0]['model'] == 'template'
    assert '120' in rows[0]['action_hint']
    assert '777 shares' not in rows[0]['action_hint']


@pytest.mark.asyncio
async def test_book_freeze_is_explained_only_to_accounts_holding_the_symbol(monkeypatch):
    rows = []
    second = account_view('acct-2')
    second['positions'][0]['symbol'] = 'MSFT'

    async def unavailable(*_args, **_kwargs):
        raise LLMUnavailable('offline')

    async def capture(inserted):
        rows.extend(inserted)

    monkeypatch.setattr(service.llm, 'complete_json', unavailable)
    monkeypatch.setattr(service.db, 'insert_explanations', capture)

    freeze = {
        **reduce_decision(),
        'id': 77,
        'account_id': None,
        'action': 'freeze',
        'qty_to_reduce': None,
        'reason': 'guards=halted',
    }
    await service.explain_decisions(
        FakeBook({'acct-1': account_view(), 'acct-2': second}), SimpleNamespace(ts=TS), [freeze],
    )

    assert [row['account_id'] for row in rows] == ['acct-1']
    assert rows[0]['decision_id'] == 77
    assert rows[0]['model'] == 'template'


def test_daily_windows_use_new_york_time_and_trading_days():
    before_ops = datetime(2026, 9, 10, 18, 59, tzinfo=timezone.utc)
    at_ops = datetime(2026, 9, 10, 19, 0, tzinfo=timezone.utc)
    before_digest = datetime(2026, 9, 10, 19, 29, tzinfo=timezone.utc)
    weekend = datetime(2026, 9, 12, 20, 0, tzinfo=timezone.utc)

    assert not service.ops_brief_due(before_ops)
    assert service.ops_brief_due(at_ops)
    assert not service.digest_due(before_digest)
    assert service.digest_due(TS)
    assert not service.ops_brief_due(weekend)
    assert not service.digest_due(weekend)


@pytest.mark.asyncio
async def test_account_digest_is_inserted_only_once(monkeypatch):
    stored = None
    inserts = []

    async def daily_digest(_account_id, _brief_date):
        return stored

    async def insert(rows):
        nonlocal stored
        inserts.extend(rows)
        stored = rows[0]

    async def unavailable(*_args, **_kwargs):
        raise LLMUnavailable('offline')

    monkeypatch.setattr(service.db, 'daily_digest', daily_digest)
    monkeypatch.setattr(service.db, 'insert_explanations', insert)
    monkeypatch.setattr(service.llm, 'complete_json', unavailable)

    account = account_view()
    result = SimpleNamespace(ts=TS)
    first = await service.ensure_account_digest(account, [reduce_decision()], result)
    second = await service.ensure_account_digest(account, [reduce_decision()], result)

    assert len(inserts) == 1
    assert first == second
    assert first['audience'] == 'digest'
    assert first['brief_date'].isoformat() == '2026-09-10'
    assert first['model'] == 'template'


def test_account_level_close_fallback_is_readable():
    decision = {
        **reduce_decision(),
        'symbol': None,
        'action': 'close',
        'max_leverage': None,
        'adverse_move': None,
        'qty_to_reduce': None,
    }
    card = service.deterministic_decision_card(decision, account_view(), TS)

    assert card['headline'] == "We are closing the account's positions before the bell."
    assert 'your account position' not in card['headline']
