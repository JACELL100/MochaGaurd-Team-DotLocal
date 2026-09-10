"""Apply the idempotent Supabase schema once per environment."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db


async def main() -> None:
    await db.init()
    try:
        await db.migrate()
        print('Supabase schema applied successfully.')
    finally:
        await db.close()


if __name__ == '__main__':
    asyncio.run(main())
