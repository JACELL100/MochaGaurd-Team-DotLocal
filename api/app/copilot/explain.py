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
    if getattr(result, 'sector_mult', 1.0) > 1.05:
        return 'sector'
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
