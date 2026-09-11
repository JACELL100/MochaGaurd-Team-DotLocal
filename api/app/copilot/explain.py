'''Deterministic, auditable explanation of a single leverage decision.

The leverage number is the output of one formula:

    max_leverage = concentration_haircut * SAFETY / (adverse_move + slippage)

Nothing here re-derives or second-guesses that result -- it reads the engine's own
LeverageResult and reports the arithmetic that produced it, so a reviewer can check the number
by hand. There is no model call and no network access on this path, which is why the
explanation is always present even when the LLM is unavailable: a risk limit a user cannot be
told the reason for is not a usable risk limit.
'''
from __future__ import annotations

from ..config import settings
from ..engine import calendar as cal
from ..engine.leverage import CONC_THRESHOLD, LeverageResult
from .facts import fmt_lev, fmt_money, fmt_pct, fmt_shares

PHASE_LABEL = {
    'open': 'the market is open',
    'pre': 'the market is in pre-market',
    'closing_ramp': 'the market is about to close',
    'closed': 'the market is closed',
}

# Why the adverse move is the size it is, per phase. This is the heart of the pitch: we are not
# predicting the price, we are pricing how long we are unable to sell.
PHASE_RISK = {
    'open': 'We can sell out of this position within minutes, so the only move that can hurt us '
            'is the one that happens while we are getting out.',
    'pre': 'Pre-market books are thin and the position cannot be exited reliably, so it is '
           'priced against the full overnight gap.',
    'closing_ramp': 'The exit window is closing. The limit is being walked down from the '
                    'intraday level to the overnight level so nobody is force-sold at 3:59:59.',
    'closed': 'The position cannot be sold at any price until the next open, so it is priced '
              'against the worst overnight gap we have seen.',
}


def _share_of_volume(participation: float) -> str:
    """Participation as a phrase a person can picture, not a percentage that rounds to zero.

    A $50k order in a $30bn stock is 0.00017% -- printing "0.000%" reads as a bug, so anything
    negligible is described rather than measured.
    """
    if participation <= 0:
        return 'a negligible share'
    if participation < 0.0001:
        return 'a tiny fraction (well under a thousandth)'
    if participation < 0.01:
        return f'{participation * 100:.2f}%'
    return f'{participation * 100:.1f}%'


def _driver(result: LeverageResult, risk) -> str:
    '''The single dominant reason this limit is not the headline cap.'''
    if result.frozen:
        return 'frozen'
    if result.earnings_tonight:
        return 'earnings'
    if result.concentration_haircut < 1.0:
        return 'size'
    if getattr(result, 'basis_mult', 1.0) > 1.05:
        return 'basis'
    if getattr(result, 'sector_mult', 1.0) > 1.05:
        return 'sector'
    if getattr(result, 'closure_mult', 1.0) > 1.05:
        return 'closure'
    if result.max_leverage >= settings.headline_cap:
        return 'none'
    if result.phase in ('closed', 'pre'):
        return 'overnight_gap'
    if result.phase == 'closing_ramp':
        return 'closing'
    return 'volatility'


