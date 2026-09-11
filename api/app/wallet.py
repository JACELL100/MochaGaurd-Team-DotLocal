"""Crypto wallet integration: Alchemy on-chain data + CoinGecko prices.

Fetches real token balances from any EVM wallet, prices them via CoinGecko,
computes volatility-based risk parameters, and returns data in the exact
shape that the existing BookState + risk engine already understands.

Nothing in this module modifies the database directly — it returns structured
data that the FastAPI endpoint writes through the existing db.py functions.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx
import numpy as np

log = logging.getLogger('mochaguard.wallet')

# ─── Chain configuration ─────────────────────────────────────────────────────

CHAIN_RPC: dict[int, str] = {
    1:     'https://eth-mainnet.g.alchemy.com/v2/{key}',
    137:   'https://polygon-mainnet.g.alchemy.com/v2/{key}',
    42161: 'https://arb-mainnet.g.alchemy.com/v2/{key}',
    8453:  'https://base-mainnet.g.alchemy.com/v2/{key}',
    10:    'https://opt-mainnet.g.alchemy.com/v2/{key}',
}

CHAIN_NAMES: dict[int, str] = {
    1:     'ethereum',
    137:   'polygon',
    42161: 'arbitrum',
    8453:  'base',
    10:    'optimism',
}

# Native coin for each supported chain → (internal_symbol, coingecko_id, display_name)
CHAIN_NATIVE: dict[int, tuple[str, str, str]] = {
    1:     ('ETH',  'ethereum',    'Ethereum'),
    137:   ('POL',  'matic-network', 'Polygon'),
    42161: ('ETH',  'ethereum',    'Ethereum'),
    8453:  ('ETH',  'ethereum',    'Ethereum'),
    10:    ('ETH',  'ethereum',    'Ethereum'),
}

# ─── Token catalogue ─────────────────────────────────────────────────────────
# contract_address (lowercase) → (coingecko_id, internal_symbol, display_name)
CONTRACT_TO_META: dict[str, tuple[str, str, str]] = {
    # ── Ethereum mainnet ───────────────────────────────────────────────────
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': ('weth',                      'WETH',  'Wrapped Ether'),
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': ('wrapped-bitcoin',            'WBTC',  'Wrapped Bitcoin'),
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': ('usd-coin',                  'USDC',  'USD Coin'),
    '0xdac17f958d2ee523a2206206994597c13d831ec7': ('tether',                     'USDT',  'Tether'),
    '0x6b175474e89094c44da98b954eedeac495271d0f': ('dai',                        'DAI',   'Dai'),
    '0x514910771af9ca656af840dff83e8264ecf986ca': ('chainlink',                  'LINK',  'Chainlink'),
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': ('uniswap',                    'UNI',   'Uniswap'),
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': ('aave',                       'AAVE',  'Aave'),
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': ('maker',                      'MKR',   'Maker'),
    '0xd533a949740bb3306d119cc777fa900ba034cd52': ('curve-dao-token',            'CRV',   'Curve DAO'),
    '0xc00e94cb662c3520282e6f5717214004a7f26888': ('compound-governance-token',  'COMP',  'Compound'),
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': ('shiba-inu',                 'SHIB',  'Shiba Inu'),
    '0x4d224452801aced8b2f0aebe155379bb5d594381': ('apecoin',                    'APE',   'ApeCoin'),
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': ('staked-ether',               'stETH', 'Lido Staked ETH'),
    '0x5a98fcbea516cf06857215779fd812ca3bef1b32': ('lido-dao',                   'LDO',   'Lido DAO'),
    '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': ('matic-network',              'POL',   'Polygon'),
    '0xb50721bcf8d664c30412cfbc6cf7a15145234ad1': ('arbitrum',                   'ARB',   'Arbitrum'),
    '0x0f5d2fb29fb7d3cfee444a200298f468908cc942': ('decentraland',               'MANA',  'Decentraland'),
    '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c': ('enjincoin',                  'ENJ',   'Enjin Coin'),
    '0x0d8775f648430679a709e98d2b0cb6250d2887ef': ('basic-attention-token',      'BAT',   'Basic Attention'),
    '0x4e15361fd6b4bb609fa63c81a2be19d873717870': ('fantom',                     'FTM',   'Fantom'),
    '0x6810e776880c02933d47db1b9fc05908e5386b96': ('gnosis',                     'GNO',   'Gnosis'),
    '0xe41d2489571d322189246dafa5ebde1f4699f498': ('0x',                         'ZRX',   '0x Protocol'),
    '0xba100000625a3754423978a60c9317c58a424e3d': ('balancer',                   'BAL',   'Balancer'),
    '0x111111111117dc0aa78b770fa6a738034120c302': ('1inch',                      '1INCH', '1inch'),
    '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0': ('frax-share',                 'FXS',   'Frax Share'),
    '0x853d955acef822db058eb8505911ed77f175b99e': ('frax',                       'FRAX',  'Frax'),
}

_TOKEN_DECIMALS: dict[str, int] = {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,
    '0x6b175474e89094c44da98b954eedeac495271d0f': 18,
    '0x514910771af9ca656af840dff83e8264ecf986ca': 18,
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 18,
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 18,
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': 18,
    '0xd533a949740bb3306d119cc777fa900ba034cd52': 18,
    '0xc00e94cb662c3520282e6f5717214004a7f26888': 18,
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': 18,
    '0x4d224452801aced8b2f0aebe155379bb5d594381': 18,
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 18,
    '0x5a98fcbea516cf06857215779fd812ca3bef1b32': 18,
    '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 18,
    '0xb50721bcf8d664c30412cfbc6cf7a15145234ad1': 18,
    '0x853d955acef822db058eb8505911ed77f175b99e': 18,
}

# CoinGecko IDs and symbols that are stablecoins → add to cash, not positions
STABLECOIN_CG_IDS = frozenset({
    'usd-coin', 'tether', 'dai', 'binance-usd', 'true-usd', 'frax',
    'liquity-usd', 'gemini-dollar', 'paxos-standard', 'eurc',
    'usds', 'first-digital-usd', 'paypal-usd', 'usdd',
})
STABLECOIN_SYMBOLS = frozenset({
    'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FRAX', 'LUSD', 'GUSD',
    'USDP', 'EURC', 'USDS', 'FDUSD', 'PYUSD', 'crvUSD', 'USDD',
})

COINGECKO_BASE = 'https://api.coingecko.com/api/v3'
MIN_POSITION_USD = 10.0   # skip dust below this threshold


# ─── Alchemy helpers ──────────────────────────────────────────────────────────

async def _rpc(client: httpx.AsyncClient, url: str, method: str, params: list) -> Any:
    resp = await client.post(url, json={'jsonrpc': '2.0', 'method': method, 'params': params, 'id': 1}, timeout=20.0)
    resp.raise_for_status()
    body = resp.json()
    if 'error' in body:
        raise RuntimeError(f'Alchemy RPC error ({method}): {body["error"]}')
    return body['result']


async def _eth_balance(client: httpx.AsyncClient, rpc_url: str, address: str) -> float:
    result = await _rpc(client, rpc_url, 'eth_getBalance', [address, 'latest'])
    return int(result, 16) / 1e18


async def _token_balances(client: httpx.AsyncClient, rpc_url: str, address: str) -> list[dict]:
    result = await _rpc(client, rpc_url, 'alchemy_getTokenBalances', [address, 'erc20'])
    raw_list = result.get('tokenBalances', [])

    out: list[dict] = []
    for tb in raw_list:
        hex_bal = tb.get('tokenBalance', '0x0') or '0x0'
        try:
            raw = int(hex_bal, 16)
        except ValueError:
            continue
        if raw == 0:
            continue

        contract = tb['contractAddress'].lower()

        if contract in CONTRACT_TO_META:
            cg_id, symbol, name = CONTRACT_TO_META[contract]
            decimals = _TOKEN_DECIMALS.get(contract, 18)
        else:
            # Unknown token — fetch metadata from Alchemy
            try:
                meta = await _rpc(client, rpc_url, 'alchemy_getTokenMetadata', [tb['contractAddress']])
                decimals = int(meta.get('decimals') or 18)
                symbol = (meta.get('symbol') or '').upper()[:16].strip()
                name = (meta.get('name') or symbol)[:80]
                cg_id = None
            except Exception as exc:
                log.debug('Token metadata fetch failed for %s: %s', contract, exc)
                continue

        if not symbol or decimals is None:
            continue

        balance = raw / (10 ** decimals)
        out.append({
            'contract': contract,
            'symbol': symbol,
            'name': name,
            'coingecko_id': cg_id,
            'balance': balance,
        })

    return out


# ─── CoinGecko helpers ────────────────────────────────────────────────────────

async def _cg(client: httpx.AsyncClient, path: str, params: dict, api_key: str) -> Any:
    resp = await client.get(
        f'{COINGECKO_BASE}{path}',
        params={**params, 'x_cg_demo_api_key': api_key},
        timeout=25.0,
    )
    resp.raise_for_status()
    return resp.json()


async def _prices(client: httpx.AsyncClient, cg_ids: list[str], api_key: str) -> dict[str, dict]:
    if not cg_ids:
        return {}
    data = await _cg(client, '/simple/price', {
        'ids': ','.join(sorted(set(cg_ids))),
        'vs_currencies': 'usd',
        'include_24hr_change': 'true',
        'include_24hr_vol': 'true',
        'include_market_cap': 'true',
    }, api_key)
    return data or {}


async def _ohlcv(client: httpx.AsyncClient, cg_id: str, api_key: str, days: int = 90) -> list[list]:
    try:
        data = await _cg(client, f'/coins/{cg_id}/ohlc', {'vs_currency': 'usd', 'days': str(days)}, api_key)
        return data or []
    except Exception as exc:
        log.warning('CoinGecko OHLCV failed for %s: %s', cg_id, exc)
        return []


async def _volumes(client: httpx.AsyncClient, cg_id: str, api_key: str, days: int = 30) -> list[list]:
    try:
        data = await _cg(client, f'/coins/{cg_id}/market_chart', {
            'vs_currency': 'usd', 'days': str(days), 'interval': 'daily',
        }, api_key)
        return data.get('total_volumes', [])
    except Exception as exc:
        log.warning('CoinGecko volumes failed for %s: %s', cg_id, exc)
        return []


# ─── Risk computation ─────────────────────────────────────────────────────────

def _compute_risk(symbol: str, ohlcv: list[list], vol_data: list[list], price: float) -> dict:
    today = date.today()
    if len(ohlcv) < 5:
        # Conservative fallback for unknown/new tokens
        return {
            'symbol': symbol, 'as_of': today,
            'gap_p50': 0.06, 'gap_p99': 0.20, 'intraday_p99': 0.15,
            'earnings_gap_p99': 0.30, 'adv_dollar': 500_000.0,
            'adv_shares': 500_000.0 / price if price > 0 else 0.0,
            'last_close': price, 'n_days': 0, 'n_earnings': 0,
        }

    opens  = np.array([r[1] for r in ohlcv], dtype=float)
    highs  = np.array([r[2] for r in ohlcv], dtype=float)
    lows   = np.array([r[3] for r in ohlcv], dtype=float)
    closes = np.array([r[4] for r in ohlcv], dtype=float)

    # Overnight gap: |open_t - close_{t-1}| / close_{t-1}
    valid = closes[:-1] > 0
    if np.any(valid):
        gaps = np.abs((opens[1:][valid] - closes[:-1][valid]) / closes[:-1][valid])
        gap_p50 = float(np.percentile(gaps, 50))
        gap_p99 = float(np.percentile(gaps, 99)) if len(gaps) >= 20 else float(np.max(gaps))
    else:
        gap_p50, gap_p99 = 0.05, 0.15

    # Intraday range: (high - low) / open
    valid_o = opens > 0
    if np.any(valid_o):
        intraday = (highs[valid_o] - lows[valid_o]) / opens[valid_o]
        intraday_p99 = float(np.percentile(intraday, 99)) if len(intraday) >= 20 else float(np.max(intraday))
    else:
        intraday_p99 = gap_p99 * 0.8

    # Crypto has no earnings; use 1.5x gap_p99 for flash-crash events (capped at 99%)
    earnings_gap_p99 = min(gap_p99 * 1.5, 0.99)

    # ADV from CoinGecko volume feed (last 30 days, in USD)
    adv_dollar = 0.0
    if vol_data:
        vols_usd = [v[1] for v in vol_data[-30:] if len(v) >= 2 and v[1] > 0]
        adv_dollar = float(np.median(vols_usd)) if vols_usd else 0.0
    adv_shares = adv_dollar / price if price > 0 else 0.0

    return {
        'symbol': symbol, 'as_of': today,
        'gap_p50': gap_p50, 'gap_p99': gap_p99,
        'intraday_p99': intraday_p99, 'earnings_gap_p99': earnings_gap_p99,
        'adv_dollar': adv_dollar, 'adv_shares': adv_shares,
        'last_close': price, 'n_days': len(ohlcv), 'n_earnings': 0,
    }


def _to_daily_bars(ohlcv: list[list]) -> list[dict]:
    bars: list[dict] = []
    seen: set[date] = set()
    for row in ohlcv:
        ts_ms, o, h, l, c = row[0], row[1], row[2], row[3], row[4]
        d = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).date()
        if d in seen:
            continue
        seen.add(d)
        bars.append({'d': d, 'open': o, 'high': h, 'low': l, 'close': c, 'adj_close': c, 'volume': 0.0})
    return bars


# ─── Main orchestrator ────────────────────────────────────────────────────────

async def fetch_wallet_data(
    wallet_address: str,
    chain_id: int,
    alchemy_api_key: str,
    cg_api_key: str,
) -> dict:
    """
    Full pipeline: EVM wallet → positions + risk data ready for the risk engine.

    Returns a dict with keys:
      positions          list[{symbol, qty, avg_price, notional_usd}]
      cash_usd           float  (stablecoin balances + dust)
      symbols_to_upsert  list[{symbol, name, asset_type, exchange}]
      risk_rows          list[symbol_risk row dicts]
      daily_bars         {symbol: list[bar dicts]}
      intraday_bars      {symbol: list[bar dicts]}
      summary            {wallet_address, chain_id, chain_name, total_usd, ...}
    """
    if chain_id not in CHAIN_RPC:
        raise ValueError(
            f'Chain {chain_id} is not supported. Supported chain IDs: {sorted(CHAIN_RPC)}'
        )

    rpc_url    = CHAIN_RPC[chain_id].format(key=alchemy_api_key)
    chain_name = CHAIN_NAMES[chain_id]
    native_sym, native_cg_id, native_name = CHAIN_NATIVE[chain_id]

    positions:           list[dict] = []
    symbols_to_upsert:   list[dict] = []
    risk_rows:           list[dict] = []
    daily_bars_out:      dict[str, list[dict]] = {}
    intraday_bars_out:   dict[str, list[dict]] = {}
    cash_usd = 0.0
    skipped  = 0

    async with httpx.AsyncClient(headers={'Content-Type': 'application/json'}) as client:
        # ── 1. Native balance (ETH / POL / …) ────────────────────────────────
        native_balance = await _eth_balance(client, rpc_url, wallet_address)
        log.info('Wallet %s…: native %.6f %s on chain %d', wallet_address[:8], native_balance, native_sym, chain_id)

        # ── 2. ERC-20 balances ────────────────────────────────────────────────
        tokens = await _token_balances(client, rpc_url, wallet_address)
        log.info('Wallet %s…: %d ERC-20 tokens', wallet_address[:8], len(tokens))

        # ── 3. Batch price all known CoinGecko IDs ────────────────────────────
        cg_ids_needed = list({native_cg_id} | {
            t['coingecko_id'] for t in tokens if t['coingecko_id']
        })
        price_data = await _prices(client, cg_ids_needed, cg_api_key)

        # ── 4. Helper: process one asset's risk data ──────────────────────────
        async def _process(symbol: str, cg_id: str, price: float, name: str) -> None:
            ohlcv_data = await _ohlcv(client, cg_id, cg_api_key, days=90)
            vol_data   = await _volumes(client, cg_id, cg_api_key, days=30)

            risk = _compute_risk(symbol, ohlcv_data, vol_data, price)
            risk_rows.append(risk)

            bars = _to_daily_bars(ohlcv_data)
            if bars:
                daily_bars_out[symbol] = bars

            now_utc = datetime.now(tz=timezone.utc)
            intraday_bars_out[symbol] = [{
                'ts': now_utc, 'open': price, 'high': price,
                'low': price, 'close': price, 'volume': 0.0,
            }]

            symbols_to_upsert.append({
                'symbol': symbol, 'name': name,
                'asset_type': 'crypto', 'exchange': chain_name,
            })

        # ── 5. Native coin ────────────────────────────────────────────────────
        native_price_info = price_data.get(native_cg_id, {})
        native_price      = native_price_info.get('usd', 0.0) or 0.0
        native_notional   = native_balance * native_price

        if native_notional >= MIN_POSITION_USD and native_balance > 0:
            await _process(native_sym, native_cg_id, native_price, native_name)
            positions.append({
                'symbol': native_sym, 'qty': native_balance,
                'avg_price': None, 'notional_usd': native_notional,
            })
        else:
            cash_usd += native_notional

        # ── 6. ERC-20 tokens ─────────────────────────────────────────────────
        for token in tokens:
            cg_id   = token['coingecko_id']
            symbol  = token['symbol']
            balance = token['balance']
            is_stable = (
                (cg_id in STABLECOIN_CG_IDS)
                or (symbol in STABLECOIN_SYMBOLS)
            )

            info    = price_data.get(cg_id, {}) if cg_id else {}
            price   = info.get('usd', 0.0) or 0.0
            notional = balance * price

            if is_stable:
                cash_usd += notional
                continue

            if notional < MIN_POSITION_USD or not cg_id or price <= 0:
                skipped += 1
                continue

            await _process(symbol, cg_id, price, token['name'])
            positions.append({
                'symbol': symbol, 'qty': balance,
                'avg_price': None, 'notional_usd': notional,
            })

        total_usd = cash_usd + sum(p['notional_usd'] for p in positions)
        log.info(
            'Wallet %s…: %d positions $%.2f, cash $%.2f, total $%.2f, skipped %d dust tokens',
            wallet_address[:8], len(positions), sum(p['notional_usd'] for p in positions),
            cash_usd, total_usd, skipped,
        )

    return {
        'positions':          positions,
        'cash_usd':           cash_usd,
        'symbols_to_upsert':  symbols_to_upsert,
        'risk_rows':          risk_rows,
        'daily_bars':         daily_bars_out,
        'intraday_bars':      intraday_bars_out,
        'summary': {
            'wallet_address':   wallet_address,
            'chain_id':         chain_id,
            'chain_name':       chain_name,
            'total_usd':        total_usd,
            'positions_count':  len(positions),
            'skipped_count':    skipped,
            'native_balance':   native_balance,
            'native_symbol':    native_sym,
            'native_price_usd': native_price,
        },
    }
