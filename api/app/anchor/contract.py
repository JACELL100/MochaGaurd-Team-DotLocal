"""Minimal ABI shared by the publisher and verifier; source remains contracts/MochaAnchor.sol."""
MOCHA_ANCHOR_ABI = [
    {'type': 'function', 'name': 'anchor', 'stateMutability': 'nonpayable',
     'inputs': [{'name': 'root', 'type': 'bytes32'}, {'name': 'day', 'type': 'uint256'}, {'name': 'count', 'type': 'uint256'}],
     'outputs': []},
    {'type': 'function', 'name': 'verify', 'stateMutability': 'view',
     'inputs': [{'name': 'root', 'type': 'bytes32'}, {'name': 'leaf', 'type': 'bytes32'}, {'name': 'proof', 'type': 'bytes32[]'}],
     'outputs': [{'name': '', 'type': 'bool'}]},
    {'type': 'function', 'name': 'roots', 'stateMutability': 'view', 'inputs': [{'name': '', 'type': 'bytes32'}],
     'outputs': [{'name': '', 'type': 'bool'}]},
]
