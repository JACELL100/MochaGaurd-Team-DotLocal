'''Perpetual-futures carry: what holding a position costs while you sleep.

Why this module exists
----------------------
A perp has no expiry, so the venue charges *funding* to keep the contract tethered to the
underlying. Hyperliquid pays it hourly at one eighth of the computed rate. Mochatrade shows it
to users as "holding cost".

That is a rate, and a rate is not actionable. At 20x a position carries 20x its own equity, so
funding is charged on the *notional* while the loss lands on the *equity* -- which means carry
alone can breach maintenance margin without the price moving at all. The number a trader
actually needs is a deadline: "at this rate, this position liquidates on Thursday at 4 AM."

So this module answers three questions the rate alone cannot:

  1. What does this position cost per hour, per day, and until the next open?
  2. If the price never moves, when does funding alone liquidate it?
  3. How much of the safety buffer is carry already eating, before any market move?

Convention: a POSITIVE rate means longs pay shorts (the perp trades above the underlying).
Rates are per-hour fractions of notional, matching the venue.
'''
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from . import calendar as cal

# Hyperliquid-style hourly settlement. Stated as a per-hour fraction of notional.
HOURS_PER_DAY = 24
# Beyond this horizon a "liquidated by funding" answer is noise: the rate will have changed
# many times over, and quoting a date months out would be false precision.
MAX_HORIZON_HOURS = 24 * 60


@dataclass(frozen=True)
class FundingRate:
    '''Current hourly funding for one symbol.'''
    symbol: str
    hourly: float             # fraction of notional per hour; + means longs pay
    as_of: datetime | None = None
    source: str = 'venue'

    @property
    def daily(self) -> float:
        return self.hourly * HOURS_PER_DAY

    @property
    def annualised(self) -> float:
        return self.hourly * HOURS_PER_DAY * 365


@dataclass(frozen=True)
class FundingCost:
    '''What carry costs one position, and when it becomes fatal on its own.'''
    symbol: str
    side: str                       # 'long' | 'short'
    notional: float
    hourly_cost: float              # signed: positive = the trader pays
    daily_cost: float
    cost_to_next_open: float
    hours_to_next_open: float
    # None when carry is neutral or being *earned* -- there is no deadline to warn about.
    hours_to_liquidation: float | None
    liquidation_at: datetime | None
    # Share of the account's spare equity that carry consumes per day.
    daily_share_of_buffer: float | None
    pays: bool                      # True when the trader pays, False when they receive


def cost_over(rate: FundingRate, notional: float, qty: float, hours: float) -> float:
    '''Signed funding over ``hours``. Positive = the trader pays.

    Funding is charged on notional, and the sign flips for shorts: when the rate is positive
    longs pay shorts, so a short *earns* it.
    '''
    direction = 1.0 if qty >= 0 else -1.0
    return rate.hourly * abs(notional) * direction * hours


def hours_until_liquidation(rate: FundingRate, notional: float, qty: float,
                            equity: float, margin_required: float) -> float | None:
    '''Hours of carry alone before equity falls below the margin required.

    Returns None when the trader is *earning* carry (no deadline), when the position is already
    below maintenance (there is nothing to count down to), or when the answer is further out
    than ``MAX_HORIZON_HOURS`` -- at which point a date would be false precision.
    '''
    hourly = cost_over(rate, notional, qty, 1.0)
    if hourly <= 0:
        return None                      # earning carry, or a zero rate
    spare = equity - margin_required
    if spare <= 0:
        return 0.0                       # already breached; carry is not the cause
    hours = spare / hourly
    return hours if hours <= MAX_HORIZON_HOURS else None


