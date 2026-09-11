'''In-memory book + symbol risk as numpy arrays. /evaluate is whole-book vectorized math.

Zero DB calls in here. Wall-clock access is banned: every entry point takes an explicit ``ts``.
'''
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from time import perf_counter  # monotonic timer only, not wall-clock

import numpy as np

from .config import settings
from .engine import calendar as cal
from .data import sectors
from .engine import basis, guards, leverage, margin


@dataclass
class Account:
    id: str
    tz: str = 'UTC'
    cash: float = 0.0
    email: str | None = None
    display_name: str | None = None


@dataclass
class DailySeries:
    dates: np.ndarray    # ordinal ints, sorted
    open: np.ndarray     # split-adjusted
    close: np.ndarray    # split-adjusted
    volume: np.ndarray

    def at(self, d: date) -> int:
        k = int(np.searchsorted(self.dates, d.toordinal(), side='right')) - 1
        return k


@dataclass
class IntradaySeries:
    ts_ns: np.ndarray    # int64 epoch ns, sorted
    price: np.ndarray
    volume: np.ndarray


@dataclass
class Decision:
    ts: datetime
    account_id: str | None
    symbol: str | None
    action: str
    max_leverage: float | None
    adverse_move: float | None
    equity: float | None
    margin_required: float | None
    qty_to_reduce: float | None
    reason: str
    id: int | None = None

    def to_dict(self) -> dict:
        return {
            'id': self.id, 'ts': self.ts.isoformat(), 'account_id': self.account_id,
            'symbol': self.symbol, 'action': self.action, 'max_leverage': self.max_leverage,
            'adverse_move': self.adverse_move, 'equity': self.equity,
            'margin_required': self.margin_required, 'qty_to_reduce': self.qty_to_reduce,
            'reason': self.reason,
        }


@dataclass
class EvaluateResult:
    ts: datetime
    phase: str
    decisions: list[Decision]
    summary: dict
    elapsed_ms: float
    equity: np.ndarray = field(repr=False, default=None)
    margin_required: np.ndarray = field(repr=False, default=None)
    worst_case_loss: np.ndarray = field(repr=False, default=None)
    gross: np.ndarray = field(repr=False, default=None)
    prices: np.ndarray = field(repr=False, default=None)
    pos_max_leverage: np.ndarray = field(repr=False, default=None)
    adverse_sym: np.ndarray = field(repr=False, default=None)
    frozen_sym: np.ndarray = field(repr=False, default=None)
    earnings_sym: np.ndarray = field(repr=False, default=None)


ACTIONABLE = ('reduce', 'margin_call', 'close')


