'''Oracle/basis risk: the perp can mark away from a stock that is not trading.

Why this replaces the liquidity model for a perp
------------------------------------------------
On a spot venue the overnight danger is that you *cannot sell*. On a perpetual-futures venue
you can always sell -- the perp trades 24/7. The danger inverts: the contract keeps printing
prices while the asset it references is shut, so the perp and the underlying drift apart.

That drift is the basis. It matters for two reasons:

  1. **Liquidation on a price nobody can arbitrage.** With the stock shut there is no mechanism
     forcing the perp back to fair value, so a thin book can mark a position into liquidation
     at a price the underlying never touched.
  2. **The snap at the open.** When the US session reopens, the basis closes -- often violently.
     A position that looked healthy against a stretched perp price is repriced in seconds.

So while the underlying is shut, margin must widen with the basis rather than with liquidity.
A perp trading 3% above a stock that has not printed in twelve hours is carrying 3% of pure
convergence risk on top of whatever the stock itself does.

Sign convention: basis = perp / underlying - 1. Positive means the perp is rich.
'''
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from . import calendar as cal

# A perp within this band of the underlying is simply tracking; no adjustment.
BASIS_QUIET = 0.003            # 0.3%
# How much of the observed basis is treated as convergence risk to be margined.
BASIS_BETA = 0.8
BASIS_MAX_WIDEN = 2.5          # ceiling, as with every other multiplier in the engine
# Staleness of the underlying reference beyond which basis is the dominant risk, not a detail.
STALE_HOURS = 2.0


@dataclass(frozen=True)
class BasisState:
    symbol: str
    perp_price: float
    underlying_price: float
    basis: float                   # perp/underlying - 1
    underlying_age_hours: float    # how long since the stock last printed
    underlying_open: bool
    multiplier: float              # >= 1.0, applied to the adverse move
    note: str


def widen(basis: float, underlying_open: bool) -> float:
    '''Margin multiplier from the current basis.

    Direction-agnostic, like the sector signal: a perp trading rich converges *down* and a perp
    trading cheap converges *up*, and either way the holder on the wrong side loses. And while
    the underlying is open, arbitrage keeps the two tethered, so no widening is applied at all.
    '''
    if underlying_open:
        return 1.0
    size = abs(basis)
    if size <= BASIS_QUIET:
        return 1.0
    excess = size - BASIS_QUIET
    return float(min(BASIS_MAX_WIDEN, 1.0 + BASIS_BETA * excess / 0.01))


def assess(symbol: str, perp_price: float, underlying_price: float,
           underlying_ts: datetime, ts: datetime) -> BasisState:
    '''Basis state for one symbol at ``ts``.'''
    if underlying_price <= 0 or perp_price <= 0:
        return BasisState(symbol, perp_price, underlying_price, 0.0, 0.0, True, 1.0,
                          'No usable reference price.')
    basis = perp_price / underlying_price - 1.0
    age = max(0.0, (ts - underlying_ts).total_seconds() / 3600.0)
    is_open = cal.phase_at(ts) in (cal.Phase.OPEN, cal.Phase.CLOSING_RAMP)
    mult = widen(basis, is_open)

    if is_open:
        note = ('The US market is open, so arbitrage keeps the contract tied to the stock. '
                'No extra margin for basis.')
    elif mult <= 1.0:
        note = (f'The contract is tracking {symbol} closely ({basis * 100:+.2f}%), so there is '
                f'little to converge at the open.')
    else:
        rich = 'above' if basis > 0 else 'below'
        note = (f'The contract is trading {abs(basis) * 100:.2f}% {rich} {symbol}, and the stock '
                f'has not printed for {age:.1f} hours. Nothing forces them back together until '
                f'the US open — and when it comes, that gap closes fast.')
    return BasisState(symbol, round(perp_price, 4), round(underlying_price, 4), round(basis, 6),
                      round(age, 2), is_open, round(mult, 4), note)


def describe(state: BasisState) -> dict:
    '''Plain-language account of the basis, for a user who has never heard the word.'''
    if state.underlying_open:
        return {
            'headline': f'{state.symbol} is tracking the real stock',
            'why': ('The US market is open, so traders can arbitrage any gap between the '
                    'contract and the share price. The two stay locked together.'),
            'severity': 'ok'}
    if state.multiplier <= 1.0:
        return {
            'headline': f'{state.symbol} contract is close to the last share price',
            'why': (f'The contract is {state.basis * 100:+.2f}% from where {state.symbol} last '
                    f'traded. Small enough that the reopen should not move you much.'),
            'severity': 'ok'}
    rich = 'more than' if state.basis > 0 else 'less than'
    severity = 'critical' if state.multiplier >= 1.8 else 'warning'
    return {
        'headline': (f'{state.symbol} contract is priced {abs(state.basis) * 100:.1f}% '
                     f'{rich} the real stock'),
        'why': (f'{state.symbol} shares have not traded for {state.underlying_age_hours:.0f} '
                f'hours, but the contract kept moving. There is no way to arbitrage that gap '
                f'while the market is shut, so we hold {state.multiplier:.2f}x more margin '
                f'against it — when the US opens, that gap tends to close in seconds.'),
        'severity': severity,
    }