def assess(rate: FundingRate, *, symbol: str, qty: float, price: float, ts: datetime,
           equity: float, margin_required: float) -> FundingCost:
    '''Full carry picture for one position at ``ts``.'''
    notional = abs(qty * price)
    hourly = cost_over(rate, notional, qty, 1.0)
    next_open = cal.next_open(ts)
    hours_to_open = max(0.0, (next_open - ts).total_seconds() / 3600.0)
    hours_to_liq = hours_until_liquidation(rate, notional, qty, equity, margin_required)
    spare = equity - margin_required

    return FundingCost(
        symbol=symbol,
        side='long' if qty >= 0 else 'short',
        notional=round(notional, 2),
        hourly_cost=round(hourly, 4),
        daily_cost=round(hourly * HOURS_PER_DAY, 2),
        cost_to_next_open=round(hourly * hours_to_open, 2),
        hours_to_next_open=round(hours_to_open, 2),
        hours_to_liquidation=round(hours_to_liq, 2) if hours_to_liq is not None else None,
        liquidation_at=(ts + timedelta(hours=hours_to_liq)) if hours_to_liq else None,
        daily_share_of_buffer=(round(hourly * HOURS_PER_DAY / spare, 4)
                               if spare > 0 and hourly > 0 else None),
        pays=hourly > 0,
    )


def book_carry(costs: list[FundingCost]) -> dict:
    '''Net carry across a book: what the whole account pays or earns per day.'''
    paid = sum(c.daily_cost for c in costs if c.daily_cost > 0)
    earned = -sum(c.daily_cost for c in costs if c.daily_cost < 0)
    soonest = min((c for c in costs if c.hours_to_liquidation is not None),
                  key=lambda c: c.hours_to_liquidation, default=None)
    return {
        'daily_paid': round(paid, 2),
        'daily_earned': round(earned, 2),
        'daily_net': round(paid - earned, 2),
        'positions_paying': sum(1 for c in costs if c.pays),
        'positions_earning': sum(1 for c in costs if not c.pays and c.daily_cost < 0),
        'soonest_symbol': soonest.symbol if soonest else None,
        'soonest_hours': soonest.hours_to_liquidation if soonest else None,
    }


def humanise_hours(hours: float | None) -> str:
    '''"in 3 days" / "in 14 hours" -- a horizon a person can act on.'''
    if hours is None:
        return 'not at this rate'
    if hours <= 0:
        return 'already breached'
    if hours < 1:
        return f'in {int(round(hours * 60))} minutes'
    if hours < 48:
        return f'in {int(round(hours))} hours'
    days = hours / 24.0
    if days < 14:
        return f'in {days:.1f} days'
    if days < 60:
        return f'in {int(round(days / 7))} weeks'
    return f'in {int(round(days / 30))} months'


def describe(cost: FundingCost, tz: str = 'UTC') -> dict:
    '''Plain-language account of carry for one position.'''
    if not cost.pays:
        if cost.daily_cost == 0:
            return {'headline': f'{cost.symbol} costs nothing to hold right now',
                    'why': 'Funding is flat, so holding this position overnight is free.',
                    'severity': 'ok'}
        return {
            'headline': f'{cost.symbol} pays you {_money(-cost.daily_cost)} a day to hold',
            'why': (f'Funding is negative for your side, so you are being paid to keep this '
                    f'position open — about {_money(-cost.daily_cost)} per day at the current '
                    f'rate.'),
            'severity': 'ok'}

    when = humanise_hours(cost.hours_to_liquidation)
    local = cal.local_time_str(cost.liquidation_at, tz) if cost.liquidation_at else None
    body = (f'Holding {cost.symbol} costs {_money(cost.daily_cost)} a day in funding — '
            f'{_money(cost.cost_to_next_open)} just to carry it to the next US open. '
            f'That is charged on the full {_money(cost.notional)} position, not on your equity.')
    if cost.hours_to_liquidation is None:
        return {'headline': f'{cost.symbol} costs {_money(cost.daily_cost)} a day to hold',
                'why': body + ' At this rate funding alone will not liquidate it.',
                'severity': 'info'}

    severity = ('critical' if cost.hours_to_liquidation <= 24
                else 'warning' if cost.hours_to_liquidation <= 24 * 7 else 'info')
    deadline = f' ({local} your time)' if local else ''
    return {
        'headline': f'{cost.symbol} liquidates on funding alone {when}',
        'why': (body + f' If the price never moves at all, that cost alone breaks your margin '
                       f'{when}{deadline}.'),
        'severity': severity,
    }


def _money(x: float) -> str:
    if x is None:
        return '-'
    return f'-${abs(x):,.0f}' if x < 0 else f'${x:,.0f}'
