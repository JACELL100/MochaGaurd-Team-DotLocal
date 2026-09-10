'''Freeze guards. Written first, tested first.

A frozen symbol is never liquidated or re-levered in this evaluation. Liquidating on a
split day (a 4-for-1 looks like a -75% crash on unadjusted data) disqualifies the day.
'''
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .calendar import Phase, phase_at

STALE_AFTER = timedelta(minutes=15)
IMPLAUSIBLE_MOVE = 0.35            # > 35% vs prev close without earnings context
IMPLAUSIBLE_MOVE_EARNINGS = 0.60   # earnings names may legitimately move a lot


@dataclass(frozen=True)
class SymbolSnapshot:
    symbol: str
    last_price: float
    last_price_ts: datetime
    prev_close: float
    halted: bool = False
    split_today: bool = False
    earnings_window: bool = False


@dataclass(frozen=True)
class GuardResult:
    frozen: bool
    reasons: tuple[str, ...]


def check(snap: SymbolSnapshot, ts: datetime) -> GuardResult:
    reasons: list[str] = []
    if snap.split_today:
        reasons.append('split_effective')
    if snap.halted:
        reasons.append('halted')
    if snap.last_price <= 0 or snap.prev_close <= 0:
        reasons.append('bad_price')
    else:
        in_session = phase_at(ts) in (Phase.OPEN, Phase.CLOSING_RAMP)
        if in_session and (ts - snap.last_price_ts) > STALE_AFTER:
            reasons.append('stale_price')
        move = abs(snap.last_price / snap.prev_close - 1.0)
        threshold = IMPLAUSIBLE_MOVE_EARNINGS if snap.earnings_window else IMPLAUSIBLE_MOVE
        if move > threshold:
            reasons.append(f'implausible_move={move:.3f}')
    return GuardResult(frozen=bool(reasons), reasons=tuple(reasons))