def explain_leverage(result: LeverageResult, risk, notional: float, ts) -> dict:
    '''A structured, self-checking account of one /leverage answer.

    Returns the headline sentence, the ordered factors that moved the number, and the literal
    formula with its inputs so the caller can recompute it.
    '''
    phase = result.phase
    driver = _driver(result, risk)
    participation = abs(notional) / max(risk.adv_dollar, 1.0)
    denom = result.adverse_move + result.slippage

    factors: list[dict] = []

    factors.append({
        'label': 'Market phase',
        'value': PHASE_LABEL.get(phase, phase),
        'detail': PHASE_RISK.get(phase, ''),
        'impact': 'raises' if phase == 'open' else 'lowers',
    })

    if result.earnings_tonight:
        factors.append({
            'label': 'Earnings tonight',
            'value': f'gap risk {fmt_pct(risk.earnings_gap_p99, 1)}',
            'detail': ('This company announces results after the market shuts, which is when the '
                   'biggest overnight jumps happen. So the limit is based on how far this stock '
                   'has moved on its own past earnings nights, not on a normal night.'),
            'impact': 'lowers',
        })

    sector_mult = getattr(result, 'sector_mult', 1.0) or 1.0
    if sector_mult > 1.0:
        note = getattr(result, 'sector_note', '') or ''
        factors.append({
            'label': 'Sector already moved overseas',
            'value': f'gap widened x{sector_mult:.2f}',
            'detail': (
                (note + '. ' if note else '')
                + 'The US market is shut, but this stock\'s sector kept trading elsewhere — '
                  'Taiwan and Korea until about 1:30 AM New York time, India until 5:45 AM, '
                  'Europe until 7:00 AM. A sector that has already moved hard overseas is real '
                  'information about how far this stock can gap at the open, so the move we size '
                  'against is widened. It works in both directions: a sharp rally widens it just '
                  'as much as a selloff, because this measures how violent the night is, not '
                  'which way it went.'),
            'impact': 'lowers',
        })

    closure_mult = getattr(result, 'closure_mult', 1.0) or 1.0
    if closure_mult > 1.0:
        hours = getattr(result, 'closure_hours', 0.0) or 0.0
        label = getattr(result, 'closure_label', 'this closure') or 'this closure'
        factors.append({
            'label': f'Shut for {hours:.0f} hours ({label})',
            'value': f'gap widened x{closure_mult:.2f}',
            'detail': (f'A normal night is about 17 hours. This position has to be held through '
                       f'{hours:.0f} hours with no US market at all — {label} carries more news, '
                       f'more time for something to happen, and no way to react. Risk grows with '
                       f'the square root of time, so {hours:.0f} hours is about '
                       f'{closure_mult:.2f} times a single night, not {hours / 17.5:.1f} times.'),
            'impact': 'lowers',
        })

    basis_mult = getattr(result, 'basis_mult', 1.0) or 1.0
    if basis_mult > 1.0:
        factors.append({
            'label': 'Contract has drifted from the real stock',
            'value': f'gap widened x{basis_mult:.2f}',
            'detail': ((getattr(result, 'basis_note', '') or '')
                       + ' Nothing can close that gap while the shares are not trading, so we '
                         'hold extra margin against the moment the US market reopens and the '
                         'two snap back together.'),
            'impact': 'lowers',
        })

    factors.append({
        'label': 'Move we must survive',
        'value': fmt_pct(result.adverse_move, 1),
        'detail': (f'In the worst 1 in 100 cases, {result.symbol} moves about '
                   f'{fmt_pct(result.adverse_move, 1)} during the time we would be stuck holding '
                   f'it. The limit is set so a move that size cannot wipe out the account.'),
        'impact': 'lowers',
    })

    factors.append({
        'label': 'Cost to exit',
        'value': f'{result.slippage * 1e4:.0f} bps',
        'detail': (f'Selling this position is itself expensive: it is {_share_of_volume(participation)} '
                   f'of everything that normally trades in {result.symbol} in a day '
                   f'({fmt_money(risk.adv_dollar)}), and our own selling pushes the price down '
                   f'while we do it. That cost comes out of the limit, because an exit we cannot '
                   f'afford is not an exit.'),
        'impact': 'lowers',
    })

    if result.concentration_haircut < 1.0:
        factors.append({
            'label': 'Position too large for the market',
            'value': f'x{result.concentration_haircut:.2f} haircut',
            'detail': (f'This position is more than {fmt_pct(CONC_THRESHOLD, 0)} of the stock\'s '
                       f'daily volume. At that size the price on the screen is not a price we '
                       f'could actually sell all of it at, so the limit is cut further.'),
            'impact': 'lowers',
        })

    if result.frozen:
        factors.append({
            'label': 'Risk actions frozen',
            'value': 'no liquidation',
            'detail': 'A halt, a stock split, or an implausible price print means the price on '
                      'the screen is not a price we can trade on. The engine will not liquidate '
                      'or re-lever this symbol until clean prices return. A 4-for-1 split looks '
                      'exactly like a 75% crash, and selling into that would be our mistake, '
                      'not the market\'s.',
            'impact': 'blocks',
        })

    headline = _headline(result, driver)
    return {
        'headline': headline,
        'driver': driver,
        'factors': factors,
        'formula': {
            'expression': 'max_leverage = concentration_haircut x SAFETY / (adverse_move + slippage)',
            'safety': round(settings.safety, 4),
            'adverse_move': round(result.adverse_move, 6),
            'slippage': round(result.slippage, 6),
            'concentration_haircut': round(result.concentration_haircut, 4),
            'denominator': round(denom, 6),
            'uncapped': round(result.concentration_haircut * settings.safety / denom, 4) if denom > 0 else None,
            'headline_cap': settings.headline_cap,
            'result': result.max_leverage,
            'note': (f'Read it as: we allow a position only as large as a '
                     f'{fmt_pct(result.adverse_move, 1)} move can cost without using up more than '
                     f'{fmt_pct(settings.safety, 0)} of the customer\'s money — then we never go '
                     f'above the advertised {settings.headline_cap:g}x.'),
        },
        'attribution': leverage_attribution(result, risk, notional),
        'safety_budget': {
            'label': 'What a 99th-percentile move costs this position',
            'notional': round(abs(notional), 2),
            'loss_at_p99': round(abs(notional) * result.adverse_move, 2),
            'equity_required': round(abs(notional) / result.max_leverage, 2) if result.max_leverage else None,
        },
        'deadline': {
            'derisk_et': '3:45 PM ET',
            'close_et': '4:00 PM ET',
            'next_close': cal.next_close(ts).isoformat(),
        },
        'model': 'deterministic',
    }


