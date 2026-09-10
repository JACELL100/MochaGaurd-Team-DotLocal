'''Session calendar: the single source of truth for "what time is it in market terms".

Every function takes an explicit timezone-aware ``ts``. Wall-clock access is banned in
engine code so the replay harness can thread a simulated clock through everything.
'''
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from enum import Enum
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')


class Phase(str, Enum):
    PRE = 'pre'
    OPEN = 'open'
    CLOSING_RAMP = 'closing_ramp'
    CLOSED = 'closed'


PRE_OPEN = time(4, 0)
OPEN = time(9, 30)
RAMP_START = time(15, 30)
OVERNIGHT_CHECK = time(15, 45)
CLOSE = time(16, 0)

# NYSE full-day closures. Extend for the replay window you care about.
HOLIDAYS: frozenset[date] = frozenset({
    date(2024, 1, 1), date(2024, 1, 15), date(2024, 2, 19), date(2024, 3, 29),
    date(2024, 5, 27), date(2024, 6, 19), date(2024, 7, 4), date(2024, 9, 2),
    date(2024, 11, 28), date(2024, 12, 25),
    date(2025, 1, 1), date(2025, 1, 9), date(2025, 1, 20), date(2025, 2, 17),
    date(2025, 4, 18), date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4),
    date(2025, 9, 1), date(2025, 11, 27), date(2025, 12, 25),
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
})


def to_et(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        raise ValueError('engine requires timezone-aware timestamps')
    return ts.astimezone(ET)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS


def next_trading_day(d: date) -> date:
    d = d + timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def prev_trading_day(d: date) -> date:
    d = d - timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def phase_at(ts: datetime) -> Phase:
    et = to_et(ts)
    if not is_trading_day(et.date()):
        return Phase.CLOSED
    t = et.time()
    if t < PRE_OPEN or t >= CLOSE:
        return Phase.CLOSED
    if t < OPEN:
        return Phase.PRE
    if t < RAMP_START:
        return Phase.OPEN
    return Phase.CLOSING_RAMP


def ramp_fraction(ts: datetime) -> float:
    '''Front-loaded 15:30→16:00 overnight-risk ramp (0.0→1.0).

    The engine is deliberately more conservative before the bell: by 15:45, three quarters of
    overnight risk is reflected rather than only half.  It remains continuous and reaches the
    complete overnight limit exactly at 16:00.
    '''
    phase = phase_at(ts)
    if phase == Phase.CLOSING_RAMP:
        et = to_et(ts)
        start = et.replace(hour=15, minute=30, second=0, microsecond=0)
        linear = min(1.0, max(0.0, (et - start).total_seconds() / 1800.0))
        return 1.0 - (1.0 - linear) ** 2
    return 0.0 if phase == Phase.OPEN else 1.0


def reference_close_date(ts: datetime) -> date:
    '''Date of the most recent daily close that is *known* at ``ts`` (no look-ahead).'''
    et = to_et(ts)
    d = et.date()
    if is_trading_day(d) and et.time() >= CLOSE:
        return d
    return prev_trading_day(d)


def session_close(d: date) -> datetime:
    return datetime.combine(d, CLOSE, tzinfo=ET)


def session_open(d: date) -> datetime:
    return datetime.combine(d, OPEN, tzinfo=ET)


def next_open(ts: datetime) -> datetime:
    et = to_et(ts)
    d = et.date()
    if is_trading_day(d) and et.time() < OPEN:
        return session_open(d)
    return session_open(next_trading_day(d))


def next_close(ts: datetime) -> datetime:
    '''The next 16:00 ET close at or after ``ts`` (the deadline a user must act by).'''
    et = to_et(ts)
    d = et.date()
    if is_trading_day(d) and et.time() < CLOSE:
        return session_close(d)
    return session_close(next_trading_day(d))


def has_earnings_tonight(symbol: str, ts: datetime,
                         earnings: dict[str, list[tuple[date, str | None]]]) -> bool:
    '''True if the symbol reports between this session's close and the next open.

    Convention: (report_date, timing) with timing in {'amc', 'bmo', None}. Unknown timing is
    treated conservatively as before-market-open of the report date.
    '''
    events = earnings.get(symbol)
    if not events:
        return False
    et = to_et(ts)
    if is_trading_day(et.date()) and et.time() < CLOSE:
        today = et.date()
    else:
        today = reference_close_date(ts)
    nxt = next_trading_day(today)
    for d, timing in events:
        t = (timing or 'bmo').lower()
        if d == today and t == 'amc':
            return True
        if d == nxt and t != 'amc':
            return True
    return False


def is_halted(symbol: str, ts: datetime,
              halts: dict[str, list[tuple[datetime, datetime | None]]]) -> bool:
    for start, end in halts.get(symbol, ()):
        if start <= ts and (end is None or ts < end):
            return True
    return False


def local_time_str(ts: datetime, tz: str) -> str:
    try:
        loc = ts.astimezone(ZoneInfo(tz))
    except Exception:
        loc = ts.astimezone(ZoneInfo('UTC'))
    return loc.strftime('%I:%M %p %Z').lstrip('0')
