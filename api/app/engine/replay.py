'''Book-level replay: step a simulated clock through a real session and score the outcome.

This is the piece that closes the loop. Every other module answers "what should we do now";
this one runs those answers forward over recorded prices and reports what they actually cost.

Three properties it must have:

1. **No look-ahead.** The clock only ever moves forward and the book is only ever shown prices
   at or before the current step (``BookState.prices_at`` enforces the cutoff). The next
   session's open is used *only* to score decisions already made, never to make them.
2. **No free liquidations.** Reductions before the close and the unwind at the open both pay
   slippage sized to our own participation, via ``engine.liquidate``. An engine that can exit
   at the printed price would report zero broker loss and be worthless.
3. **A real number at the end.** Broker loss is realised equity below zero after the gap and
   the unwind -- not a p99 estimate.

The three scores mirror the problem statement's rubric: broker loss (50%), capital efficiency
(30%), user trust (20%). User trust is only measurable here, because it needs the next open:
it counts positions we closed that would have recovered had we left them alone.
'''
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import numpy as np

from . import calendar as cal
from . import liquidate
from .liquidate import Order


# A position we closed only counts against user trust if simply holding it would have beaten
# our exit by more than round-trip trading costs.
RECOVERY_TOLERANCE = 0.01   # 1%


@dataclass
class ReplayStep:
    ts: datetime
    phase: str
    ramp: float
    summary: dict


@dataclass
class ReplayResult:
    run_id: str
    session_date: date
    steps: list[ReplayStep] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    fills: list[dict] = field(default_factory=list)
    decisions: list[dict] = field(default_factory=list)
    series: dict = field(default_factory=dict)
    scores: dict = field(default_factory=dict)


def _minute_volume(book, sym_i: int, ts: datetime) -> float:
    '''Expected shares per minute for the symbol, from its own recent volume profile.

    Falls back to ADV/390 when no intraday volume is recorded. The open is far busier than the
    average minute, so the first minutes get a multiplier -- without it the unwind would look
    artificially slow and expensive at exactly the moment it matters.
    '''
    base = float(book.adv_shares[sym_i]) / 390.0
    et = cal.to_et(ts)
    minutes_from_open = (et.hour - 9) * 60 + (et.minute - 30)
    if 0 <= minutes_from_open <= 30:
        base *= 4.0          # opening auction and the first half hour carry outsized volume
    return max(base, 1.0)


def unwind_at_open(book, result, ts: datetime, *, run_id: str = '') -> list[dict]:
    '''Job 3: sequence the morning-after unwind for accounts the gap left underwater.

    Worst margin ratio first, participation-capped per symbol per minute, and healthy accounts
    are never touched. Sizing the queue by our own share of real volume is what stops the doom
    loop: dumping the whole book into the first minute is what turns a bad gap into a worse one.
    '''
    orders: list[Order] = []
    for a in range(len(book.accounts)):
        eq = float(result.equity[a])
        req = float(result.margin_required[a])
        gross = float(result.gross[a])
        if gross <= 0:
            continue
        ratio = eq / req if req > 0 else float('inf')
        # Only accounts that breach maintenance are in the queue. A healthy, well-collateralised
        # account is left alone even on a violent morning -- closing it is a customer lost for
        # nothing, which is exactly what the user-trust score punishes.
        if ratio >= 1.0 and eq > 0:
            continue
        for j in book.positions_of(a):
            s = int(book.pos_sym[j])
            if bool(result.frozen_sym[s]):
                continue            # split/halt guard: never unwind into an untradeable print
            qty = float(book.pos_qty[j])
            if qty == 0:
                continue
            orders.append(Order(account_id=book.accounts[a].id, symbol=book.symbols[s], qty=qty,
                                ref_price=float(result.prices[s]),
                                minute_volume=_minute_volume(book, s, ts),
                                margin_ratio=ratio))
    if not orders:
        return []

    fills = liquidate.unwind(orders)
    out: list[dict] = []
    for f in fills:
        a = book.acct_idx[f.account_id]
        s = book.sym_idx[f.symbol]
        j = book._pos_lookup.get((a, s))
        if j is None:
            continue
        book.pos_qty[j] -= f.qty
        book.cash[a] += f.proceeds
        out.append({'ts': ts.isoformat(), 'account_id': f.account_id, 'symbol': f.symbol,
                    'action': 'close', 'qty': round(f.qty, 4), 'ref_price': round(f.ref_price, 4),
                    'fill_price': round(f.fill_price, 4), 'slippage_bps': round(f.slippage_bps, 2),
                    'minutes': f.minutes, 'proceeds': round(f.proceeds, 2), 'kind': 'open_unwind'})
    return out


def _equity_now(book, price: np.ndarray) -> np.ndarray:
    mv = book.pos_qty * price[book.pos_sym]
    return book.cash + np.bincount(book.pos_acct, weights=mv, minlength=len(book.accounts))