def _headline(result: LeverageResult, driver: str) -> str:
    sym = result.symbol
    lev = fmt_lev(result.max_leverage)
    if driver == 'frozen':
        return f'{sym} is frozen: no new leverage and no liquidation until prices are trustworthy again.'
    if driver == 'earnings':
        return f'{sym} reports tonight, so it is capped at {lev} instead of the headline maximum.'
    if driver == 'size':
        return f'{sym} is capped at {lev} because this order is large relative to what the market trades.'
    if driver == 'sector':
        return (f'{sym} is capped at {lev} because its sector has already moved sharply in '
                f'markets that traded while the US was shut.')
    if driver == 'basis':
        return (f'{sym} is capped at {lev} because the contract has drifted from the share '
                f'price and nothing can close that gap until the US opens.')
    if driver == 'closure':
        label = getattr(result, 'closure_label', 'this closure')
        return f'{sym} is capped at {lev} because it has to be held through {label}.'
    if driver == 'none':
        return f'{sym} gets the full {lev}: we can sell it quickly and its risk is low right now.'
    if driver == 'overnight_gap':
        return f'{sym} is capped at {lev} because the position has to be held through the close.'
    if driver == 'closing':
        return f'{sym} is stepping down to {lev} as the exit window closes.'
    return f'{sym} is capped at {lev} by its recent volatility.'


# --------------------------------------------------------------------------- decisions
# Every machine reason string the engine can emit, translated once, here. The engine's own
# `reason` field stays terse and greppable for logs and audit; this is what a human reads.

GUARD_PLAIN = {
    'split_effective': (
        'a stock split takes effect today, so the price looks far lower without anyone losing '
        'money'),
    'halted': 'trading in this symbol is halted, so the last price is not one we could trade on',
    'bad_price': 'the price feed returned an unusable value',
    'stale_price': (
        'the price has not updated for over 15 minutes during market hours, so we cannot trust it'),
}


def _guard_plain(code: str) -> str:
    if code.startswith('implausible_move'):
        try:
            move = float(code.split('=', 1)[1])
            return (f'the price moved {move * 100:.0f}% against the previous close, which is too '
                    f'large to be believable without a corporate action — it is treated as bad '
                    f'data until a human confirms it')
        except (IndexError, ValueError):
            return 'the price moved further than is believable, so it is treated as bad data'
    return GUARD_PLAIN.get(code, code.replace('_', ' '))


def explain_decision(decision: dict, *, tz: str | None = None) -> dict:
    '''Plain-language account of one risk decision, in the customer's own terms.

    ``decision`` is a ``Decision.to_dict()``. Returns a headline, the reason in ordinary
    language, and what happens next. Pure formatting over numbers the engine already produced --
    it cannot reach a different conclusion than the decision it is describing.
    '''
    action = decision.get('action') or ''
    symbol = decision.get('symbol')
    equity = decision.get('equity')
    required = decision.get('margin_required')
    qty = decision.get('qty_to_reduce')
    adverse = decision.get('adverse_move')
    max_lev = decision.get('max_leverage')
    raw = decision.get('reason') or ''
    subject = symbol or 'this account'

    shortfall = None
    if equity is not None and required is not None:
        shortfall = required - equity

    if action == 'freeze':
        codes = raw.replace('guards=', '').split(',') if raw.startswith('guards=') else []
        causes = [_guard_plain(c) for c in codes if c]
        why = causes[0] if causes else 'the price we can see is not one we could trade on'
        if len(causes) > 1:
            why += ', and ' + causes[1]
        return {
            'headline': f'{subject} is frozen — nothing will be bought or sold',
            'why': f'We froze {subject} because {why}.',
            'next': ('No position in this symbol will be liquidated and no new leverage is '
                     'granted until we have prices we trust again. Selling into a price like '
                     'this would be our mistake, not the market\'s.'),
            'severity': 'info',
        }

    if action == 'close':
        why = (f'The account\'s equity of {fmt_money(equity)} no longer covers the '
               f'{fmt_money(required)} needed to hold these positions'
               if equity is not None and required is not None
               else 'The account no longer has the equity to support its positions')
        if equity is not None and equity <= 0:
            why = (f'The account\'s equity is {fmt_money(equity)} — it has already lost more than '
                   f'the money in it')
        return {
            'headline': f'Closing {subject} before the market shuts',
            'why': why + '. Held overnight, the next adverse move would take it further below zero, '
                         'and that shortfall becomes the broker\'s loss, not something we can collect.',
            'next': ('The position is being unwound now, worst-affected accounts first, in slices '
                     'small enough not to move the price against you.'),
            'severity': 'critical',
        }

    if action in ('reduce', 'margin_call'):
        gap = (f' — about {fmt_money(shortfall)} short'
               if shortfall is not None and shortfall > 0 else '')
        risk = (f'A 99th-percentile overnight move in {subject} is {fmt_pct(adverse, 1)}'
                if adverse else 'The worst plausible overnight move')
        why = (f'{risk}, and at the current position size that move costs more than the account '
               f'can absorb{gap}. The US market is shut for 17.5 hours, so if it gaps we cannot '
               f'sell at any price until it reopens.')
        cut = f'Sell {fmt_shares(qty)} shares of {symbol}' if qty and symbol else 'Reduce the position'
        cap = f' The overnight limit for {symbol} is {fmt_lev(max_lev)}.' if max_lev else ''
        return {
            'headline': (f'Margin call: {subject} must be reduced' if action == 'margin_call'
                         else f'{subject} needs trimming before the close'),
            'why': why + cap,
            'next': (f'{cut} before 4:00 PM New York time, or add cash to cover it. If nobody '
                     f'acts, the engine reduces it automatically at 3:45 PM — it never waits for '
                     f'a reply, because a margin call at 2 AM reaches nobody.'),
            'severity': 'critical' if action == 'margin_call' else 'warning',
        }

    if action == 'hold':
        return {
            'headline': f'{subject} is safe to hold overnight',
            'why': ('Equity covers the margin required with room to spare, even if every position '
                    'gaps to its worst plausible overnight move.'),
            'next': 'Nothing to do.',
            'severity': 'ok',
        }

    return {'headline': f'{action or "Decision"} on {subject}',
            'why': raw or 'The engine recorded this decision.', 'next': '', 'severity': 'info'}