class BookState:
    def __init__(self, *, symbols, risk: dict[str, dict], accounts: list[Account],
                 positions: list[tuple[str, str, float]], earnings=None, splits=None,
                 halts=None, daily=None, intraday=None, sector_moves=None,
                 perp_marks=None):
        self.symbols = list(symbols)
        self.sym_idx = {s: i for i, s in enumerate(self.symbols)}

        def col(key: str, default: float) -> np.ndarray:
            return np.array([float((risk.get(s) or {}).get(key) or default) for s in self.symbols], dtype=float)

        self.gap_p50 = col('gap_p50', 0.01)
        self.gap_p99 = col('gap_p99', 0.05)
        self.intraday_p99 = col('intraday_p99', 0.03)
        self.earnings_gap_p99 = np.maximum(col('earnings_gap_p99', 0.0), self.gap_p99)
        self.adv_dollar = np.maximum(col('adv_dollar', 1e8), 1.0)
        self.adv_shares = np.maximum(col('adv_shares', 1e6), 1.0)
        self.last_close = col('last_close', 100.0)

        self.earnings: dict[str, list[tuple[date, str | None]]] = earnings or {}
        self.splits: dict[str, set[date]] = splits or {}
        self.halts: dict[str, list[tuple[datetime, datetime | None]]] = halts or {}
        # ticker -> {'move': float, 'session_d': date}. Loaded from the DB at startup; the
        # engine never queries for it while deciding.
        self.sector_moves: dict[str, dict] = sector_moves or {}
        # symbol -> {'price': float, 'ts': datetime}. Populated from a perp venue feed when one
        # is connected; empty means basis risk is reported as unmeasured, never as zero.
        self.perp_marks: dict[str, dict] = perp_marks or {}
        self.daily: dict[str, DailySeries] = daily or {}
        self.intraday: dict[str, IntradaySeries] = intraday or {}

        self.accounts = list(accounts)
        self.acct_idx = {a.id: i for i, a in enumerate(self.accounts)}
        self.cash = np.array([a.cash for a in self.accounts], dtype=float)

        pos = list(positions)
        self.pos_acct = np.array([self.acct_idx[p[0]] for p in pos], dtype=np.int64)
        self.pos_sym = np.array([self.sym_idx[p[1]] for p in pos], dtype=np.int64)
        self.pos_qty = np.array([float(p[2]) for p in pos], dtype=float)
        # Entry price, for unrealised P&L on the trading view. NaN where unknown, so P&L is
        # reported as unavailable rather than silently computed against a wrong basis.
        self.pos_avg = np.array(
            [float(p[3]) if len(p) > 3 and p[3] else np.nan for p in pos], dtype=float)
        self._index_positions()

    # ------------------------------------------------------------------ indexing
    def _index_positions(self) -> None:
        na = len(self.accounts)
        order = np.argsort(self.pos_acct, kind='stable')
        sorted_acct = self.pos_acct[order]
        self._order = order
        self._starts = np.searchsorted(sorted_acct, np.arange(na), side='left')
        self._ends = np.searchsorted(sorted_acct, np.arange(na), side='right')
        self._pos_lookup = {(int(a), int(s)): i for i, (a, s) in enumerate(zip(self.pos_acct, self.pos_sym))}

    def positions_of(self, acct_i: int) -> np.ndarray:
        return self._order[self._starts[acct_i]:self._ends[acct_i]]

    def clone(self) -> 'BookState':
        c = copy.copy(self)
        c.cash = self.cash.copy()
        c.pos_qty = self.pos_qty.copy()
        c.pos_avg = self.pos_avg.copy()
        return c

    def account(self, account_id: str) -> Account | None:
        i = self.acct_idx.get(account_id)
        return self.accounts[i] if i is not None else None

    # ------------------------------------------------------------------ prices (no look-ahead)
    def prev_close_at(self, ts: datetime) -> np.ndarray:
        ref_ord = cal.reference_close_date(ts).toordinal()
        out = self.last_close.copy()
        for i, s in enumerate(self.symbols):
            d = self.daily.get(s)
            if d is not None and len(d.dates):
                k = int(np.searchsorted(d.dates, ref_ord, side='right')) - 1
                if k >= 0:
                    out[i] = d.close[k]
        return out

    def prices_at(self, ts: datetime) -> tuple[np.ndarray, np.ndarray]:
        '''Last known price per symbol at ``ts`` and the timestamp (epoch ns) of that print.'''
        ts_ns = int(ts.timestamp() * 1e9)
        ref_date = cal.reference_close_date(ts)
        ref_ord = ref_date.toordinal()
        price = self.last_close.copy()
        price_ts = np.full(len(self.symbols), ts_ns, dtype=np.int64)
        for i, s in enumerate(self.symbols):
            series = self.intraday.get(s)
            if series is not None and len(series.ts_ns):
                k = int(np.searchsorted(series.ts_ns, ts_ns, side='right')) - 1
                if k >= 0:
                    bar_date = datetime.fromtimestamp(int(series.ts_ns[k]) / 1e9, tz=timezone.utc).astimezone(cal.ET).date()
                    if bar_date >= ref_date:
                        price[i] = series.price[k]
                        price_ts[i] = series.ts_ns[k]
                        continue
            d = self.daily.get(s)
            if d is not None and len(d.dates):
                k = int(np.searchsorted(d.dates, ref_ord, side='right')) - 1
                if k >= 0:
                    price[i] = d.close[k]
        return price, price_ts

    def apply_quote(self, symbol: str, price: float, ts: datetime, volume: float = 0.0) -> bool:
        '''Append a live print to the intraday series (called by the quote poller, never by the engine).'''
        if symbol not in self.sym_idx or price <= 0:
            return False
        ts_ns = int(ts.timestamp() * 1e9)
        s = self.intraday.get(symbol)
        if s is None or len(s.ts_ns) == 0:
            self.intraday[symbol] = IntradaySeries(np.array([ts_ns], dtype=np.int64), np.array([price], dtype=float),
                                                   np.array([volume], dtype=float))
            return True
        if ts_ns <= int(s.ts_ns[-1]):
            return False
        self.intraday[symbol] = IntradaySeries(np.append(s.ts_ns, ts_ns), np.append(s.price, price),
                                               np.append(s.volume, volume))
        return True

    def held_symbols(self) -> list[str]:
        '''Symbols with at least one open position, largest gross notional first.'''
        if len(self.pos_sym) == 0:
            return []
        notional = np.bincount(self.pos_sym, weights=np.abs(self.pos_qty) * self.last_close[self.pos_sym],
                               minlength=len(self.symbols))
        return [self.symbols[i] for i in np.argsort(notional)[::-1] if notional[i] > 0]

    # ------------------------------------------------------------------ sector signal
    def sector_signal(self, symbol: str, ts: datetime) -> tuple[float, str, list[dict]]:
        """How the symbol's sector has traded in markets that already closed, as of ``ts``.

        Only peers whose own session finished *before* ``ts`` are used, which is what keeps this
        free of look-ahead: at 15:45 ET no Asian session for tonight has happened yet, so the
        signal is correctly neutral and only becomes informative overnight.
        """
        peers = sectors.peers_for(symbol)
        if not peers:
            return 1.0, '', []

        # The signal is only meaningful once tonight's US session has actually closed. Before
        # 16:00 the overseas sessions that would inform tonight's gap have not happened yet, and
        # reference_close_date() points at *yesterday's* close -- which would make every peer
        # look finished and quietly reintroduce look-ahead. So: no signal until the bell.
        et = cal.to_et(ts)
        phase_now = cal.phase_at(ts)
        if phase_now in (cal.Phase.OPEN, cal.Phase.CLOSING_RAMP):
            return 1.0, '', []
        ref_close = cal.session_close(cal.reference_close_date(ts))
        hours_since_close = (ts - ref_close).total_seconds() / 3600.0
        if hours_since_close < 0:
            return 1.0, '', []

        used: list[tuple[float, float]] = []
        detail: list[dict] = []
        for peer in peers:
            row = self.sector_moves.get(peer.ticker)
            if row is None or row.get('move') is None:
                continue
            # close_et is expressed as an hour on the US-close day, so 25.5 == 01:30 ET next day.
            peer_hours_after_close = peer.close_et - 16.0
            closed_already = hours_since_close >= peer_hours_after_close
            entry = {'ticker': peer.ticker, 'label': peer.label, 'region': peer.region,
                     'move': round(float(row['move']), 5), 'weight': peer.weight,
                     'session': str(row.get('session_d') or ''), 'counted': bool(closed_already)}
            detail.append(entry)
            if closed_already:
                used.append((float(row['move']), peer.weight))

        mult = leverage.sector_widen(used)
        if not used:
            note = 'No sector market has finished trading since the US close.'
        else:
            avg = sum(abs(m) for m, _ in used) / len(used)
            note = (f"{len(used)} {sectors.sector_of(symbol).replace('_', ' ')} market"
                    f"{'' if len(used) == 1 else 's'} moved {avg * 100:.1f}% on average "
                    f"since the US close")
        return mult, note, detail

    # ------------------------------------------------------------------ oracle / basis
    def basis_signal(self, symbol: str, ts: datetime) -> tuple[float, str]:
        """Margin multiplier from perp-vs-underlying drift, if a perp mark is known.

        The book only carries underlying prices today, so with no perp feed this returns a
        neutral 1.0 and says so. Wiring a venue mark into ``self.perp_marks`` turns it on
        without touching the leverage formula -- the hook exists so basis risk is priced the
        day the feed arrives, rather than being discovered after a liquidation.
        """
        mark = (self.perp_marks or {}).get(symbol)
        if not mark or not mark.get('price'):
            return 1.0, ''
        i = self.sym_idx.get(symbol)
        if i is None:
            return 1.0, ''
        price, price_ts = self.prices_at(ts)
        underlying = float(price[i])
        if underlying <= 0:
            return 1.0, ''
        # prices_at() stamps the *request* time when it falls back to a daily close, which
        # would report a six-hour-old reference as fresh. Anchor staleness to the last real
        # print instead: the close of the most recent session the market actually traded.
        stamp = datetime.fromtimestamp(int(price_ts[i]) / 1e9, tz=timezone.utc)
        if cal.phase_at(ts) not in (cal.Phase.OPEN, cal.Phase.CLOSING_RAMP):
            last_close = cal.session_close(cal.reference_close_date(ts))
            stamp = min(stamp, last_close)
        state = basis.assess(symbol, float(mark['price']), underlying, stamp, ts)
        return state.multiplier, state.note

    # ------------------------------------------------------------------ single-symbol leverage
    def symbol_risk(self, symbol: str) -> leverage.SymbolRisk:
        i = self.sym_idx[symbol]
        return leverage.SymbolRisk(symbol, float(self.gap_p99[i]), float(self.intraday_p99[i]),
                                   float(self.earnings_gap_p99[i]), float(self.adv_dollar[i]))

    def symbol_leverage(self, symbol: str, ts: datetime, notional: float = 10_000.0) -> leverage.LeverageResult:
        if symbol not in self.sym_idx:
            raise KeyError(symbol)
        i = self.sym_idx[symbol]
        phase = cal.phase_at(ts)
        ramp = cal.ramp_fraction(ts)
        earn = cal.has_earnings_tonight(symbol, ts, self.earnings)
        sector_mult, sector_note, _ = self.sector_signal(symbol, ts)
        closure_mult = cal.closure_multiplier(ts)
        basis_mult, basis_note = self.basis_signal(symbol, ts)
        res = leverage.max_leverage(self.symbol_risk(symbol), notional, phase, ramp, earn,
                                    settings.safety, settings.headline_cap,
                                    sector_mult=sector_mult, sector_note=sector_note,
                                    closure_mult=closure_mult,
                                    closure_hours=cal.closure_hours(ts),
                                    closure_label=cal.closure_label(ts),
                                    basis_mult=basis_mult, basis_note=basis_note)
        price, price_ts = self.prices_at(ts)
        prev = self.prev_close_at(ts)
        snap = guards.SymbolSnapshot(
            symbol=symbol, last_price=float(price[i]),
            last_price_ts=datetime.fromtimestamp(int(price_ts[i]) / 1e9, tz=timezone.utc),
            prev_close=float(prev[i]), halted=cal.is_halted(symbol, ts, self.halts),
            split_today=cal.to_et(ts).date() in self.splits.get(symbol, ()), earnings_window=earn)
        g = guards.check(snap, ts)
        if g.frozen:
            # A halt, a split, or an implausible print means the screen price is not tradeable.
            # New exposure against it is refused outright (0x); existing positions are still
            # never liquidated -- that is the freeze guard's whole purpose.
            return leverage.LeverageResult(**{**res.__dict__, 'frozen': True, 'max_leverage': 0.0,
                                              'reason': res.reason + ' FROZEN:' + ','.join(g.reasons)})
        return res

    # ------------------------------------------------------------------ whole-book evaluate
    def evaluate(self, ts: datetime) -> EvaluateResult:
        t0 = perf_counter()
        phase = cal.phase_at(ts)
        ramp = cal.ramp_fraction(ts)
        et_date = cal.to_et(ts).date()
        n_sym, n_acct = len(self.symbols), len(self.accounts)

        price, price_ts = self.prices_at(ts)
        prev = self.prev_close_at(ts)
        earn = np.array([cal.has_earnings_tonight(s, ts, self.earnings) for s in self.symbols], dtype=bool)

        decisions: list[Decision] = []
        frozen = np.zeros(n_sym, dtype=bool)
        for i, s in enumerate(self.symbols):
            snap = guards.SymbolSnapshot(
                symbol=s, last_price=float(price[i]),
                last_price_ts=datetime.fromtimestamp(int(price_ts[i]) / 1e9, tz=timezone.utc),
                prev_close=float(prev[i]), halted=cal.is_halted(s, ts, self.halts),
                split_today=et_date in self.splits.get(s, ()), earnings_window=bool(earn[i]))
            g = guards.check(snap, ts)
            if g.frozen:
                frozen[i] = True
                decisions.append(Decision(ts, None, s, 'freeze', None, None, None, None, None,
                                          'guards=' + ','.join(g.reasons)))

        # Same sector signal the single-symbol path uses, so /evaluate and /leverage can never
        # disagree about how wide tonight's gap could be.
        sector_mult = np.array([self.sector_signal(s, ts)[0] for s in self.symbols], dtype=float)
        basis_mult = np.array([self.basis_signal(s, ts)[0] for s in self.symbols], dtype=float)
        closure_mult = cal.closure_multiplier(ts)
        adverse = leverage.adverse_move_vec(self.intraday_p99, self.gap_p99, self.earnings_gap_p99,
                                            earn, phase, ramp, sector_mult, closure_mult,
                                            basis_mult)

        ps = self.pos_sym
        px = price[ps]
        mv = self.pos_qty * px
        notional = np.abs(mv)
        # Same phase-aware liquidity denominator the single-symbol path uses, so /evaluate and
        # /leverage can never disagree about how expensive it is to get out right now.
        reachable = np.maximum(self.adv_dollar[ps] * leverage.liquidity_fraction(phase), 1.0)
        participation = notional / reachable
        maxlev = leverage.max_leverage_vec(adverse[ps], participation, settings.safety, settings.headline_cap)

        equity = self.cash + np.bincount(self.pos_acct, weights=mv, minlength=n_acct)
        margin_req = np.bincount(self.pos_acct, weights=notional / maxlev, minlength=n_acct)
        worst = np.bincount(self.pos_acct, weights=notional * adverse[ps], minlength=n_acct)
        gross = np.bincount(self.pos_acct, weights=notional, minlength=n_acct)

        flagged = margin.flag_accounts(equity, margin_req, worst, gross)
        counts = {'reduce': 0, 'margin_call': 0, 'close': 0}
        for a in np.nonzero(flagged)[0]:
            idx = self.positions_of(int(a))
            acct_id = self.accounts[a].id
            # The vectorized pass has already established equity. An insolvent account receives
            # one account-level close mandate; the execution service expands it against its
            # authoritative position ledger. This avoids manufacturing a separate risk decision
            # for every leg while keeping the hot whole-book path under 100 ms.
            if equity[a] <= 0:
                counts['close'] += 1
                reason = f'equity={equity[a]:.0f}<=0 gross={gross[a]:.0f}'
                decisions.append(Decision(ts, acct_id, None, 'close', None, None, float(equity[a]),
                                          float(margin_req[a]), None, reason))
                continue
            views = [margin.PositionView(self.symbols[ps[j]], float(self.pos_qty[j]), float(px[j]),
                                         float(adverse[ps[j]]), float(maxlev[j]), bool(frozen[ps[j]]))
                     for j in idx]
            p = margin.plan(float(self.cash[a]), views)
            if p.action == 'hold':
                continue
            counts[p.action] += 1
            if not p.reductions:
                decisions.append(Decision(ts, acct_id, None, p.action, None, None, p.equity,
                                          p.margin_required, None, p.reason))
            for v in views:
                q = p.reductions.get(v.symbol)
                if not q:
                    continue
                decisions.append(Decision(ts, acct_id, v.symbol, p.action, v.max_leverage,
                                          v.adverse, p.equity, p.margin_required, q, p.reason))

        conc = np.bincount(ps, weights=notional, minlength=n_sym)
        total_gross = float(conc.sum())
        top = [int(i) for i in np.argsort(conc)[::-1][:5] if conc[i] > 0]
        pos_equity = equity > 0
        summary = {
            'ts': ts.isoformat(), 'phase': phase.value, 'ramp': round(ramp, 3),
            'accounts': n_acct, 'positions': int(len(ps)),
            'gross_exposure': round(total_gross, 2),
            'net_equity': round(float(equity.sum()), 2),
            'worst_case_loss': round(float(worst.sum()), 2),
            'broker_loss_at_p99': round(float(np.maximum(worst - equity, 0.0).sum()), 2),
            'accounts_at_risk': int(flagged.sum()),
            **counts,
            'frozen_symbols': [self.symbols[i] for i in np.nonzero(frozen)[0]],
            'sector_stress': [{'symbol': self.symbols[i], 'multiplier': round(float(sector_mult[i]), 3)}
                              for i in np.argsort(sector_mult)[::-1][:5] if sector_mult[i] > 1.0],
            'closure': {'hours': round(cal.closure_hours(ts), 2),
                        'label': cal.closure_label(ts),
                        'multiplier': round(float(closure_mult), 3)},
            'earnings_tonight': [self.symbols[i] for i in np.nonzero(earn)[0]],
            'top_concentration': [{'symbol': self.symbols[i], 'notional': round(float(conc[i]), 2),
                                   'share': round(float(conc[i] / total_gross), 4) if total_gross else 0.0}
                                  for i in top],
            'avg_leverage_used': round(float(np.mean(gross[pos_equity] / equity[pos_equity])), 2) if pos_equity.any() else 0.0,
            'margin_health_hist': margin.health_histogram(equity, margin_req, gross),
        }
        elapsed = (perf_counter() - t0) * 1000.0
        summary['evaluate_ms'] = round(elapsed, 2)
        return EvaluateResult(ts, phase.value, decisions, summary, elapsed, equity, margin_req, worst,
                              gross, price, maxlev, adverse, frozen, earn)

    # ------------------------------------------------------------------ mutations (replay only)
    def apply_reductions(self, result: EvaluateResult, ts: datetime) -> list[dict]:
        '''Execute the engine's reductions in-session (15:45 auto de-risk). Returns fills.'''
        fills: list[dict] = []
        for d in result.decisions:
            if d.account_id is None or d.symbol is None or not d.qty_to_reduce:
                continue
            a = self.acct_idx[d.account_id]
            s = self.sym_idx[d.symbol]
            j = self._pos_lookup.get((a, s))
            if j is None:
                continue
            q = d.qty_to_reduce
            if abs(q) > abs(self.pos_qty[j]):
                q = float(self.pos_qty[j])
            price = float(result.prices[s])
            slip = leverage.slippage(abs(q * price) / float(self.adv_dollar[s]))
            fill = price * (1.0 - slip) if q > 0 else price * (1.0 + slip)
            self.pos_qty[j] -= q
            self.cash[a] += q * fill
            fills.append({'ts': ts.isoformat(), 'account_id': d.account_id, 'symbol': d.symbol,
                          'action': d.action, 'qty': round(q, 4), 'ref_price': round(price, 4),
                          'fill_price': round(fill, 4), 'slippage_bps': round(slip * 1e4, 2),
                          'kind': 'auto_derisk'})
        return fills

    def account_view(self, account_id: str, result: EvaluateResult) -> dict:
        a = self.acct_idx[account_id]
        acct = self.accounts[a]
        rows = []
        for j in self.positions_of(a):
            s = int(self.pos_sym[j])
            px = float(result.prices[s])
            qty = float(self.pos_qty[j])
            avg = float(self.pos_avg[j]) if j < len(self.pos_avg) else float('nan')
            has_basis = avg == avg and avg > 0          # NaN-safe
            pnl = (px - avg) * qty if has_basis else None
            rows.append({'symbol': self.symbols[s], 'qty': round(qty, 4),
                         'price': round(px, 4), 'notional': round(abs(qty * px), 2),
                         'avg_price': round(avg, 4) if has_basis else None,
                         'unrealised_pnl': round(pnl, 2) if pnl is not None else None,
                         'unrealised_pct': round(px / avg - 1.0, 6) if has_basis else None,
                         'day_change': round(px / float(self.last_close[s]) - 1.0, 6)
                                       if float(self.last_close[s]) > 0 else None,
                         'margin_required': round(abs(qty * px) / float(result.pos_max_leverage[j]), 2)
                                            if float(result.pos_max_leverage[j]) > 0 else None,
                         'worst_case_loss': round(abs(qty * px) * float(result.adverse_sym[s]), 2),
                         'max_leverage': round(float(result.pos_max_leverage[j]), 2),
                         'adverse_move': round(float(result.adverse_sym[s]), 4),
                         'earnings_tonight': bool(result.earnings_sym[s]),
                         'frozen': bool(result.frozen_sym[s])})
        eq = float(result.equity[a])
        req = float(result.margin_required[a])
        return {'account_id': acct.id, 'tz': acct.tz, 'display_name': acct.display_name,
                'cash': round(float(self.cash[a]), 2), 'equity': round(eq, 2),
                'margin_required': round(req, 2), 'worst_case_loss': round(float(result.worst_case_loss[a]), 2),
                'gross_exposure': round(float(result.gross[a]), 2),
                'margin_ratio': round(eq / req, 3) if req > 0 else None,
                'leverage_used': round(float(result.gross[a]) / eq, 2) if eq > 0 else None,
                'positions': rows}
