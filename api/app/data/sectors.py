'''Sector peers that trade while the US market is shut.

Why this exists
---------------
The engine's whole thesis is that it cannot act for 17.5 hours. But the world does not stop
during those hours: TSMC and SK Hynix print until 01:00 ET, India until ~05:45 ET, ASML and
SAP until ~07:00 ET. If every chipmaker in Asia sold off overnight, that is real, already-known
information about where NVDA opens -- and an engine that only looks at NVDA's own history is
choosing to ignore it.

So overnight leverage is adjusted by how this symbol's *sector* has actually traded in the
markets that were open. This is not a price forecast: the engine never predicts a direction. It
widens the gap it must survive when peers have already moved hard, and never narrows it below
the symbol's own historical p99.

Every peer is a real, liquid instrument with a real session. `region` is only documentation --
what matters is `close_et`, the hour (ET) by which that market has finished, which is how the
engine avoids using a quote from a session that had not closed yet at the decision time.
'''
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Peer:
    ticker: str
    label: str
    region: str
    close_et: float          # hour in ET (may exceed 24 when the session ends after midnight ET)
    weight: float = 1.0


# Sector -> peers that finish trading inside the US overnight window.
# close_et is expressed on the *same* ET day the US session closed, so 25.0 means 01:00 ET the
# following morning -- after the 16:00 close, which is what makes the print usable.
SECTOR_PEERS: dict[str, tuple[Peer, ...]] = {
    'semiconductors': (
        Peer('2330.TW', 'TSMC (Taiwan)', 'Asia', 25.5, 1.5),
        Peer('000660.KS', 'SK Hynix (Korea)', 'Asia', 25.5, 1.2),
        Peer('005930.KS', 'Samsung (Korea)', 'Asia', 25.5, 1.0),
        Peer('ASML.AS', 'ASML (Amsterdam)', 'Europe', 31.5, 1.3),
    ),
    'technology': (
        Peer('^N225', 'Nikkei 225 (Japan)', 'Asia', 25.0, 1.0),
        Peer('^NSEI', 'Nifty 50 (India)', 'Asia', 30.0, 0.8),
        Peer('SAP.DE', 'SAP (Germany)', 'Europe', 31.5, 1.0),
    ),
    'autos': (
        Peer('7203.T', 'Toyota (Japan)', 'Asia', 25.0, 1.2),
        Peer('BMW.DE', 'BMW (Germany)', 'Europe', 31.5, 1.0),
        Peer('1211.HK', 'BYD (Hong Kong)', 'Asia', 28.0, 1.3),
    ),
    'broad_market': (
        Peer('^N225', 'Nikkei 225 (Japan)', 'Asia', 25.0, 1.0),
        Peer('^HSI', 'Hang Seng (Hong Kong)', 'Asia', 28.0, 0.9),
        Peer('^NSEI', 'Nifty 50 (India)', 'Asia', 30.0, 0.8),
        Peer('^STOXX50E', 'Euro Stoxx 50', 'Europe', 31.5, 1.2),
    ),
}

# Which sector each symbol belongs to. Unmapped symbols fall back to 'broad_market' only if they
# are an index/ETF; a single unmapped stock gets no peer adjustment rather than a wrong one.
SYMBOL_SECTOR: dict[str, str] = {
    'NVDA': 'semiconductors', 'AMD': 'semiconductors', 'INTC': 'semiconductors',
    'MU': 'semiconductors', 'AVGO': 'semiconductors', 'SMCI': 'semiconductors',
    'TSM': 'semiconductors', 'QCOM': 'semiconductors', 'ARM': 'semiconductors',
    'AAPL': 'technology', 'MSFT': 'technology', 'GOOGL': 'technology', 'GOOG': 'technology',
    'META': 'technology', 'AMZN': 'technology', 'CRM': 'technology', 'PLTR': 'technology',
    'ORCL': 'technology', 'ADBE': 'technology',
    'TSLA': 'autos', 'RIVN': 'autos', 'F': 'autos', 'GM': 'autos', 'LCID': 'autos',
    'SPY': 'broad_market', 'QQQ': 'broad_market', 'IWM': 'broad_market', 'DIA': 'broad_market',
    'VOO': 'broad_market', 'VTI': 'broad_market',
}

ETF_LIKE = {'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'GLD', 'SLV', 'USO', 'XBI', 'SOXX'}


def sector_of(symbol: str) -> str | None:
    symbol = symbol.upper()
    if symbol in SYMBOL_SECTOR:
        return SYMBOL_SECTOR[symbol]
    return 'broad_market' if symbol in ETF_LIKE else None


def peers_for(symbol: str) -> tuple[Peer, ...]:
    sector = sector_of(symbol)
    return SECTOR_PEERS.get(sector, ()) if sector else ()


def all_peer_tickers() -> list[str]:
    seen: dict[str, None] = {}
    for peers in SECTOR_PEERS.values():
        for peer in peers:
            seen.setdefault(peer.ticker, None)
    return list(seen)


# --------------------------------------------------------------------------- ingestion
import asyncio        # noqa: E402
import logging        # noqa: E402
from datetime import date, datetime  # noqa: E402

log = logging.getLogger('mochaguard.sectors')


def _fetch_one(ticker: str) -> dict | None:
    '''Last two completed daily closes for one peer, via yfinance (no key required).'''
    import yfinance as yf

    frame = yf.Ticker(ticker).history(period='10d', interval='1d', auto_adjust=True)
    frame = frame.dropna(subset=['Close'])
    if len(frame) < 2:
        return None
    close = float(frame['Close'].iloc[-1])
    prev = float(frame['Close'].iloc[-2])
    if prev <= 0:
        return None
    stamp = frame.index[-1]
    session = stamp.date() if isinstance(stamp, datetime) else date.fromisoformat(str(stamp)[:10])
    return {'ticker': ticker, 'session_d': session, 'close_price': close, 'prev_close': prev,
            'move': close / prev - 1.0}


async def refresh_sector_moves(tickers: list[str] | None = None) -> dict:
    '''Fetch and store the latest completed session move for each peer.

    Runs the blocking yfinance calls off the event loop. A peer that fails is skipped rather
    than failing the batch: the adjustment degrades to whatever peers did answer.
    '''
    from .. import db

    tickers = tickers or all_peer_tickers()
    results = await asyncio.gather(
        *(asyncio.to_thread(_fetch_one, ticker) for ticker in tickers),
        return_exceptions=True)

    rows, failed = [], []
    for ticker, result in zip(tickers, results):
        if isinstance(result, Exception) or result is None:
            failed.append(ticker)
            log.warning('sector peer unavailable: %s (%s)', ticker, result)
            continue
        rows.append(result)

    written = await db.upsert_sector_moves(rows)
    return {'tickers': len(tickers), 'stored': written, 'failed': failed,
            'moves': {r['ticker']: round(r['move'], 5) for r in rows}}