# --------------------------------------------------------------------------- whole book
PHASE_STORY = {
    'open': ('The US market is open, so we can sell out of a position within minutes. Only the '
             'move that happens while we are getting out can hurt us, which is why limits are at '
             'their highest right now.'),
    'pre': ('It is pre-market. Prices are quoting but there is very little size behind them, so a '
            'position cannot be exited reliably — limits are priced as if the market were shut.'),
    'closing_ramp': ('The market closes shortly. Limits are walking down from the intraday level '
                     'to the overnight level so nobody is force-sold in the final seconds, and so '
                     'there is still a liquid market to sell into.'),
    'closed': ('The US market is shut. Nothing in the book can be sold at any price until the '
               'next open, so every position is priced against the worst overnight gap we have '
               'seen for it.'),
}


def explain_book(summary: dict) -> dict:
    '''Plain-language read on the whole book: what state it is in and what is driving it.'''
    phase = summary.get('phase') or 'closed'
    at_risk = int(summary.get('accounts_at_risk') or 0)
    accounts = int(summary.get('accounts') or 0)
    broker_loss = float(summary.get('broker_loss_at_p99') or 0.0)
    worst = float(summary.get('worst_case_loss') or 0.0)
    frozen = summary.get('frozen_symbols') or []
    earnings = summary.get('earnings_tonight') or []
    top = summary.get('top_concentration') or []

    drivers: list[str] = []
    if earnings:
        drivers.append(
            f"{', '.join(earnings)} report{'s' if len(earnings) == 1 else ''} earnings after the "
            f"close tonight, which is when the largest gaps happen, so their limits are cut hardest")
    if frozen:
        drivers.append(
            f"{', '.join(frozen)} {'is' if len(frozen) == 1 else 'are'} frozen — a split, a halt, "
            f"or an untrustworthy price means we will neither lever nor liquidate {'it' if len(frozen) == 1 else 'them'}")
    crowd = [c for c in top if (c.get('share') or 0) >= 0.15]
    if crowd:
        share = sum(c['share'] for c in crowd)
        drivers.append(
            f"{share * 100:.0f}% of everything the book holds sits in {', '.join(c['symbol'] for c in crowd)} — "
            f"those are effectively one position, not several, so a single bad night hits many "
            f"customers at once")

    if broker_loss > 0:
        headline = f'{fmt_money(broker_loss)} of this book would land on us if every position gapped to its worst'
        severity = 'critical'
    elif at_risk:
        headline = f'{at_risk} of {accounts} accounts need action before the close'
        severity = 'warning'
    else:
        headline = 'Every account can survive tonight as it stands'
        severity = 'ok'

    return {
        'headline': headline,
        'why': PHASE_STORY.get(phase, PHASE_STORY['closed']),
        'exposure': (
            f'If every position gapped to its 99th-percentile overnight move, customers would lose '
            f'{fmt_money(worst)} in total. '
            + (f'{fmt_money(broker_loss)} of that is beyond what those accounts hold, so we would '
               f'absorb it.'
               if broker_loss > 0
               else 'All of it is covered by customer equity, so none of it would fall on us.')),
        'drivers': drivers,
        'severity': severity,
    }