def score(book, *, equity_open: np.ndarray, equity_final: np.ndarray, exit_price: dict,
          next_open_price: np.ndarray, closed_qty: dict, leverage_samples: list[float],
          exit_notional: dict | None = None, held_notional: dict | None = None) -> dict:
    '''The three rubric numbers, computed from what actually happened.

    - broker_loss: equity still below zero once positions are gone. The customer cannot pay it,
      so it is the broker's loss.
    - capital_efficiency: mean allowed leverage across the session. Higher is the product.
    - user_trust: positions we force-closed that would have recovered on their own by the next
      open. Each one is a customer with no reason to stay.
    '''
    broker_loss = float(np.maximum(-equity_final, 0.0).sum())
    accounts_negative = int((equity_final < 0).sum())

    # User trust is about *unnecessary* selling, weighted by how much we actually sold. A 5%
    # trim that recovers is a rounding error to the customer; a full liquidation that recovers
    # is the customer gone. Counting both as one "position closed" would score a cautious trim
    # the same as a wipeout, so the penalty is scaled by the fraction of the position we took.
    exit_notional = exit_notional or {}
    held_notional = held_notional or {}
    recovered = 0
    closed_total = 0
    regret_notional = 0.0
    sold_notional = 0.0
    for (acct_id, sym), qty in closed_qty.items():
        if qty == 0:
            continue
        closed_total += 1
        s = book.sym_idx.get(sym)
        if s is None:
            continue
        # The only fair baseline is the price we actually got out at. Comparing against the
        # morning's price would charge the engine for a whole session of ordinary drift it had
        # nothing to do with.
        entry = exit_price.get((acct_id, sym))
        if entry is None:
            continue
        # "Would have recovered" has to mean the customer was *materially* worse off for our
        # having acted -- not that the price ticked up a basis point. A forced exit is only a
        # broken promise if holding would have beaten it by more than the cost of trading;
        # inside that band the close was free, and counting it would make the trust score
        # hypersensitive to quiet nights where nothing actually went wrong.
        if entry <= 0:
            continue
        move = float(next_open_price[s]) / entry - 1.0
        sold = abs(exit_notional.get((acct_id, sym), qty * entry))
        sold_notional += sold
        if (qty > 0 and move > RECOVERY_TOLERANCE) or (qty < 0 and -move > RECOVERY_TOLERANCE):
            recovered += 1
            regret_notional += sold

    avg_leverage = float(np.mean(leverage_samples)) if leverage_samples else 0.0
    # Trust = the share of what we sold that we did not need to sell, inverted.
    trust = 1.0 - (regret_notional / sold_notional) if sold_notional > 0 else 1.0
    total_held = sum(held_notional.values()) if held_notional else 0.0
    return {
        'broker_loss': round(broker_loss, 2),
        'accounts_negative': accounts_negative,
        'capital_efficiency': round(avg_leverage, 3),
        'positions_reduced': closed_total,
        'reduced_that_would_have_recovered': recovered,
        'notional_sold': round(sold_notional, 2),
        'notional_sold_unnecessarily': round(regret_notional, 2),
        'share_of_book_sold': round(sold_notional / total_held, 4) if total_held else None,
        'user_trust': round(trust, 4),
        'equity_start': round(float(equity_open.sum()), 2),
        'equity_end': round(float(equity_final.sum()), 2),
    }


