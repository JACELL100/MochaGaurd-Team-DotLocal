"""Grounded Groq narration and deterministic fallbacks.

The risk engine decides first. This module receives completed decisions only after they have been
persisted, and a failure here never changes or delays the risk result.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .. import db
from ..config import settings
from ..engine import calendar as cal
from .facts import build_fact_pack, fmt_money, fmt_pct, numbers_are_grounded
from .llm import LLMUnavailable, llm

log = logging.getLogger('mochaguard.copilot')
OPS_BRIEF_AT = time(15, 0)

_templates = Environment(
    loader=FileSystemLoader(Path(__file__).with_name('prompts')),
    undefined=StrictUndefined,
    autoescape=False,
    trim_blocks=True,
    lstrip_blocks=True,
)


def _render(name: str, facts: dict) -> str:
    return _templates.get_template(name).render(f=facts).strip()


def _fallback_user(facts: dict) -> dict:
    lines = [line.strip() for line in _render('fallback_user.j2', facts).splitlines() if line.strip()]
    return {
        'headline': lines[0] if lines else 'Risk update',
        'body': lines[1] if len(lines) > 1 else '',
        'action_hint': lines[2] if len(lines) > 2 else '',
    }


def _fallback_digest(facts: dict) -> dict:
    lines = [line.strip() for line in _render('fallback_digest.j2', facts).splitlines() if line.strip()]
    return {
        'headline': lines[0] if lines else 'Tonight risk briefing',
        'summary': ' '.join(lines[1:]) if len(lines) > 1 else '',
    }


def _validated_json(
    candidate,
    facts: dict,
    keys: tuple[str, ...],
    *,
    allow_empty: frozenset[str] = frozenset(),
    headline_chars: int | None = None,
    max_words: int | None = None,
) -> dict | None:
    if not isinstance(candidate, dict):
        return None
    parsed: dict[str, str] = {}
    for key in keys:
        value = candidate.get(key)
        if not isinstance(value, str):
            return None
        value = value.strip()
        if not value and key not in allow_empty:
            return None
        parsed[key] = value
    if headline_chars is not None and len(parsed.get('headline', '')) > headline_chars:
        return None
    text = ' '.join(parsed.values())
    if max_words is not None and len(text.split()) > max_words:
        return None
    if not numbers_are_grounded(text, facts):
        return None
    return parsed


def _decision_dict(decision) -> dict:
    return decision.to_dict() if hasattr(decision, 'to_dict') else decision


def decisions_for_account(book, result, account_id: str, account: dict | None = None) -> list[dict]:
    """Account decisions plus book-level freezes affecting a symbol the account holds."""
    view = account or book.account_view(account_id, result)
    held = {position['symbol'] for position in view['positions']}
    return [
        row
        for row in (_decision_dict(decision) for decision in result.decisions)
        if row.get('account_id') == account_id
        or (row.get('action') == 'freeze' and row.get('symbol') in held)
    ]


def deterministic_decision_card(decision: dict, account: dict, ts: datetime) -> dict:
    position = next((row for row in account['positions'] if row['symbol'] == decision.get('symbol')), None)
    facts = build_fact_pack(decision, account, position, ts)
    return {
        'decision_id': decision.get('id'),
        'account_id': account['account_id'],
        'symbol': decision.get('symbol'),
        'action': decision['action'],
        **_fallback_user(facts),
        'qty_to_reduce': decision.get('qty_to_reduce'),
        'max_leverage': decision.get('max_leverage'),
        'model': 'template',
    }


async def explain_decisions(book, result, decisions: list[dict]) -> None:
    candidates: list[tuple[dict, dict, dict]] = []
    for decision in decisions:
        if decision.get('action') not in {'freeze', 'reduce', 'margin_call', 'close'}:
            continue
        if decision.get('account_id'):
            account_ids = [str(decision['account_id'])]
        elif decision.get('action') == 'freeze' and decision.get('symbol'):
            account_ids = [
                account.id for account in book.accounts
                if any(position['symbol'] == decision['symbol']
                       for position in book.account_view(account.id, result)['positions'])
            ]
        else:
            account_ids = []
        for account_id in account_ids:
            try:
                account = book.account_view(account_id, result)
            except (KeyError, IndexError):
                continue
            position = next((row for row in account['positions'] if row['symbol'] == decision.get('symbol')), None)
            candidates.append((decision, account, build_fact_pack(decision, account, position, result.ts)))

    async def narrate(decision: dict, account: dict, facts: dict, use_llm: bool) -> dict:
        parsed, model = _fallback_user(facts), 'template'
        if use_llm:
            try:
                candidate = await llm.complete_json(_render('user_explain.j2', facts), max_tokens=180)
                validated = _validated_json(
                    candidate,
                    facts,
                    ('headline', 'body', 'action_hint'),
                    allow_empty=frozenset({'action_hint'}),
                    headline_chars=90,
                )
                if validated is not None:
                    parsed, model = validated, llm.model
            except LLMUnavailable:
                pass
            except Exception as exc:  # noqa: BLE001 - every failure must use the mandatory fallback
                log.warning('Groq decision narration failed; using template: %s', exc)
        return {
            'decision_id': decision['id'],
            'account_id': account['account_id'],
            'ts': result.ts,
            'audience': 'user',
            **parsed,
            'model': model,
        }

    semaphore = asyncio.Semaphore(4)
    limit = max(0, settings.max_llm_explanations_per_run)

    async def bounded(index: int, item: tuple[dict, dict, dict]) -> dict:
        async with semaphore:
            return await narrate(*item, use_llm=index < limit)

    rows = await asyncio.gather(*(bounded(index, item) for index, item in enumerate(candidates)))
    await db.insert_explanations(rows)


def digest_facts(account: dict, decisions: list[dict], result) -> dict:
    actions = [decision for decision in decisions if decision.get('action') in {'reduce', 'margin_call', 'close'}]
    status = 'auto_derisk' if any(decision.get('action') == 'close' for decision in actions) else (
        'action_needed' if actions else 'safe'
    )
    tz = account.get('tz') or 'UTC'
    deadline = cal.next_close(result.ts)
    derisk = deadline.replace(hour=15, minute=45)
    symbols = ', '.join(sorted({str(decision.get('symbol')) for decision in actions if decision.get('symbol')})) or 'none'
    earnings = ', '.join(position['symbol'] for position in account['positions'] if position['earnings_tonight']) or 'none'
    frozen = ', '.join(position['symbol'] for position in account['positions'] if position['frozen']) or 'none'
    return {
        'display_name': account.get('display_name') or 'there',
        'user_tz': tz,
        'user_local_time': cal.local_time_str(result.ts, tz),
        'status': status,
        'risk_percentile': '99th percentile',
        'equity': fmt_money(account['equity']),
        'gross_exposure': fmt_money(account['gross_exposure']),
        'leverage_used': f"{account['leverage_used'] or 0:.1f}x",
        'margin_required': fmt_money(account['margin_required']),
        'worst_case_loss': fmt_money(account['worst_case_loss']),
        'worst_case_pct': fmt_pct(account['worst_case_loss'] / max(account['equity'], 1)),
        'n_actions': len(actions),
        'flagged_symbols': symbols,
        'earnings_symbols': earnings,
        'frozen_symbols': frozen,
        'deadline_et': '4:00 PM ET',
        'deadline_local': cal.local_time_str(deadline, tz),
        'derisk_et': '3:45 PM ET',
        'derisk_local': cal.local_time_str(derisk, tz),
    }


async def tonight_digest(account: dict, decisions: list[dict], result) -> dict:
    facts = digest_facts(account, decisions, result)
    parsed = _fallback_digest(facts)
    model = 'template'
    try:
        candidate = await llm.complete_json(_render('tonight_digest.j2', facts), max_tokens=160)
        validated = _validated_json(
            candidate, facts, ('headline', 'summary'), headline_chars=60, max_words=80,
        )
        if validated is not None:
            parsed, model = validated, llm.model
    except LLMUnavailable:
        pass
    except Exception as exc:  # noqa: BLE001 - every failure must use the mandatory fallback
        log.warning('Groq Tonight digest failed; using template: %s', exc)
    return {
        'status': facts['status'],
        **parsed,
        'model': model,
        'deadline_et': facts['deadline_et'],
        'deadline_local': facts['deadline_local'],
        'local_time': facts['user_local_time'],
    }


def deterministic_tonight_digest(account: dict, decisions: list[dict], result) -> dict:
    facts = digest_facts(account, decisions, result)
    return {
        'status': facts['status'],
        **_fallback_digest(facts),
        'model': 'template',
        'deadline_et': facts['deadline_et'],
        'deadline_local': facts['deadline_local'],
        'local_time': facts['user_local_time'],
    }


def digest_due(ts: datetime) -> bool:
    et = cal.to_et(ts)
    return cal.is_trading_day(et.date()) and et.time() >= cal.RAMP_START


def ops_brief_due(ts: datetime) -> bool:
    et = cal.to_et(ts)
    return cal.is_trading_day(et.date()) and et.time() >= OPS_BRIEF_AT


async def ensure_account_digest(account: dict, decisions: list[dict], result) -> dict:
    brief_date = cal.to_et(result.ts).date()
    saved = await db.daily_digest(account['account_id'], brief_date)
    if saved is not None:
        return saved
    digest = await tonight_digest(account, decisions, result)
    row = {
        'decision_id': None,
        'account_id': account['account_id'],
        'ts': result.ts,
        'brief_date': brief_date,
        'audience': 'digest',
        'headline': digest['headline'],
        'body': digest['summary'],
        'action_hint': None,
        'model': digest['model'],
    }
    await db.insert_explanations([row])
    return await db.daily_digest(account['account_id'], brief_date) or row


def ops_facts(book, result) -> dict:
    summary = result.summary
    earnings_accounts = 0
    for account in book.accounts:
        view = book.account_view(account.id, result)
        if any(position['earnings_tonight'] for position in view['positions']):
            earnings_accounts += 1
    return {
        **summary,
        'risk_percentile': '99th percentile',
        'as_of_et': cal.to_et(result.ts).strftime('%Y-%m-%d %H:%M'),
        'gross_exposure': fmt_money(summary['gross_exposure']),
        'net_equity': fmt_money(summary['net_equity']),
        'worst_case_loss': fmt_money(summary['worst_case_loss']),
        'broker_loss_at_p99': fmt_money(summary['broker_loss_at_p99']),
        'avg_leverage_used': f"{summary['avg_leverage_used']:.1f}x",
        'earnings_accounts': earnings_accounts,
        'earnings_tonight': ', '.join(summary['earnings_tonight']) or 'none',
        'frozen_count': len(summary['frozen_symbols']),
        'frozen_symbols': ', '.join(summary['frozen_symbols']) or 'none',
        'top_concentration': ', '.join(item['symbol'] for item in summary['top_concentration']) or 'none',
    }


def deterministic_ops_brief(book, result) -> dict:
    facts = ops_facts(book, result)
    return {
        'headline': 'Daily risk brief',
        'body': _render('fallback_ops.j2', facts),
        'model': 'template',
    }


async def build_ops_brief(book, result) -> dict:
    facts = ops_facts(book, result)
    parsed = deterministic_ops_brief(book, result)
    try:
        candidate = await llm.complete_json(_render('ops_brief.j2', facts), max_tokens=160)
        validated = _validated_json(candidate, facts, ('body',), max_words=80)
        if validated is not None:
            parsed = {'headline': 'Daily risk brief', 'body': validated['body'], 'model': llm.model}
    except LLMUnavailable:
        pass
    except Exception as exc:  # noqa: BLE001 - every failure must use the mandatory fallback
        log.warning('Groq ops brief failed; using template: %s', exc)
    return parsed


async def ensure_ops_brief(book, result) -> dict:
    brief_date = cal.to_et(result.ts).date()
    saved = await db.daily_ops_brief(brief_date)
    if saved is not None:
        return saved
    brief = await build_ops_brief(book, result)
    row = {
        'decision_id': None,
        'account_id': None,
        'ts': result.ts,
        'brief_date': brief_date,
        'audience': 'ops',
        'headline': brief['headline'],
        'body': brief['body'],
        'action_hint': None,
        'model': brief['model'],
    }
    await db.insert_explanations([row])
    return await db.daily_ops_brief(brief_date) or row


async def ensure_daily_briefs(book, result) -> None:
    """Generate each ET day's artifacts once; unique indexes arbitrate multi-worker races."""
    if ops_brief_due(result.ts):
        await ensure_ops_brief(book, result)
    if not digest_due(result.ts):
        return
    brief_date = cal.to_et(result.ts).date()
    existing = await db.daily_digest_account_ids(brief_date)
    semaphore = asyncio.Semaphore(4)

    async def generate(account_id: str) -> None:
        async with semaphore:
            account = book.account_view(account_id, result)
            decisions = decisions_for_account(book, result, account_id, account)
            await ensure_account_digest(account, decisions, result)

    await asyncio.gather(*(
        generate(account.id) for account in book.accounts if account.id not in existing
    ))


async def ops_brief_for_request(book, result) -> dict | None:
    brief_date = cal.to_et(result.ts).date()
    saved = await db.daily_ops_brief(brief_date)
    if saved is None and ops_brief_due(result.ts):
        saved = await ensure_ops_brief(book, result)
    if saved is None:
        saved = await db.latest_ops_brief(result.ts - timedelta(days=7))
    return saved


async def close() -> None:
    await llm.aclose()