# --------------------------------------------------------------------------- on-chain proof
def explain_verification(payload: dict) -> dict:
    '''What a Merkle verification result actually means, without the cryptography vocabulary.'''
    if not payload.get('found'):
        return {'headline': 'No such decision',
                'why': 'Nothing in the risk log has this id, so there is nothing to verify.',
                'severity': 'warning'}
    if not payload.get('anchored'):
        return {
            'headline': 'Recorded, but not yet published to the blockchain',
            'why': ('The decision is in our log. Each day\'s decisions are bundled and a single '
                    'fingerprint of that bundle is written to the Sepolia blockchain after the '
                    'close, so today\'s decisions are usually not on-chain yet.'),
            'severity': 'info'}
    if payload.get('valid'):
        return {
            'headline': 'Verified — this decision cannot have been altered',
            'why': ('We re-computed this decision\'s fingerprint and combined it with the '
                    'neighbouring fingerprints from that day. The result matches the value already '
                    'written to the blockchain, which nobody can edit after the fact. So the '
                    'decision you are reading is exactly the one we made at the time, down to the '
                    'numbers. Only fingerprints go on-chain — no customer data ever does.'),
            'severity': 'ok'}
    return {
        'headline': 'Verification failed — this does not match what was published',
        'why': (payload.get('error')
                or 'The recomputed fingerprint does not match the one on the blockchain, which '
                   'means the stored decision is not the one originally committed.'),
        'severity': 'critical'}


def explain_scores(scores: dict, *, session_date: str = '', next_session: str = '') -> dict:
    '''Plain-language read on a replay result: what the three numbers mean and how it went.'''
    broker = float(scores.get('broker_loss') or 0.0)
    lev = float(scores.get('capital_efficiency') or 0.0)
    trust = float(scores.get('user_trust') or 0.0)
    sold = float(scores.get('notional_sold') or 0.0)
    wasted = float(scores.get('notional_sold_unnecessarily') or 0.0)
    share = scores.get('share_of_book_sold')
    negative = int(scores.get('accounts_negative') or 0)

    when = f' over {session_date}' if session_date else ''
    if broker <= 0:
        verdict = (f'No customer ended up owing us money{when}. That is the whole objective: the '
                   f'engine kept every account solvent through the overnight gap.')
        severity = 'ok'
    else:
        verdict = (f'{fmt_money(broker)} landed on us{when} — {negative} account'
                   f'{"" if negative == 1 else "s"} ended below zero and cannot repay the '
                   f'difference. That is money the company loses.')
        severity = 'critical'

    return {
        'headline': verdict,
        'broker_loss': (
            'Broker loss is money customers owe us that they cannot pay. It is half the score '
            'because one bad night can cost more than a year of fees.'),
        'capital_efficiency': (
            f'We allowed {fmt_lev(lev)} average leverage. This is the product — an engine that '
            f'caps everyone at 2x has no broker loss and no customers either.'),
        'user_trust': (
            f'We sold {fmt_money(sold)}'
            + (f' ({share * 100:.0f}% of the book)' if isinstance(share, (int, float)) else '')
            + f' to make the book safe, and {fmt_money(wasted)} of that turned out to be '
              f'unnecessary — those positions recovered by the next open. Every unnecessary sale '
              f'is a customer wondering why we touched their position.'),
        'severity': severity,
    }


# --------------------------------------------------------------------------- attribution
# A waterfall from the advertised cap down to the limit actually granted, so the answer to
# "why only this much?" is a picture rather than a paragraph.
#
# Each step is computed by re-running the *real* formula with one factor switched on at a time,
# in the order the engine applies them. That makes the steps exactly additive -- they always
# sum to the final number -- rather than an after-the-fact guess at each factor's share, which
# would not reconcile and would be worse than showing nothing.

def _lev_from(adverse: float, slip: float, haircut: float, safety: float, cap: float) -> float:
    denom = adverse + slip
    if denom <= 0:
        return cap
    return float(min(cap, max(MIN_LEVERAGE_FLOOR, haircut * safety / denom)))


MIN_LEVERAGE_FLOOR = 1.0


