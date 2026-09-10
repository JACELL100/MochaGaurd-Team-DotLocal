"""Compile and deploy contracts/MochaAnchor.sol to Sepolia using the configured testnet wallet."""
from __future__ import annotations

import sys
from pathlib import Path

from eth_utils import to_checksum_address
from solcx import compile_standard, install_solc
from web3 import Web3

PROJECT_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.config import settings  # noqa: E402


def main() -> None:
    if not settings.anchor_private_key:
        raise SystemExit('ANCHOR_PRIVATE_KEY is required. Use a funded Sepolia-only wallet; never use a mainnet key.')
    source_path = PROJECT_ROOT / 'contracts' / 'MochaAnchor.sol'
    if not source_path.exists():
        raise SystemExit(f'Contract source not found: {source_path}')
    install_solc('0.8.24')
    compiled = compile_standard({
        'language': 'Solidity',
        'sources': {'MochaAnchor.sol': {'content': source_path.read_text(encoding='utf-8')}},
        'settings': {'outputSelection': {'*': {'*': ['abi', 'evm.bytecode.object']}}},
    }, solc_version='0.8.24')
    artifact = compiled['contracts']['MochaAnchor.sol']['MochaAnchor']
    w3 = Web3(Web3.HTTPProvider(settings.sepolia_rpc_url, request_kwargs={'timeout': 30}))
    if not w3.is_connected():
        raise SystemExit('Cannot reach SEPOLIA_RPC_URL')
    if w3.eth.chain_id != 11155111:
        raise SystemExit(f'RPC is chain {w3.eth.chain_id}; expected Sepolia (11155111)')
    account = w3.eth.account.from_key(settings.anchor_private_key)
    if w3.eth.get_balance(account.address) == 0:
        raise SystemExit(f'{account.address} has no Sepolia ETH. Fund it and rerun this command.')
    contract = w3.eth.contract(abi=artifact['abi'], bytecode=artifact['evm']['bytecode']['object'])
    transaction = contract.constructor().build_transaction({
        'from': account.address, 'nonce': w3.eth.get_transaction_count(account.address), 'chainId': 11155111,
    })
    signed = account.sign_transaction(transaction)
    raw = getattr(signed, 'raw_transaction', None) or getattr(signed, 'rawTransaction')
    tx_hash = w3.eth.send_raw_transaction(raw)
    print(f'Deployment sent: https://sepolia.etherscan.io/tx/{tx_hash.hex()}')
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=240)
    if receipt.status != 1:
        raise SystemExit('Deployment transaction reverted')
    address = to_checksum_address(receipt.contractAddress)
    print(f'CONTRACT_ADDRESS={address}')
    print(f'Contract: https://sepolia.etherscan.io/address/{address}')
    print('Copy CONTRACT_ADDRESS into api/.env and restart the API.')


if __name__ == '__main__':
    main()
