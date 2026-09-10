"""Deterministic sorted-pair Keccak Merkle trees for risk-decision commitments."""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from eth_utils import keccak, to_hex


def _number(value: object) -> str:
    return '' if value is None else format(float(value), '.12g')


def _timestamp(value: object) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or '')


def leaf_hash(decision: dict) -> bytes:
    """Hash exactly the immutable, non-PII decision facts stored in Postgres."""
    payload = '|'.join((
        str(decision['id']), _timestamp(decision.get('ts')), str(decision.get('account_id') or ''),
        str(decision.get('symbol') or ''), str(decision.get('action') or ''),
        _number(decision.get('max_leverage')), _number(decision.get('equity')),
        _number(decision.get('margin_required')), _number(decision.get('qty_to_reduce')),
        str(decision.get('reason') or ''),
    ))
    return keccak(text=payload)


def _pair(left: bytes, right: bytes) -> bytes:
    return keccak(left + right) if left <= right else keccak(right + left)


def build_tree(leaves: Iterable[bytes]) -> tuple[bytes, list[list[bytes]]]:
    values = list(leaves)
    if not values:
        raise ValueError('cannot anchor an empty decision set')
    proofs: list[list[bytes]] = [[] for _ in values]
    nodes = [(value, [index]) for index, value in enumerate(values)]
    while len(nodes) > 1:
        next_nodes: list[tuple[bytes, list[int]]] = []
        for i in range(0, len(nodes), 2):
            if i + 1 == len(nodes):
                next_nodes.append(nodes[i])
                continue
            left, right = nodes[i], nodes[i + 1]
            for index in left[1]:
                proofs[index].append(right[0])
            for index in right[1]:
                proofs[index].append(left[0])
            next_nodes.append((_pair(left[0], right[0]), left[1] + right[1]))
        nodes = next_nodes
    return nodes[0][0], proofs


def verify(root: bytes, leaf: bytes, proof: Iterable[bytes]) -> bool:
    value = leaf
    for sibling in proof:
        value = _pair(value, sibling)
    return value == root


def hexes(values: Iterable[bytes]) -> list[str]:
    return [to_hex(value) for value in values]