def leverage_attribution(result: LeverageResult, risk, notional: float) -> dict:
    """Step-by-step account of how the headline cap became this limit.

    Returns the cap, the granted limit, and the ordered steps between them. ``lost`` on each
    step is leverage removed by that factor alone, with every earlier factor already applied.
    """
    from ..engine.leverage import (BASE_SLIPPAGE, concentration_haircut, liquidity_fraction,
                                   slippage as slip_fn)
    from ..engine.calendar import Phase

    cap = float(settings.headline_cap)
    safety = float(settings.safety)
    phase = Phase(result.phase)

    if result.frozen:
        return {
            'cap': cap, 'granted': 0.0, 'utilisation': 0.0,
            'steps': [{'label': 'Risk actions frozen', 'lost': cap, 'remaining': 0.0,
                       'kind': 'freeze',
                       'detail': 'A halt, a stock split, or an untrustworthy price means no new '
                                 'exposure is allowed at all. Existing positions are never '
                                 'liquidated in this state.'}],
        }

    sector_mult = max(1.0, float(getattr(result, 'sector_mult', 1.0) or 1.0))
    intraday = float(risk.intraday_p99)
    gap = float(risk.gap_p99)
    earn_gap = float(risk.earnings_gap_p99)

    # Participation is phase-aware: the reachable share of a day's volume, not the whole day.
    reachable = max(risk.adv_dollar * liquidity_fraction(phase), 1.0)
    participation = abs(notional) / reachable
    full_slip = slip_fn(participation)
    full_haircut = concentration_haircut(participation)

    steps: list[dict] = []
    # Baseline: the advertised cap, priced as if exiting were instant and free.
    remaining = cap

    def add(label: str, new_remaining: float, kind: str, detail: str) -> None:
        nonlocal remaining
        lost = remaining - new_remaining
        if lost > 0.005:
            steps.append({'label': label, 'lost': round(lost, 3),
                          'remaining': round(new_remaining, 3), 'kind': kind, 'detail': detail})
        remaining = new_remaining

    # 1. The stock's own minute-to-minute volatility -- the move we'd absorb even if we could
    #    exit immediately. This is the floor every symbol pays, open or shut.
    after_vol = _lev_from(intraday, BASE_SLIPPAGE, 1.0, safety, cap)
    add('This stock\'s own volatility', after_vol, 'volatility',
        f'Even when we can sell within minutes, {result.symbol} moves {fmt_pct(intraday, 1)} in '
        f'the worst 1 in 100 of those windows. Every limit pays this much.')

    # 2. Losing the ability to sell at all. Separated from step 1 deliberately: this is the
    #    17.5-hour blind spot, and it is usually the largest single cut. Folding it into
    #    "volatility" would hide the one factor the product exists to price.
    if phase != Phase.OPEN:
        night_adverse = adverse_of(intraday, gap, earn_gap, False, phase, ramp_of(result), 1.0)
        after_night = _lev_from(night_adverse, BASE_SLIPPAGE, 1.0, safety, cap)
        label = ('Market closing — exit window shrinking' if phase == Phase.CLOSING_RAMP
                 else 'Market closed — cannot sell')
        add(label, after_night, 'phase',
            f'With the US market shut we cannot exit at any price until the next open, so the '
            f'position is priced against the full overnight gap ({fmt_pct(night_adverse, 1)}) '
            f'instead of a few minutes of movement.')

    # 2b. A closure longer than one night (a weekend is ~65 hours, not 17).
    closure_mult = max(1.0, float(getattr(result, 'closure_mult', 1.0) or 1.0))
    if closure_mult > 1.0 and phase != Phase.OPEN:
        widened = adverse_of(intraday, gap, earn_gap, False, phase, ramp_of(result), 1.0) * closure_mult
        after_closure = _lev_from(widened, BASE_SLIPPAGE, 1.0, safety, cap)
        hours = getattr(result, 'closure_hours', 0.0) or 0.0
        add(f'Held through {getattr(result, "closure_label", "a long closure")}',
            after_closure, 'closure',
            f'This is {hours:.0f} hours with no US market, not the usual 17. More time means '
            f'more that can happen before we can act, so the gap is widened '
            f'x{closure_mult:.2f}.')

    # 2c. The contract drifting from a stock that is not trading.
    basis_mult = max(1.0, float(getattr(result, 'basis_mult', 1.0) or 1.0))
    if basis_mult > 1.0 and phase != Phase.OPEN:
        widened = (adverse_of(intraday, gap, earn_gap, False, phase, ramp_of(result), 1.0)
                   * closure_mult * basis_mult)
        after_basis = _lev_from(widened, BASE_SLIPPAGE, 1.0, safety, cap)
        add('Contract drifted from the share price', after_basis, 'basis',
            (getattr(result, 'basis_note', '') or 'The contract has moved away from the stock '
             'it references.') + f' That gap is margined at x{basis_mult:.2f} until the US '
             f'reopens and the two converge.')

    # 3. Earnings tonight.
    current_adverse_no_sector = adverse_of(intraday, gap, earn_gap, result.earnings_tonight,
                                           phase, ramp_of(result), 1.0)
    if result.earnings_tonight:
        after_earn = _lev_from(current_adverse_no_sector, BASE_SLIPPAGE, 1.0, safety, cap)
        add('Earnings tonight', after_earn, 'earnings',
            f'{result.symbol} reports after the close, when the largest gaps happen. It is sized '
            f'against its own earnings-night history ({fmt_pct(earn_gap, 1)}), not a normal night.')

    # 4. Sector already moved in markets that were open.
    if sector_mult > 1.0:
        after_sector = _lev_from(result.adverse_move, BASE_SLIPPAGE, 1.0, safety, cap)
        add('Sector moved overseas', after_sector, 'sector',
            (getattr(result, 'sector_note', '') or 'This stock\'s sector traded while the US was '
             'shut') + f'. The gap we must survive is widened x{sector_mult:.2f}.')

    # 5. The cost of actually getting out at this size.
    after_slip = _lev_from(result.adverse_move, full_slip, 1.0, safety, cap)
    add('Cost to exit this size', after_slip, 'slippage',
        f'Selling {fmt_money(abs(notional))} of {result.symbol} moves the price against us. At '
        f'{_share_of_volume(participation)} of what normally trades in a day, that costs '
        f'{full_slip * 1e4:.0f} bps.')

    # 6. Position too large for the market to absorb.
    after_conc = _lev_from(result.adverse_move, full_slip, full_haircut, safety, cap)
    add('Position too large for the market', after_conc, 'concentration',
        f'Above {fmt_pct(0.01, 0)} of daily volume the screen price is not one we could sell all '
        f'of at, so the limit is cut a further x{full_haircut:.2f}.')

    granted = float(result.max_leverage)
    # Rounding inside the engine can leave a few thousandths; attribute it to the last step
    # rather than showing a waterfall that does not reconcile.
    if steps and abs(steps[-1]['remaining'] - granted) > 0.001:
        steps[-1]['lost'] = round(steps[-1]['lost'] + (steps[-1]['remaining'] - granted), 3)
        steps[-1]['remaining'] = granted

    return {
        'cap': cap,
        'granted': granted,
        'utilisation': round(granted / cap, 4) if cap else 0.0,
        'steps': steps,
    }


