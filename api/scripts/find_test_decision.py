"""
Print the most recent risk_decisions (with their IDs) so you can test /verify.
If none exist, seeds one test decision + anchors it to Sepolia.

Usage:  python scripts/find_test_decision.py
"""
from __future__ import annotations
import asyncio, sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app import db


async def main() -> None:
    if not settings.db_configured:
        print("ERROR: DATABASE_URL is not set in api/.env")
        return

    await db.init()

    # ── 1. Show the 5 most-recent decisions ─────────────────────────────────
    rows = await db.pool().fetch(
        "SELECT id, ts, account_id, symbol, action, run_id FROM risk_decisions ORDER BY id DESC LIMIT 5"
    )
    if rows:
        print(f"\n{'ID':>8}  {'ts':26}  {'run_id':20}  {'action':12}  symbol")
        print("-" * 80)
        for r in rows:
            print(f"{r['id']:>8}  {str(r['ts'])[:26]}  {(r['run_id'] or 'live'):20}  {r['action']:12}  {r['symbol'] or '–'}")
        print(f"\n✅  Use ID #{rows[0]['id']} to test  →  GET /verify/{rows[0]['id']}")
        print(f"    or open: http://localhost:3000/verify?id={rows[0]['id']}")

    # ── 2. If empty, seed one synthetic decision so there is something to verify ─
    else:
        print("No decisions found — inserting one synthetic test decision …")
        now = datetime.now(tz=timezone.utc)
        ids = await db.log_decisions([{
            'ts': now,
            'account_id': None,
            'symbol': 'NVDA',
            'action': 'reduce',
            'max_leverage': 4.0,
            'adverse_move': 0.07,
            'equity': 50_000.0,
            'margin_required': 48_000.0,
            'qty_to_reduce': 10.0,
            'reason': 'test decision seeded by find_test_decision.py',
        }], run_id='')
        decision_id = ids[0]
        print(f"\n✅  Synthetic decision inserted with ID #{decision_id}")

        if settings.chain_configured:
            print("   Chain is configured — anchoring now (this sends a Sepolia tx) …")
            from app.anchor.publisher import anchor_day
            import zoneinfo
            et_date = now.astimezone(zoneinfo.ZoneInfo('America/New_York')).date()
            try:
                result = await anchor_day(et_date, '')
                print(f"   Anchored ✓  tx_hash = {result.get('tx_hash')}")
            except Exception as exc:
                print(f"   Anchor failed (you can still test /verify, it will show 'not yet anchored'): {exc}")
        else:
            print("   Chain not configured — decision is logged but not yet anchored.")

        print(f"\n   Test it:  GET /verify/{decision_id}")
        print(f"   or open:  http://localhost:3000/verify?id={decision_id}")

    await db.close()


asyncio.run(main())
