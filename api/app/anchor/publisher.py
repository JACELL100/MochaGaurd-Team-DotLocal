"""Asynchronous persistence plus Sepolia publication.  This module is intentionally downstream."""
from __future__ import annotations

import asyncio
from datetime import date

from eth_utils import to_checksum_address, to_hex
from web3 import Web3

from .. import db
from ..config import settings
from .contract import MOCHA_ANCHOR_ABI
from .merkle import build_tree, hexes, leaf_hash, verify


class AnchorUnavailable(RuntimeError):
    pass


# Public Sepolia RPC fallbacks tried in order after the configured URL.
# rpc.sepolia.org has a history of outages; publicnode is the most reliable free option.
_SEPOLIA_FALLBACKS = [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc2.sepolia.org',
    'https://sepolia.gateway.tenderly.co',
]


def _web3() -> Web3:
    """Return a connected Web3 client for Sepolia, trying fallback RPCs on failure."""
    if not settings.chain_configured:
        raise AnchorUnavailable('Set CONTRACT_ADDRESS, ANCHOR_PRIVATE_KEY and SEPOLIA_RPC_URL first')
    # Deduplicate while preserving order (configured URL goes first).
    urls = list(dict.fromkeys([settings.sepolia_rpc_url] + _SEPOLIA_FALLBACKS))
    last_exc: Exception | None = None
    for url in urls:
        try:
            w3 = Web3(Web3.HTTPProvider(url, request_kwargs={'timeout': 10}))
            if w3.eth.chain_id == 11155111:
                return w3
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
    raise AnchorUnavailable(f'All Sepolia RPC endpoints unreachable. Last error: {last_exc}')


def _contract(w3: Web3):
    return w3.eth.contract(address=to_checksum_address(settings.contract_address), abi=MOCHA_ANCHOR_ABI)


async def anchor_day(batch_date: date, run_id: str = '') -> dict:
    decisions = await db.decisions_for_day(batch_date, run_id)
    if not decisions:
        raise ValueError(f'No decisions exist for {batch_date.isoformat()}')
    leaves = [leaf_hash(decision) for decision in decisions]
    root, paths = build_tree(leaves)
    w3 = await asyncio.to_thread(_web3)  # _web3 validates chain_id internally
    batch_id = await db.store_batch(batch_date, run_id, to_hex(root), [int(d['id']) for d in decisions],
                                    hexes(leaves), [hexes(path) for path in paths],
                                    settings.contract_address, 11155111)
    existing = await db.get_batch(batch_date, run_id)
    if existing and existing.get('tx_hash'):
        return existing
    try:
        def send() -> str:
            account = w3.eth.account.from_key(settings.anchor_private_key)
            contract = _contract(w3)
            tx = contract.functions.anchor(root, int(batch_date.strftime('%Y%m%d')), len(leaves)).build_transaction({
                'from': account.address, 'nonce': w3.eth.get_transaction_count(account.address), 'chainId': 11155111,
            })
            signed = account.sign_transaction(tx)
            raw = getattr(signed, 'raw_transaction', None) or getattr(signed, 'rawTransaction')
            tx_hash = w3.eth.send_raw_transaction(raw)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
            if receipt.status != 1:
                raise RuntimeError('Sepolia transaction reverted')
            return tx_hash.hex()
        tx_hash = await asyncio.to_thread(send)
        await db.mark_anchored(batch_id, tx_hash)
    except Exception as exc:
        await db.mark_anchor_error(batch_id, str(exc))
        raise
    return await db.get_batch(batch_date, run_id) or {}


async def verify_decision(decision_id: int) -> dict:
    decision = await db.get_decision(decision_id)
    if decision is None:
        return {'decision_id': decision_id, 'found': False, 'valid': False, 'anchored': False, 'error': 'Decision not found'}
    proof = await db.get_proof(decision_id)
    base = {'decision_id': decision_id, 'found': True, 'decision': _decision_json(decision)}
    if proof is None:
        return {**base, 'valid': False, 'anchored': False, 'leaf_hash': None, 'merkle_root': None,
                'merkle_path': [], 'tx_hash': None, 'contract_address': None, 'etherscan_url': None,
                'batch_date': None, 'anchored_at': None, 'error': None}
    path = proof['merkle_path'] or []
    local = verify(bytes.fromhex(proof['merkle_root'][2:] if proof['merkle_root'].startswith('0x') else proof['merkle_root']),
                   bytes.fromhex(proof['leaf_hash'][2:] if proof['leaf_hash'].startswith('0x') else proof['leaf_hash']),
                   [bytes.fromhex(p[2:] if p.startswith('0x') else p) for p in path])
    anchored = bool(proof.get('tx_hash'))
    valid = False
    error = proof.get('error')
    if anchored and local:
        try:
            def call() -> bool:
                w3 = _web3()
                def _b(h: str) -> bytes:
                    return bytes.fromhex(h[2:] if h.startswith('0x') else h)
                root_b = _b(proof['merkle_root'])
                leaf_b = _b(proof['leaf_hash'])
                path_b = [_b(p) for p in path]
                return bool(_contract(w3).functions.verify(root_b, leaf_b, path_b).call())
            valid = await asyncio.to_thread(call)
        except Exception as exc:
            error = f'On-chain verification unavailable: {exc}'
    elif anchored:
        error = 'Stored Merkle path does not reproduce its root'
    tx_hash = proof.get('tx_hash')
    return {**base, 'valid': valid, 'anchored': anchored, 'leaf_hash': proof['leaf_hash'],
            'merkle_root': proof['merkle_root'], 'merkle_path': path, 'tx_hash': tx_hash,
            'contract_address': proof.get('contract_address'),
            'etherscan_url': f'https://sepolia.etherscan.io/tx/{tx_hash}' if tx_hash else None,
            'batch_date': proof['batch_date'].isoformat() if proof.get('batch_date') else None,
            'anchored_at': proof['anchored_at'].isoformat() if proof.get('anchored_at') else None, 'error': error}


def _decision_json(decision: dict) -> dict:
    out = dict(decision)
    if out.get('ts'):
        out['ts'] = out['ts'].isoformat()
    out['account_id'] = str(out['account_id']) if out.get('account_id') else None
    return out
