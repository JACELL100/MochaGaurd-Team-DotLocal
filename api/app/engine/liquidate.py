'''Open-bell unwind with an explicit market-impact model. No free liquidations.

Worst margin ratio first. Own participation is capped at ~10% of expected minute volume;
slippage is a function of that participation and of how many minutes the unwind takes.
'''
from __future__ import annotations

import math
from dataclasses import dataclass

PARTICIPATION_CAP = 0.10
SPREAD = 0.0005
IMPACT = 0.10
DURATION_DRIFT = 0.0002  # extra adverse drift per sqrt(minute) while we are in the market


@dataclass(frozen=True)
class Order:
    account_id: str
    symbol: str
    qty: float            # signed: +sell long, -cover short
    ref_price: float
    minute_volume: float  # expected shares per minute
    margin_ratio: float   # equity / margin_required; lower is worse


@dataclass(frozen=True)
class Fill:
    account_id: str
    symbol: str
    qty: float
    ref_price: float
    fill_price: float
    slippage_bps: float
    minutes: int
    proceeds: float       # signed cash impact


def slippage_for(participation: float, minutes: int) -> float:
    return SPREAD + IMPACT * math.sqrt(max(participation, 0.0)) + DURATION_DRIFT * math.sqrt(max(minutes - 1, 0))


def unwind(orders: list[Order]) -> list[Fill]:
    fills: list[Fill] = []
    for o in sorted(orders, key=lambda o: o.margin_ratio):
        qty = abs(o.qty)
        if qty == 0:
            continue
        per_minute = max(PARTICIPATION_CAP * o.minute_volume, 1.0)
        minutes = max(1, math.ceil(qty / per_minute))
        participation = PARTICIPATION_CAP if minutes > 1 else qty / max(o.minute_volume, 1.0)
        slip = slippage_for(participation, minutes)
        direction = 1.0 if o.qty > 0 else -1.0
        fill_price = o.ref_price * (1.0 - direction * slip)
        proceeds = o.qty * fill_price
        fills.append(Fill(o.account_id, o.symbol, o.qty, o.ref_price, fill_price, slip * 1e4, minutes, proceeds))
    return fills
