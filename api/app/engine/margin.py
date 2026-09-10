'''Overnight survival check. Assumes ZERO user response (the user is asleep): auto de-risk.

Actions: hold | reduce | margin_call | close.
'''
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

MAINT_BUFFER = 0.05  # keep 5% headroom above required margin after de-risking


@dataclass(frozen=True)
class PositionView:
    symbol: str
    qty: float
    price: float
    adverse: float
    max_leverage: float
    frozen: bool = False


@dataclass
class MarginPlan:
    action: str
    equity: float
    margin_required: float
    worst_case_loss: float
    reductions: dict[str, float] = field(default_factory=dict)  # symbol -> signed qty to sell/cover
    reason: str = ''


def flag_accounts(equity: np.ndarray, margin_req: np.ndarray, worst: np.ndarray, gross: np.ndarray) -> np.ndarray:
    '''Vectorized pre-filter: only flagged accounts get the per-account planner.'''
    has_positions = gross > 0
    return has_positions & ((equity < margin_req) | (equity - worst <= 0))


def plan(cash: float, positions: list[PositionView], buffer: float = MAINT_BUFFER) -> MarginPlan:
    gross = sum(abs(p.qty * p.price) for p in positions)
    equity = cash + sum(p.qty * p.price for p in positions)
    worst = sum(abs(p.qty * p.price) * p.adverse for p in positions)
    req = sum(abs(p.qty * p.price) / p.max_leverage for p in positions)

    if gross <= 0:
        return MarginPlan('hold', equity, req, worst, reason='no positions')

    if equity <= 0:
        red = {p.symbol: p.qty for p in positions if not p.frozen and p.qty}
        return MarginPlan('close', equity, req, worst, red,
                          reason=f'equity={equity:.0f}<=0 gross={gross:.0f}')

    if equity >= req and equity - worst > 0:
        return MarginPlan('hold', equity, req, worst,
                          reason=f'equity={equity:.0f} margin_req={req:.0f} worst={worst:.0f}')

    worst_before = worst
    target_margin = equity / (1.0 + buffer)
    excess = req - target_margin
    reductions: dict[str, float] = {}

    # worst adverse first: it frees the most margin per dollar sold
    for p in sorted(positions, key=lambda p: p.adverse, reverse=True):
        if p.frozen or p.qty == 0:
            continue
        if excess <= 0 and worst < equity * (1.0 - buffer):
            break
        per_unit_margin = p.price / p.max_leverage
        per_unit_worst = p.price * p.adverse
        need_units = excess / per_unit_margin if excess > 0 else 0.0
        if worst >= equity * (1.0 - buffer):
            need_units = max(need_units, (worst - equity * (1.0 - buffer)) / per_unit_worst)
        r = min(abs(p.qty), need_units)
        if r <= 0:
            continue
        reductions[p.symbol] = r if p.qty > 0 else -r
        excess -= r * per_unit_margin
        worst -= r * per_unit_worst

    price_of = {p.symbol: p.price for p in positions}
    reduced_notional = sum(abs(q) * price_of[s] for s, q in reductions.items())
    frac = reduced_notional / gross if gross else 0.0
    action = 'margin_call' if frac >= 0.5 else 'reduce'
    reason = (f'equity={equity:.0f} margin_req={req:.0f} worst={worst_before:.0f} '
              f'reduce_frac={frac:.2f}')
    if excess > 0:
        reason += ' unresolved=frozen_positions'
    return MarginPlan(action, equity, req, worst_before, reductions, reason)


HEALTH_BUCKETS = ((0.0, 1.0, '<1.0'), (1.0, 1.25, '1.0-1.25'), (1.25, 1.5, '1.25-1.5'),
                  (1.5, 2.0, '1.5-2'), (2.0, 3.0, '2-3'), (3.0, float('inf'), '>3'))


def health_histogram(equity: np.ndarray, margin_req: np.ndarray, gross: np.ndarray) -> list[dict]:
    mask = (margin_req > 0) & (gross > 0)
    ratio = equity[mask] / margin_req[mask]
    return [{'bucket': label, 'count': int(np.sum((ratio >= lo) & (ratio < hi)))}
            for lo, hi, label in HEALTH_BUCKETS]
