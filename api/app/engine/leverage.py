'''Max leverage = SAFETY / (adverse_move + slippage), phase-aware, concentration-haircut, capped.

All statistics must come from split-adjusted prices computed as-of the decision date.
'''
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .calendar import Phase

BASE_SLIPPAGE = 0.001       # 10 bps spread/impact floor
IMPACT_COEF = 0.10          # slippage += coef * sqrt(participation of ADV$)
CONC_THRESHOLD = 0.01       # > 1% of ADV$ starts the concentration haircut
CONC_FLOOR = 0.25
MIN_LEVERAGE = 1.0

# Pre-market books are a fraction of regular-session depth: a 4 AM screen may show a price with
# only a few hundred shares behind it. Charging slippage against *daily* ADV would price that
# tape as if it were midday liquidity, so participation is measured against the share of ADV
# that actually trades pre-market. This is the "thin pre-market" trap: the quote is real, the
# size behind it is not.
PRE_LIQUIDITY_FRACTION = 0.02   # ~2% of a day's dollar volume trades 04:00-09:30
CLOSED_LIQUIDITY_FRACTION = 0.05  # post-close/overnight: thin, but we are not trading anyway


def liquidity_fraction(phase: Phase) -> float:
    '''Share of a normal day's dollar volume reachable in ``phase``.

    Slippage and the concentration haircut are both functions of participation, so shrinking
    the denominator in the thin phases is what makes a pre-market exit correctly expensive.
    '''
    if phase == Phase.PRE:
        return PRE_LIQUIDITY_FRACTION
    if phase == Phase.CLOSED:
        return CLOSED_LIQUIDITY_FRACTION
    return 1.0


# --------------------------------------------------------------------------- sector signal
# While the US is shut, the same sector keeps trading elsewhere: TSMC and SK Hynix until 01:00
# ET, India until ~05:45, ASML until ~07:00. A sector that has already sold off hard overseas
# is evidence about how wide the US gap could be -- evidence the engine would otherwise ignore.
#
# Two rules keep this a risk measure rather than a price forecast:
#   1. It is direction-agnostic. A +4% sector move widens the gap exactly as much as -4%,
#      because the engine is sizing for volatility, not betting on a direction.
#   2. It can only ever WIDEN the move we must survive, never narrow it. A calm night overseas
#      is not permission to exceed the symbol's own historical p99.
SECTOR_BETA = 0.6           # how much of a peer move typically carries into the US name
SECTOR_MAX_WIDEN = 2.0      # hard ceiling: never more than double the historical gap
SECTOR_MIN_PEERS = 2        # below this, one thin foreign print could move the limit
SECTOR_QUIET = 0.005        # <= 0.5% average is an ordinary session: no adjustment at all


def sector_widen(peer_moves: list[tuple[float, float]]) -> float:
    """Multiplier (>= 1.0) applied to the overnight gap, from weighted peer moves.

    ``peer_moves`` is [(move, weight), ...] for peers whose sessions had *closed* by the
    decision time. Returns 1.0 when there is not enough evidence to act on.
    """
    usable = [(abs(m), w) for m, w in peer_moves if w > 0]
    if len(usable) < SECTOR_MIN_PEERS:
        return 1.0
    total_weight = sum(w for _, w in usable)
    if total_weight <= 0:
        return 1.0
    # Weighted mean absolute move: how much the sector actually moved, ignoring sign.
    dispersion = sum(m * w for m, w in usable) / total_weight
    if dispersion <= SECTOR_QUIET:
        return 1.0          # an ordinary overseas session tells us nothing new
    # Only the move *beyond* an ordinary session counts, scaled so a violent sector day
    # (~5% average) approaches the ceiling while a 1-2% day is a modest widening.
    excess = dispersion - SECTOR_QUIET
    return float(min(SECTOR_MAX_WIDEN, 1.0 + SECTOR_BETA * excess / 0.03))


@dataclass(frozen=True)
class SymbolRisk:
    symbol: str
    gap_p99: float
    intraday_p99: float
    earnings_gap_p99: float
    adv_dollar: float


@dataclass(frozen=True)
class LeverageResult:
    symbol: str
    max_leverage: float
    adverse_move: float
    slippage: float
    concentration_haircut: float
    phase: str
    earnings_tonight: bool
    reason: str
    frozen: bool = False
    sector_mult: float = 1.0
    sector_note: str = ''
    closure_mult: float = 1.0
    closure_hours: float = 0.0
    closure_label: str = ''
    basis_mult: float = 1.0
    basis_note: str = ''


