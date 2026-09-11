"""Grounded Groq narration and deterministic fallbacks.

The risk engine decides first.  This module receives its completed decisions only after they
have been persisted, and a failure here never changes or delays the risk result.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .. import db
from ..config import settings
from ..engine import calendar as cal
from .facts import build_fact_pack, fmt_money, fmt_pct, numbers_are_grounded
from .llm import LLMUnavailable, llm

_templates = Environment(loader=FileSystemLoader(Path(__file__).with_name('prompts')), undefined=StrictUndefined,
                         autoescape=False, trim_blocks=True, lstrip_blocks=True)


def _render(name: str, facts: dict) -> str:
    return _templates.get_template(name).render(f=facts).strip()


def _fallback_user(facts: dict) -> dict:
    lines = _render('fallback_user.j2', facts).splitlines()
    lines = [line.strip() for line in lines if line.strip()]
    return {'headline': lines[0] if lines else 'Risk update', 'body': lines[1] if len(lines) > 1 else '',
            'action_hint': lines[2] if len(lines) > 2 else ''}


async def explain_decisions(book, result, decisions: list[dict]) -> None:
    candidates: list[tuple[dict, dict]] = []
    for decision in decisions:
        if decision.get('action') not in {'freeze', 'reduce', 'margin_call', 'close'} or not decision.get('account_id'):
            continue
        account_id = str(decision['account_id'])
        try:
            account = book.account_view(account_id, result)
        except (KeyError, IndexError):
            continue
        position = next((p for p in account['positions'] if p['symbol'] == decision.get('symbol')), None)
        facts = build_fact_pack(decision, account, position, result.ts)
        candidates.append((decision, facts))

    async def narrate(decision: dict, facts: dict, use_llm: bool) -> dict:
        parsed, model = _fallback_user(facts), 'template'
        if use_llm:
            try:
                candidate = await llm.complete_json(_render('user_explain.j2', facts))
                body = ' '.join(str(candidate.get(key, '')).strip() for key in ('headline', 'body', 'action_hint'))
                if candidate.get('headline') and candidate.get('body') and numbers_are_grounded(body, facts):
                    parsed = {'headline': str(candidate['headline']).strip(), 'body': str(candidate['body']).strip(),
                              'action_hint': str(candidate.get('action_hint') or '').strip()}
                    model = llm.model
            except LLMUnavailable:
                pass
        return {'decision_id': decision['id'], 'account_id': decision['account_id'], 'ts': result.ts, 'audience': 'user',
                **parsed, 'model': model}

    # Bound outbound Groq work. Every remaining card uses the exact same fact-grounded
    # fallback, so a provider outage or rate limit never removes an explanation.
    semaphore = asyncio.Semaphore(4)
    limit = max(0, settings.max_llm_explanations_per_run)

    async def bounded(index: int, item: tuple[dict, dict]) -> dict:
        async with semaphore:
            return await narrate(*item, use_llm=index < limit)

    rows = await asyncio.gather(*(bounded(index, item) for index, item in enumerate(candidates)))
    await db.insert_explanations(rows)


def _headline_for(facts: dict) -> str:
    """One line naming the state and the deadline.

    Deliberately not "You are safe tonight": the engine sizes against a 1-in-100 move, which is
    not the same as safety, and a promise we cannot keep is the worst thing a risk product can
    say to someone about to go to sleep.
    """
    status = facts['status']
    if status == 'safe':
        if facts.get('has_positions') == 'no':
            return 'Nothing held overnight'
        return 'No action needed before tonight\'s close'
    if status == 'auto_derisk':
        return 'We are reducing your positions to protect the account'
    return f"Action needed before {facts['deadline_local']}"


def digest_facts(account: dict, decisions: list[dict], result) -> dict:
    action = [d for d in decisions if d.get('action') in {'reduce', 'margin_call', 'close'}]
    status = 'auto_derisk' if any(d.get('action') == 'close' for d in action) else ('action_needed' if action else 'safe')
    tz = account.get('tz') or 'UTC'
    deadline = cal.next_close(result.ts)
    derisk = deadline.replace(hour=15, minute=45)
    symbols = ', '.join(sorted({str(d.get('symbol')) for d in action if d.get('symbol')})) or 'none'
    earnings = ', '.join(p['symbol'] for p in account['positions'] if p['earnings_tonight']) or 'none'
    frozen = ', '.join(p['symbol'] for p in account['positions'] if p['frozen']) or 'none'
    return {
        'display_name': account.get('display_name') or 'there', 'user_tz': tz,
        'user_local_time': cal.local_time_str(result.ts, tz), 'status': status,
        'equity': fmt_money(account['equity']), 'gross_exposure': fmt_money(account['gross_exposure']),
        'leverage_used': f"{account['leverage_used'] or 0:.1f}x", 'margin_required': fmt_money(account['margin_required']),
        'worst_case_loss': fmt_money(account['worst_case_loss']),
        'worst_case_pct': fmt_pct(account['worst_case_loss'] / max(account['equity'], 1)),
        # Jinja templates compare strings; a bool would render as 'True'/'False' in text.
        'has_positions': 'yes' if account.get('positions') else 'no',
        'n_actions': len(action), 'flagged_symbols': symbols, 'earnings_symbols': earnings, 'frozen_symbols': frozen,
        'deadline_et': '4:00 PM ET', 'deadline_local': cal.local_time_str(deadline, tz),
        'derisk_et': '3:45 PM ET', 'derisk_local': cal.local_time_str(derisk, tz),
    }


async def tonight_digest(account: dict, decisions: list[dict], result) -> dict:
    facts = digest_facts(account, decisions, result)
    fallback = _render('fallback_digest.j2', facts)
    headline = _headline_for(facts)
    model = 'template'
    try:
        candidate = await llm.complete_json(_render('tonight_digest.j2', facts))
        body = ' '.join(str(candidate.get(key, '')).strip() for key in ('headline', 'summary'))
        if candidate.get('headline') and candidate.get('summary') and numbers_are_grounded(body, facts):
            headline, fallback, model = str(candidate['headline']).strip(), str(candidate['summary']).strip(), llm.model
    except LLMUnavailable:
        pass
    return {'status': facts['status'], 'headline': headline, 'summary': fallback, 'model': model,
            'deadline_et': facts['deadline_et'], 'deadline_local': facts['deadline_local'],
            'local_time': facts['user_local_time']}


def deterministic_tonight_digest(account: dict, decisions: list[dict], result) -> dict:
    """A request-path digest that has no network or LLM dependency."""
    facts = digest_facts(account, decisions, result)
    headline = _headline_for(facts)
    return {'status': facts['status'], 'headline': headline, 'summary': _render('fallback_digest.j2', facts),
            'model': 'template', 'deadline_et': facts['deadline_et'], 'deadline_local': facts['deadline_local'],
            'local_time': facts['user_local_time']}


async def ops_brief(result) -> None:
    s = result.summary
    facts = {**s, 'as_of_et': cal.to_et(result.ts).strftime('%Y-%m-%d %H:%M'),
             'gross_exposure': fmt_money(s['gross_exposure']), 'net_equity': fmt_money(s['net_equity']),
             'worst_case_loss': fmt_money(s['worst_case_loss']), 'broker_loss_at_p99': fmt_money(s['broker_loss_at_p99']),
             'avg_leverage_used': f"{s['avg_leverage_used']:.1f}x",
             'earnings_tonight': ', '.join(s['earnings_tonight']) or 'none',
             'frozen_symbols': ', '.join(s['frozen_symbols']) or 'none',
             'top_concentration': ', '.join(x['symbol'] for x in s['top_concentration']) or 'none'}
    body, model = _render('fallback_ops.j2', facts), 'template'
    try:
        candidate = await llm.complete_json(_render('ops_brief.j2', facts), max_tokens=160)
        if candidate.get('body') and numbers_are_grounded(str(candidate['body']), facts):
            body, model = str(candidate['body']).strip(), llm.model
    except LLMUnavailable:
        pass
    await db.insert_explanations([{'decision_id': None, 'account_id': None, 'ts': result.ts, 'audience': 'ops',
                                   'headline': 'Daily risk brief', 'body': body, 'action_hint': None, 'model': model}])
