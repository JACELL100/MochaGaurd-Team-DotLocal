'''Halt inference: a stopped tape must not read as a calm one.

This is the trap in the problem statement -- "price stops updating and stays flat, a dumb
engine reads that as very safe". These tests pin the signature we key on and, importantly, the
two look-alikes we must NOT flag.
'''
from datetime import datetime, timedelta

from app.data.halts import MIN_FLAT_BARS, _detect
from app.engine.calendar import ET, Phase, is_halted, phase_at


def _bars(start, prices, vols, step=5):
    return [{'ts': start + timedelta(minutes=step * i), 'close': p, 'volume': v}
            for i, (p, v) in enumerate(zip(prices, vols))]


def test_flat_zero_volume_run_is_a_halt():
    start = datetime(2026, 9, 8, 11, 0, tzinfo=ET)
    bars = _bars(start, [100.0, 100.5, 100.5, 100.5, 100.5, 100.5, 97.0],
                        [5000, 5000, 0, 0, 0, 0, 9000])
    found = _detect(bars)
    assert len(found) == 1
    assert found[0]['bars'] >= MIN_FLAT_BARS
    assert found[0]['ended_at'] > found[0]['started_at']


def test_flat_price_with_volume_is_not_a_halt():
    '''An illiquid name can print the same price repeatedly while still trading.'''
    start = datetime(2026, 9, 8, 11, 0, tzinfo=ET)
    assert _detect(_bars(start, [100.5] * 6, [5000] * 6)) == []


def test_zero_volume_outside_regular_hours_is_not_a_halt():
    '''Pre-market is quiet by nature; a sleeping tape at 5 AM is not a halt.'''
    start = datetime(2026, 9, 8, 5, 0, tzinfo=ET)
    assert phase_at(start) == Phase.PRE
    assert _detect(_bars(start, [100.5] * 6, [0] * 6)) == []


def test_short_gap_is_ignored():
    start = datetime(2026, 9, 8, 11, 0, tzinfo=ET)
    bars = _bars(start, [100.0, 100.5, 100.5, 101.0], [5000, 5000, 0, 6000])
    assert _detect(bars) == []


def test_detected_halt_reads_back_through_the_calendar_guard():
    '''The whole point: a detected halt must make is_halted() true for the engine.'''
    start = datetime(2026, 9, 8, 11, 0, tzinfo=ET)
    found = _detect(_bars(start, [100.0] + [100.5] * 5, [5000] + [0] * 5))
    assert found
    halts = {'X': [(found[0]['started_at'], found[0]['ended_at'])]}
    assert is_halted('X', found[0]['started_at'], halts)
    assert not is_halted('X', found[0]['ended_at'] + timedelta(minutes=5), halts)