def run_session(book, session_date: date, next_open_price: np.ndarray, *, run_id: str,
                step_minutes: int = 15, safety: float | None = None) -> ReplayResult:
    """Step one session, hold through the gap, then unwind at the next open.

    ``book`` is mutated, so callers pass a clone. ``next_open_price`` is the *scoring* input:
    it is applied only after the close, once every decision for the session has been made, so
    the engine can never see it while deciding.
    """
    res = ReplayResult(run_id=run_id, session_date=session_date)
    # (account, symbol) -> quantity-weighted average price we exited at, the baseline for the
    # user-trust question "would this position have recovered if we had left it alone?"
    exit_notional: dict[tuple[str, str], float] = {}
    closed_qty: dict[tuple[str, str], float] = {}
    # Gross notional held at the open, the denominator for "how much of the book did we sell".
    held_notional: dict[tuple[str, str], float] = {}
    leverage_samples: list[float] = []
    series: dict[str, dict] = {s: {'ts': [], 'price': [], 'max_leverage': [], 'phase': [],
                                   'ramp': [], 'frozen': []} for s in book.symbols}

    open_ts = cal.session_open(session_date)
    close_ts = cal.session_close(session_date)
    equity_open: np.ndarray | None = None

    # The ramp is where the interesting behaviour lives, and it is only 30 minutes long. Step
    # coarsely through the quiet middle of the session and finely from 15:30, so the gradual
    # walk-down is actually sampled instead of being jumped over in one stride.
    ramp_step = min(step_minutes, 5)
    ts = open_ts
    while ts <= close_ts:
        result = book.evaluate(ts)
        res.steps.append(ReplayStep(ts, result.phase, result.summary['ramp'], result.summary))
        res.decisions.extend(d.to_dict() for d in result.decisions)
        leverage_samples.extend(float(x) for x in result.pos_max_leverage) if len(result.pos_max_leverage) else None

        if equity_open is None:
            equity_open = result.equity.copy()
            for j in range(len(book.pos_qty)):
                if book.pos_qty[j] == 0:
                    continue
                a = int(book.pos_acct[j])
                sm = int(book.pos_sym[j])
                key = (book.accounts[a].id, book.symbols[sm])
                held_notional[key] = abs(float(book.pos_qty[j]) * float(result.prices[sm]))

        for i, sym in enumerate(book.symbols):
            d = series[sym]
            d['ts'].append(ts.isoformat())
            d['price'].append(round(float(result.prices[i]), 4))
            d['phase'].append(result.phase)
            d['ramp'].append(round(result.summary['ramp'], 3))
            d['frozen'].append(bool(result.frozen_sym[i]))
            lev = book.symbol_leverage(sym, ts, 10_000.0)
            d['max_leverage'].append(lev.max_leverage)

        # Auto de-risk: the engine acts on its own reductions. Nobody is awake to answer.
        fills = book.apply_reductions(result, ts)
        if fills:
            res.fills.extend(fills)
            for f in fills:
                key = (f['account_id'], f['symbol'])
                closed_qty[key] = closed_qty.get(key, 0.0) + f['qty']
                exit_notional[key] = exit_notional.get(key, 0.0) + f['qty'] * f['fill_price']
            res.events.append({'ts': ts.isoformat(), 'kind': 'auto_derisk', 'symbol': None,
                               'account_id': None, 'decision_id': None, 'qty': None,
                               'fill_price': None, 'slippage_bps': None,
                               'note': f'{len(fills)} positions reduced before the close.'})
        if result.phase == 'closing_ramp' and not any(e['kind'] == 'ramp_start' for e in res.events):
            res.events.append({'ts': ts.isoformat(), 'kind': 'ramp_start', 'symbol': None,
                               'account_id': None, 'decision_id': None, 'qty': None,
                               'fill_price': None, 'slippage_bps': None,
                               'note': 'Overnight-risk ramp began; limits walk down to the overnight level.'})
        ts += timedelta(minutes=ramp_step if cal.phase_at(ts) == cal.Phase.CLOSING_RAMP else step_minutes)

    # ---- the gap. Positions are held through it; there is nothing to decide until the bell.
    equity_pre_gap = _equity_now(book, book.last_close.copy())
    nxt = cal.next_trading_day(session_date)
    open_next = cal.session_open(nxt)
    gap_pct = {}
    for i, sym in enumerate(book.symbols):
        prev = float(book.last_close[i])
        if prev > 0:
            gap_pct[sym] = round(float(next_open_price[i]) / prev - 1.0, 6)
    res.events.append({'ts': open_next.isoformat(), 'kind': 'gap', 'symbol': None, 'account_id': None,
                       'decision_id': None, 'qty': None, 'fill_price': None, 'slippage_bps': None,
                       'note': 'Overnight gap applied: ' + ', '.join(
                           f'{s} {v * 100:+.1f}%' for s, v in sorted(gap_pct.items(), key=lambda kv: kv[1])[:6])})

    # Re-price the book at the gapped open and evaluate once with the new prices in place.
    book.last_close = next_open_price.copy()
    book.intraday = {}          # the recorded session is over; the open print is the truth now
    result_open = book.evaluate(open_next)
    res.steps.append(ReplayStep(open_next, result_open.phase, result_open.summary['ramp'], result_open.summary))
    res.decisions.extend(d.to_dict() for d in result_open.decisions)

    # ---- Job 3: sequence the unwind.
    unwind_fills = unwind_at_open(book, result_open, open_next, run_id=run_id)
    if unwind_fills:
        res.fills.extend(unwind_fills)
        for f in unwind_fills:
            key = (f['account_id'], f['symbol'])
            closed_qty[key] = closed_qty.get(key, 0.0) + f['qty']
            exit_notional[key] = exit_notional.get(key, 0.0) + f['qty'] * f['fill_price']
        worst = min(f['slippage_bps'] for f in unwind_fills), max(f['slippage_bps'] for f in unwind_fills)
        res.events.append({'ts': open_next.isoformat(), 'kind': 'unwind', 'symbol': None,
                           'account_id': None, 'decision_id': None, 'qty': None, 'fill_price': None,
                           'slippage_bps': round(worst[1], 2),
                           'note': (f'{len(unwind_fills)} positions unwound worst-first, '
                                    f'slippage {worst[0]:.0f}-{worst[1]:.0f} bps, participation-capped.')})

    equity_final = _equity_now(book, next_open_price)
    exit_price = {k: (exit_notional[k] / q) for k, q in closed_qty.items() if q}
    res.scores = score(book, equity_open=equity_open if equity_open is not None else equity_pre_gap,
                       equity_final=equity_final, exit_price=exit_price,
                       next_open_price=next_open_price, closed_qty=closed_qty,
                       leverage_samples=leverage_samples,
                       exit_notional={k: abs(v) for k, v in exit_notional.items()},
                       held_notional=held_notional)
    res.scores['gaps'] = gap_pct
    res.series = series
    return res
