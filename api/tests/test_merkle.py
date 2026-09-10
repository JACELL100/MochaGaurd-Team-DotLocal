from datetime import datetime, timezone

from app.anchor.merkle import build_tree, leaf_hash, verify


def decision(identifier: int) -> dict:
    return {
        'id': identifier, 'ts': datetime(2026, 9, 3, 15, 45, tzinfo=timezone.utc), 'account_id': f'account-{identifier}',
        'symbol': 'NVDA', 'action': 'reduce', 'max_leverage': 4.0, 'equity': 12_000.0,
        'margin_required': 11_500.0, 'qty_to_reduce': 10.0, 'reason': 'real engine decision',
    }


def test_sorted_pair_merkle_proofs_verify_and_detect_changes():
    leaves = [leaf_hash(decision(i)) for i in range(1, 4)]
    root, paths = build_tree(leaves)
    assert all(verify(root, leaf, path) for leaf, path in zip(leaves, paths))
    assert not verify(root, leaf_hash({**decision(1), 'qty_to_reduce': 11.0}), paths[0])
