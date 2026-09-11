'''Seed a demonstration book of accounts and positions against the real symbol universe.

Why this exists
---------------
The risk engine's interesting output -- crowding, overnight margin calls, an unwind queue --
only appears when there is a book to evaluate. In production that book arrives from
Mochatrade's brokerage service via POST /internal/accounts/sync. With no book, every dashboard
is empty, which is what pushed hard-coded sample numbers into the frontend.

This script fills that gap honestly. Positions are generated, but they are sized against the
*real* split-adjusted prices and *real* risk statistics already in the database, and every
account is labelled 'Sample' with a reserved @sample.mochaguard.local email so it can never be
confused with a real customer or collide with a Google sign-in. Re-running is idempotent:
sample accounts are replaced, real accounts are never touched.

    python scripts/seed_book.py            # 400 accounts (default)
    python scripts/seed_book.py 2000        # the full book from the problem statement
    python scripts/seed_book.py --clear     # remove every sample account
'''
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402

SAMPLE_DOMAIN = 'sample.mochaguard.local'
TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Asia/Singapore',
             'America/New_York', 'Europe/Berlin']
# The book is deliberately crowded: a majority of gross exposure sits in a handful of names, so
# book-level concentration is a real signal rather than a rounding error.
CROWD_WEIGHT = 6.0
CROWD_SHARE = 0.45          # fraction of the universe treated as "popular"
LEVERED_FRACTION = 0.18     # share of accounts run hot enough to trip the overnight check


async def clear_samples() -> int:
    pool = db.pool()
    rows = await pool.fetch("select id from accounts where email like $1", f'%@{SAMPLE_DOMAIN}')
    if not rows:
        return 0
    ids = [r['id'] for r in rows]
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute('delete from positions where account_id = any($1::uuid[])', ids)
            await conn.execute('delete from accounts where id = any($1::uuid[])', ids)
    return len(ids)


async def seed(n_accounts: int, seed_value: int = 7) -> dict:
    rng = np.random.default_rng(seed_value)
    pool = db.pool()

    risk = {r['symbol']: dict(r) for r in await pool.fetch(
        'select symbol, last_close, adv_dollar, gap_p99 from symbol_risk')}
    symbols = [s for s, r in sorted(risk.items()) if (r.get('last_close') or 0) > 0]
    if not symbols:
        raise SystemExit('No symbol_risk rows. Run scripts/seed_market.py first.')

    prices = np.array([float(risk[s]['last_close']) for s in symbols])
    # Popular names are the most liquid ones -- that is what real retail crowding looks like.
    adv = np.array([float(risk[s].get('adv_dollar') or 0.0) for s in symbols])
    n_crowd = max(1, int(round(len(symbols) * CROWD_SHARE)))
    crowd = set(np.argsort(adv)[::-1][:n_crowd].tolist())
    weights = np.array([CROWD_WEIGHT if i in crowd else 1.0 for i in range(len(symbols))])
    weights /= weights.sum()

    await clear_samples()

    accounts: list[tuple] = []
    positions: list[tuple] = []
    for i in range(n_accounts):
        tz = TIMEZONES[i % len(TIMEZONES)]
        equity = float(rng.lognormal(np.log(40_000), 0.9))
        hot = rng.random() < LEVERED_FRACTION
        lev = float(rng.uniform(6.0, 14.0)) if hot else float(rng.uniform(1.0, 5.0))
        k = int(rng.integers(1, min(5, len(symbols)) + 1))
        picks = rng.choice(len(symbols), size=k, replace=False, p=weights)
        gross = equity * lev
        for p in picks:
            qty = gross / k / prices[p]
            # Entry prices are scattered around the current mark so the book carries realistic
            # unrealised P&L -- some winners, some losers. Sizing still uses the *current*
            # price, so notional and margin are unaffected; only the cost basis varies.
            drift = float(rng.normal(0.0, 0.06))
            entry = max(0.01, float(prices[p]) * (1.0 - drift))
            positions.append((f'sample-{i + 1:05d}', symbols[p], round(float(qty), 6),
                              round(entry, 4)))
        # equity = cash + market value, so a levered long carries a negative cash balance
        accounts.append((f'sample-{i + 1:05d}@{SAMPLE_DOMAIN}', f'Sample Trader {i + 1}', tz,
                         round(equity - gross, 2)))

    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                '''insert into accounts (email, display_name, tz, cash)
                   select * from unnest($1::text[], $2::text[], $3::text[], $4::double precision[])
                   returning id, email''',
                [a[0] for a in accounts], [a[1] for a in accounts],
                [a[2] for a in accounts], [a[3] for a in accounts])
            by_email = {r['email']: r['id'] for r in rows}
            handle_to_id = {e.split('@')[0]: i for e, i in by_email.items()}
            pos_rows = [(handle_to_id[h], sym, qty, avg) for h, sym, qty, avg in positions
                        if h in handle_to_id]
            await conn.executemany(
                'insert into positions (account_id, symbol, qty, avg_price) values ($1, $2, $3, $4)',
                pos_rows)

    return {'accounts': len(accounts), 'positions': len(pos_rows), 'symbols': len(symbols),
            'crowded': sorted(symbols[i] for i in crowd)}


async def main() -> None:
    args = [a for a in sys.argv[1:]]
    await db.init()
    try:
        if '--clear' in args:
            removed = await clear_samples()
            print(f'Removed {removed} sample accounts.')
            return
        n = next((int(a) for a in args if a.isdigit()), 400)
        info = await seed(n)
        print(f"Seeded {info['accounts']} sample accounts and {info['positions']} positions "
              f"across {info['symbols']} real symbols.")
        print(f"Crowded names: {', '.join(info['crowded'])}")
        print('Remove them at any time with: python scripts/seed_book.py --clear')
    finally:
        await db.close()


if __name__ == '__main__':
    asyncio.run(main())
