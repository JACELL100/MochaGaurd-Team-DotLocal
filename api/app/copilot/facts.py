'''Fact packs: pure Python, no LLM. The copilot may only narrate what is in here.'''
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from ..engine import calendar as cal

NUM_RE = re.compile(r'\d[\d,]*\.?\d*')


def fmt_pct(x: float | None, digits: int = 0) -> str:
    return '-' if x is None else f'{x * 100:.{digits}f}%'


def fmt_lev(x: float | None) -> str:
    if x is None:
        return '-'
    if x == 0:
        return '0x'
    # One decimal everywhere except a whole-number limit: a cap displayed as "19x" when the
    # engine actually returned 18.6x is a number the user cannot reconcile with the formula.
    return f'{x:.0f}x' if float(x).is_integer() else f'{x:.1f}x'


def fmt_money(x: float | None) -> str:
    if x is None:
        return '-'
    # Sign belongs outside the currency symbol: "-$1,200", never "$-1,200".
    return f'-${abs(x):,.0f}' if x < 0 else f'${x:,.0f}'


def fmt_shares(x: float | None) -> str:
    return '-' if x is None else f'{abs(x):,.0f}'


def local(ts: datetime, tz: str) -> str:
    try:
        z = ZoneInfo(tz)
    except Exception:
        z = ZoneInfo('UTC')
    loc = ts.astimezone(z)
    return loc.strftime('%I:%M %p').lstrip('0') + (' (next day)' if loc.date() > ts.astimezone(cal.ET).date() else '')


def build_fact_pack(decision: dict, account: dict, position: dict | None, ts: datetime) -> dict:
    '''``decision``: Decision.to_dict(); ``account``: account_view; ``position``: matching row or None.'''
    tz = account.get('tz') or 'UTC'
    deadline = cal.next_close(ts)
    derisk = deadline.replace(hour=15, minute=45)
    position_notional = (position or {}).get('notional')
    gross_exposure = account.get('gross_exposure')
    concentration = (position_notional / gross_exposure
                     if position_notional is not None and gross_exposure else None)
    earnings_tonight = bool((position or {}).get('earnings_tonight'))
    facts = {
        'symbol': decision.get('symbol') or 'your account',
        'is_account_level': decision.get('symbol') is None,
        'position_subject': ("the account's positions" if decision.get('symbol') is None
                             else f"your {decision['symbol']} position"),
        'action': decision['action'],
        'max_leverage': fmt_lev(decision.get('max_leverage')),
        'adverse_move': fmt_pct(decision.get('adverse_move') or (position or {}).get('adverse_move')),
        'gap_stat_used': 'earnings_gap_p99' if earnings_tonight else 'gap_p99',
        'risk_percentile': '99th percentile',
        'concentration': fmt_pct(concentration),
        'earnings_tonight': earnings_tonight,
        'earnings_window': 'before the next market open' if earnings_tonight else 'none',
        'frozen': bool((position or {}).get('frozen')) or decision['action'] == 'freeze',
        'qty_to_reduce': fmt_shares(decision.get('qty_to_reduce')),
        'position_qty': fmt_shares((position or {}).get('qty')),
        'position_notional': fmt_money(position_notional),
        'equity': fmt_money(decision.get('equity') if decision.get('equity') is not None else account.get('equity')),
        'margin_required': fmt_money(decision.get('margin_required') if decision.get('margin_required') is not None
                                     else account.get('margin_required')),
        'leverage_used': fmt_lev(account.get('leverage_used')),
        'worst_case_loss': fmt_money(account.get('worst_case_loss')),
        'user_tz': tz,
        'user_local_time': local(ts, tz),
        'deadline_et': '4:00 PM ET',
        'deadline_local': local(deadline, tz),
        'derisk_et': '3:45 PM ET',
        'derisk_local': local(derisk, tz),
        'reason': decision.get('reason') or '',
        'display_name': account.get('display_name') or 'there',
    }
    return facts


def _tokens(text: str) -> set[str]:
    out = set()
    for m in NUM_RE.findall(text or ''):
        t = m.replace(',', '').rstrip('.')
        if not t:
            continue
        try:
            f = float(t)
        except ValueError:
            continue
        out.add(f'{f:.6g}')
    return out


def _fact_values(value):
    if isinstance(value, dict):
        for nested in value.values():
            yield from _fact_values(nested)
    elif isinstance(value, (list, tuple, set)):
        for nested in value:
            yield from _fact_values(nested)
    elif not isinstance(value, bool):
        yield value


def allowed_numbers(facts: dict) -> set[str]:
    '''Every numeric token explicitly present in the fact pack, including nested values.'''
    allowed: set[str] = set()
    for value in _fact_values(facts):
        if isinstance(value, (str, int, float)):
            allowed |= _tokens(str(value))
    return allowed


def numbers_are_grounded(text: str, facts: dict) -> bool:
    '''The 15-line guard: every number in the narration must exist in the fact pack.'''
    return _tokens(text) <= allowed_numbers(facts)
