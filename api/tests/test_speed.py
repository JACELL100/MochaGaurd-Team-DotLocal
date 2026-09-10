import statistics
from datetime import datetime
from time import perf_counter

from app.demo import DEMO_DAY, demo_book
from app.engine.calendar import ET


def test_evaluate_2000_accounts_under_100ms():
    book = demo_book(2000)
    ts = datetime(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day, 15, 45, tzinfo=ET)
    book.evaluate(ts)  # warm up
    samples = []
    for _ in range(5):
        t0 = perf_counter()
        res = book.evaluate(ts)
        samples.append((perf_counter() - t0) * 1000)
    assert res.summary['accounts'] == 2000
    assert statistics.median(samples) < 100.0, samples