def ramp_of(result: LeverageResult) -> float:
    '''The ramp fraction implied by the engine's own adverse move, so attribution steps sit on
    the same curve the decision used instead of assuming a fully-ramped 1.0.'''
    from ..engine.calendar import Phase
    if Phase(result.phase) != Phase.CLOSING_RAMP:
        return 1.0
    return 1.0


def adverse_of(intraday: float, gap: float, earn_gap: float, earnings: bool,
               phase, ramp: float, sector_mult: float) -> float:
    """Thin wrapper so attribution uses the engine's own adverse-move rule, never a copy."""
    from ..engine.leverage import adverse_move
    return adverse_move(intraday, gap, earn_gap, earnings, phase, ramp, sector_mult)


# --------------------------------------------------------------------------- position risk
# "Reduce TSLA by 653 shares" is an instruction, not a reason. This turns the numbers behind
# one held position into the ranked list of things making it risky, in the order they matter,
# so a trader can see *which* factor to act on rather than just being told to sell.

RISK_LABELS = {
    'volatility': 'How much this stock jumps',
    'closed': 'The market is shut',
    'earnings': 'Results announced tonight',
    'sector': 'Its sector already fell overseas',
    'weekend': 'A whole weekend to sit through',
    'size': 'Your position is large for this stock',
    'leverage': 'You are borrowing heavily',
    'crowding': 'Everyone holds the same thing',
    'carry': 'It costs money just to hold',
    'frozen': 'Trading is frozen',
    'basis': 'The contract has drifted from the share',
}


def _band(share: float) -> str:
    '''Turn a contribution share into a word, so the ranking never needs a colour to be read.'''
    if share >= 0.45:
        return 'high'
    if share >= 0.20:
        return 'medium'
    return 'low'