def adverse_move(intraday_p99: float, gap_p99: float, earnings_gap_p99: float,
                 earnings_tonight: bool, phase: Phase, ramp: float,
                 sector_mult: float = 1.0, closure_mult: float = 1.0,
                 basis_mult: float = 1.0) -> float:
    overnight = earnings_gap_p99 if earnings_tonight else gap_p99
    # Three signals widen the *overnight* term only. None touches intraday risk, because none
    # says anything about how far price moves in the five minutes it takes us to exit:
    #   sector_mult  -- the sector already moved in markets that were open
    #   closure_mult -- this closure is longer than a normal night (a weekend is ~65 hours)
    #   basis_mult   -- the perp has drifted from a stock that is not trading
    overnight *= max(1.0, sector_mult) * max(1.0, closure_mult) * max(1.0, basis_mult)
    overnight = max(overnight, intraday_p99)
    if phase == Phase.OPEN:
        return intraday_p99
    if phase == Phase.CLOSING_RAMP:
        return intraday_p99 + ramp * (overnight - intraday_p99)
    return overnight  # PRE and CLOSED: you are exposed to the gap


def adverse_move_vec(intraday_p99: np.ndarray, gap_p99: np.ndarray, earnings_gap_p99: np.ndarray,
                     earnings_tonight: np.ndarray, phase: Phase, ramp: float,
                     sector_mult: np.ndarray | float = 1.0,
                     closure_mult: float = 1.0,
                     basis_mult: np.ndarray | float = 1.0) -> np.ndarray:
    overnight = np.where(earnings_tonight, earnings_gap_p99, gap_p99)
    overnight = (overnight * np.maximum(1.0, sector_mult) * max(1.0, closure_mult)
                 * np.maximum(1.0, basis_mult))
    overnight = np.maximum(overnight, intraday_p99)
    if phase == Phase.OPEN:
        return intraday_p99.copy()
    if phase == Phase.CLOSING_RAMP:
        return intraday_p99 + ramp * (overnight - intraday_p99)
    return overnight


def slippage(participation: float) -> float:
    return BASE_SLIPPAGE + IMPACT_COEF * math.sqrt(max(participation, 0.0))


def slippage_vec(participation: np.ndarray) -> np.ndarray:
    return BASE_SLIPPAGE + IMPACT_COEF * np.sqrt(np.maximum(participation, 0.0))


def concentration_haircut(participation: float) -> float:
    if participation <= CONC_THRESHOLD:
        return 1.0
    return max(CONC_FLOOR, 1.0 - 0.5 * math.log10(participation / CONC_THRESHOLD))


def concentration_haircut_vec(participation: np.ndarray) -> np.ndarray:
    ratio = np.maximum(participation / CONC_THRESHOLD, 1.0)
    return np.maximum(CONC_FLOOR, 1.0 - 0.5 * np.log10(ratio))


def _cap(x, cap: float):
    return np.clip(x, MIN_LEVERAGE, cap)


def max_leverage_vec(adverse: np.ndarray, participation: np.ndarray, safety: float, cap: float) -> np.ndarray:
    '''``participation`` must already be divided by the phase's reachable liquidity.'''
    slip = slippage_vec(participation)
    haircut = concentration_haircut_vec(participation)
    return _cap(haircut * safety / (adverse + slip), cap)


def max_leverage(risk: SymbolRisk, notional: float, phase: Phase, ramp: float,
                 earnings_tonight: bool, safety: float, cap: float,
                 sector_mult: float = 1.0, sector_note: str = '',
                 closure_mult: float = 1.0, closure_hours: float = 0.0,
                 closure_label: str = '', basis_mult: float = 1.0,
                 basis_note: str = '') -> LeverageResult:
    adv = adverse_move(risk.intraday_p99, risk.gap_p99, risk.earnings_gap_p99, earnings_tonight,
                       phase, ramp, sector_mult, closure_mult, basis_mult)
    reachable = max(risk.adv_dollar * liquidity_fraction(phase), 1.0)
    participation = abs(notional) / reachable
    slip = slippage(participation)
    haircut = concentration_haircut(participation)
    lev = float(_cap(haircut * safety / (adv + slip), cap))
    reason = (f'phase={phase.value} ramp={ramp:.2f} adverse={adv:.3f} slip={slip:.4f} '
              f'conc={haircut:.2f} participation={participation:.5f} '
              f'earnings={str(earnings_tonight).lower()} sector={sector_mult:.2f} '
              f'closure={closure_mult:.2f}/{closure_hours:.0f}h basis={basis_mult:.2f} cap={cap:g}')
    return LeverageResult(symbol=risk.symbol, max_leverage=round(lev, 2), adverse_move=adv, slippage=slip,
                          concentration_haircut=haircut, phase=phase.value,
                          earnings_tonight=earnings_tonight, reason=reason,
                          sector_mult=round(float(sector_mult), 4), sector_note=sector_note,
                          closure_mult=round(float(closure_mult), 4),
                          closure_hours=round(float(closure_hours), 2),
                          closure_label=closure_label,
                          basis_mult=round(float(basis_mult), 4), basis_note=basis_note)
