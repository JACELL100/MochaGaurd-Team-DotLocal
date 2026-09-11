// Client-side helpers for the wallet integration API routes.
// Called from "use client" components only.

export interface WalletConnection {
  wallet_address: string;
  chain_id: number;
  chain_name: string;
  label: string | null;
  connected_at: string;
  last_synced: string | null;
}

export interface WalletSyncResult {
  account_id: string;
  wallet_address: string;
  chain_id: number;
  chain_name: string;
  total_usd: number;
  positions_count: number;
  skipped_count: number;
  native_balance: number;
  native_symbol: string;
  native_price_usd: number;
  positions_synced: number;
}

export const SUPPORTED_CHAINS: Record<number, string> = {
  1: "Ethereum",
  137: "Polygon",
  42161: "Arbitrum One",
  8453: "Base",
  10: "Optimism",
};

export async function syncWallet(
  wallet_address: string,
  chain_id: number,
): Promise<WalletSyncResult> {
  const res = await fetch("/api/wallet/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet_address, chain_id }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getConnections(): Promise<WalletConnection[]> {
  const res = await fetch("/api/wallet/connections");
  if (!res.ok) throw new Error("Failed to load wallet connections");
  return res.json();
}

export async function removeConnection(
  wallet_address: string,
  chain_id: number,
): Promise<void> {
  const res = await fetch("/api/wallet/disconnect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet_address, chain_id }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status}`);
  }
}