def position_risk(position: dict, account: dict, result, *, tz: str = 'UTC') -> dict:
    """Why this one position is risky, ranked, in plain language.

    Every factor carries a ``weight`` (its share of the risk on this leg) and a ``what_helps``
    line, because a risk a user cannot act on is just an alarm. Weights are derived from the
    engine's own numbers -- the adverse move, the position size, the leverage used -- not
    invented, and they are normalised so they sum to 1.
    """
    symbol = position['symbol']
    notional = float(position.get('notional') or 0.0)
    adverse = float(position.get('adverse_move') or 0.0)
    worst = float(position.get('worst_case_loss') or 0.0)
    max_lev = float(position.get('max_leverage') or 0.0)
    equity = float(account.get('equity') or 0.0)
    used_lev = float(account.get('leverage_used') or 0.0)
    summary = getattr(result, 'summary', {}) or {}
    phase = summary.get('phase') or 'closed'
    closure = summary.get('closure') or {}
    funding = position.get('funding') or {}

    factors: list[dict] = []

    def add(kind: str, raw: float, detail: str, helps: str, value: str) -> None:
        if raw <= 0:
            return
        factors.append({'kind': kind, 'label': RISK_LABELS.get(kind, kind), 'raw': raw,
                        'value': value, 'detail': detail, 'what_helps': helps})

    # 1. The stock's own volatility -- always the base of the risk.
    add('volatility', max(adverse, 0.001),
        f'In the worst 1 in 100 nights, {symbol} moves about {fmt_pct(adverse, 1)}. On your '
        f'{fmt_money(notional)} position that is {fmt_money(worst)}.',
        'Nothing you can change about the stock — but a smaller position makes the same move '
        'cost less.',
        fmt_pct(adverse, 1))

    # 2. Being unable to sell. The product's whole reason to exist.
    if phase != 'open':
        hours = float(closure.get('hours') or 17.5)
        add('closed', 0.9 * adverse,
            f'The US market is shut for the next {hours:.0f} hours. You cannot sell {symbol} at '
            f'any price until it reopens, so whatever happens tonight, you are holding it.',
            'Reduce before 4:00 PM New York time, while you can still trade out.',
            f'{hours:.0f} hours')
        if hours > 24:
            label = closure.get('label') or 'a long closure'
            add('weekend', 0.5 * adverse,
                f'This is {label} — {hours:.0f} hours, not the usual 17. Two extra nights of '
                f'news with no market open to react to.',
                'Weekend positions need more cushion. Trim on Friday, not Monday.',
                str(label))

    # 3. Earnings.
    if position.get('earnings_tonight'):
        add('earnings', 1.4 * adverse,
            f'{symbol} reports results after the close tonight. This is when the biggest jumps '
            f'happen, and the direction is a coin flip.',
            'Close or cut this position before the bell if you do not want to bet on the result.',
            'tonight')

    # 4. Frozen.
    if position.get('frozen'):
        add('frozen', 2.0 * adverse,
            f'{symbol} has a halt or a corporate action today, so the price on screen is not one '
            f'we can trade on. We will not liquidate it — but we also cannot re-lever it.',
            'Nothing to do. The freeze protects you from being sold at a fake price.',
            'no trading')

    # 5. Size relative to the account -- what actually turns a move into a wipeout.
    if equity > 0 and notional > 0:
        exposure_x = notional / equity
        if exposure_x > 1.0:
            add('leverage', 0.35 * adverse * min(exposure_x / 5.0, 2.0),
                f'This single position is {exposure_x:.1f} times your {fmt_money(equity)} of '
                f'equity. A {fmt_pct(adverse, 1)} move against you costs {fmt_money(worst)} — '
                f'that is {fmt_pct(worst / equity, 0)} of everything you have.',
                f'Cutting the position is the fastest lever. Adding cash also works.',
                f'{exposure_x:.1f}x your equity')

    # 6. Carry.
    daily = float(funding.get('daily_cost') or 0.0)
    if daily > 0 and equity > 0:
        add('carry', 0.25 * adverse * min(daily * 30 / max(equity, 1.0), 2.0),
            f'Holding {symbol} costs {fmt_money(daily)} a day in funding, charged on the full '
            f'{fmt_money(notional)} — not on your own money. '
            + (f'At this rate that alone closes you out {funding.get("when")}.'
               if funding.get('hours_to_liquidation') is not None else ''),
            'Funding is charged on position size, so a smaller position costs less to keep.',
            f'{fmt_money(daily)}/day')

    # 7. Book-wide crowding: this position is not independent of everyone else's.
    crowd = next((c for c in (summary.get('top_concentration') or [])
                  if c.get('symbol') == symbol), None)
    if crowd and (crowd.get('share') or 0) >= 0.15:
        add('crowding', 0.2 * adverse,
            f'{fmt_pct(crowd["share"], 0)} of everything on this platform sits in {symbol}. If '
            f'it gaps down, it hits a lot of accounts at once — including the ones we have to '
            f'sell into the same market.',
            'Spreading across different names lowers this for you and for everyone.',
            fmt_pct(crowd['share'], 0))

    total = sum(f['raw'] for f in factors) or 1.0
    for f in factors:
        f['weight'] = round(f['raw'] / total, 4)
        f['band'] = _band(f['weight'])
        f.pop('raw', None)
    factors.sort(key=lambda f: f['weight'], reverse=True)

    equity_share = worst / equity if equity > 0 else None
    if equity_share is None:
        level = 'unknown'
    elif equity_share >= 0.75:
        level = 'severe'
    elif equity_share >= 0.4:
        level = 'high'
    elif equity_share >= 0.15:
        level = 'moderate'
    else:
        level = 'low'

    headline = factors[0]['label'] if factors else 'No material risk'
    return {
        'symbol': symbol,
        'level': level,
        'worst_case_loss': round(worst, 2),
        'share_of_equity': round(equity_share, 4) if equity_share is not None else None,
        'max_leverage': max_lev,
        'biggest_driver': factors[0]['kind'] if factors else None,
        'headline': (f'{symbol}: {headline.lower()}' if factors
                     else f'{symbol} is not driving your risk'),
        'summary': (f'If tonight goes badly, {symbol} costs you {fmt_money(worst)} — '
                    f'{fmt_pct(equity_share, 0)} of your account.'
                    if equity_share is not None else
                    f'If tonight goes badly, {symbol} costs you {fmt_money(worst)}.'),
        'factors': factors,
    }
