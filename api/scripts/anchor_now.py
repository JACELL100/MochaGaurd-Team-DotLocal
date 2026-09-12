"""Immediately anchor today's live decisions to Sepolia and print the result."""
from __future__ import annotations
import asyncio, sys
from datetime import datetime, timezone
from pathlib import Path
import zoneinfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app import db
from app.anchor.publisher import anchor_day, AnchorUnavailable

# rpc.sepolia.org is often flaky; override with a reliable public endpoint.
SEPOLIA_RPCS = [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc2.sepolia.org',
    'https://sepolia.gateway.tenderly.co',
    'https://1rpc.io/sepolia',
]


async def main() -> None:
    if not settings.db_configured:
        print("ERROR: DATABASE_URL not set"); return
    if not settings.chain_configured:
        print("ERROR: CONTRACT_ADDRESS / ANCHOR_PRIVATE_KEY / SEPOLIA_RPC_URL not set"); return

    await db.init()

    et_date = datetime.now(tz=timezone.utc).astimezone(zoneinfo.ZoneInfo('America/New_York')).date()
    decisions = await db.decisions_for_day(et_date, '')
    print(f"Found {len(decisions)} live decisions for {et_date}")
    if not decisions:
        print("Nothing to anchor today.")
        await db.close(); return

    # Try each RPC until one works
    last_err = None
    for rpc in SEPOLIA_RPCS:
        settings.sepolia_rpc_url = rpc
        print(f"Trying RPC: {rpc}")
        try:
            from web3 import Web3
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={'timeout': 10}))
            cid = w3.eth.chain_id
            if cid == 11155111:
                print(f"  ✓ connected (chain {cid})")
                break
            else:
                print(f"  ✗ wrong chain {cid}")
        except Exception as e:
            print(f"  ✗ {e}")
            last_err = e
    else:
        print(f"All RPCs failed. Last error: {last_err}")
        await db.close(); return

    print(f"Anchoring {len(decisions)} decisions → Sepolia …")
    try:
        result = await anchor_day(et_date, '')
        print(f"\n✅  Anchored!")
        print(f"   merkle_root  : {result.get('merkle_root')}")
        print(f"   tx_hash      : {result.get('tx_hash')}")
        print(f"   etherscan    : https://sepolia.etherscan.io/tx/{result.get('tx_hash')}")
        first = decisions[0]['id']
        print(f"\n   Now open: http://localhost:3000/verify?id={first}")
    except AnchorUnavailable as exc:
        print(f"Chain unavailable: {exc}")
    except Exception as exc:
        print(f"ERROR: {exc}")
    finally:
        await db.close()


asyncio.run(main())
