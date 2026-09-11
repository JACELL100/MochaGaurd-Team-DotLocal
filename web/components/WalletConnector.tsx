"use client";

/**
 * WalletConnector
 *
 * Step 1 — "Connect Wallet": uses the raw EIP-1193 window.ethereum API
 *   (MetaMask, Coinbase Wallet, Rabby, Frame, etc.) via our Web3Provider context.
 *   No wagmi, no WalletConnect SDK required.
 *
 * Step 2 — "Sync Portfolio": POSTs the address + chainId to the Next.js API route
 *   which proxies to FastAPI → Alchemy (balances) → CoinGecko (prices/volatility)
 *   → risk engine → Tonight dashboard.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/Web3Provider";
import {
  SUPPORTED_CHAINS,
  getConnections,
  removeConnection,
  syncWallet,
} from "@/lib/wallet";
import type { WalletConnection, WalletSyncResult } from "@/lib/wallet";

// ─── helpers ─────────────────────────────────────────────────────────────────

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function usd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 2,
  }).format(n);
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ConnectionRow({
  conn,
  onRemove,
}: {
  conn: WalletConnection;
  onRemove: (address: string, chainId: number) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try { await onRemove(conn.wallet_address, conn.chain_id); }
    finally { setRemoving(false); }
  }

  const synced = conn.last_synced
    ? new Date(conn.last_synced).toLocaleString()
    : "Never";

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#231F42] bg-[#0B0A14]/60 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="size-2 rounded-full bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
          <span className="font-mono text-sm text-white">{truncate(conn.wallet_address)}</span>
          <span className="rounded bg-[#7C3AED]/20 px-1.5 py-0.5 text-[10px] text-[#C4B5FD] border border-[#7C3AED]/30">
            {conn.chain_name}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-[#64748B]">Last synced: {synced}</p>
      </div>
      <button
        type="button"
        onClick={handleRemove}
        disabled={removing}
        className="shrink-0 rounded-lg border border-[#3F1F1F] bg-[#1A0A0A] px-3 py-1.5 text-xs text-[#FDA4AF] transition hover:bg-[#2A0F0F] disabled:opacity-50"
      >
        {removing ? "Removing…" : "Disconnect"}
      </button>
    </div>
  );
}

function SyncResult({ result }: { result: WalletSyncResult }) {
  return (
    <div className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-[#22C55E] font-semibold text-sm">
        <span>✓</span>
        <span>Portfolio synced — risk engine updated</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-[#94A3B8]">
        <span>Total portfolio value</span>
        <span className="text-white font-mono">{usd(result.total_usd)}</span>

        <span>Positions loaded</span>
        <span className="text-white font-mono">{result.positions_synced}</span>

        <span>Native balance</span>
        <span className="text-white font-mono">
          {result.native_balance.toFixed(5)} {result.native_symbol}
          {result.native_price_usd > 0 && (
            <span className="ml-1 text-[#64748B]">
              ({usd(result.native_balance * result.native_price_usd)})
            </span>
          )}
        </span>

        {result.skipped_count > 0 && (
          <>
            <span>Dust skipped</span>
            <span className="text-[#64748B] font-mono">
              {result.skipped_count} token{result.skipped_count !== 1 ? "s" : ""} &lt; $10
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function ChainSelector({
  currentChain,
  onSwitch,
}: {
  currentChain: number;
  onSwitch: (id: number) => Promise<void>;
}) {
  const [switching, setSwitching] = useState(false);

  async function handle(id: number) {
    setSwitching(true);
    try { await onSwitch(id); }
    catch { /* wallet rejected — ignore */ }
    finally { setSwitching(false); }
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-[11px] text-[#94A3B8]">Switch network:</p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(SUPPORTED_CHAINS).map(([id, name]) => {
          const cid = Number(id);
          const active = cid === currentChain;
          return (
            <button
              key={id}
              type="button"
              disabled={active || switching}
              onClick={() => handle(cid)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition ${
                active
                  ? "border-[#7C3AED]/60 bg-[#7C3AED]/20 text-[#C4B5FD]"
                  : "border-[#231F42] bg-[#0B0A14] text-[#94A3B8] hover:border-[#7C3AED]/40 hover:text-white"
              } disabled:opacity-60`}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function WalletConnector() {
  const { address, chainId, connected, connecting, error: walletError, connect, disconnect, switchChain } = useWallet();
  const router = useRouter();

  const [connections,   setConnections]   = useState<WalletConnection[]>([]);
  const [syncing,       setSyncing]       = useState(false);
  const [syncResult,    setSyncResult]    = useState<WalletSyncResult | null>(null);
  const [syncError,     setSyncError]     = useState<string | null>(null);
  const [loadingConns,  setLoadingConns]  = useState(true);

  const chainSupported = chainId !== null && chainId in SUPPORTED_CHAINS;
  const chainName = chainId ? (SUPPORTED_CHAINS[chainId] ?? `Chain ${chainId}`) : null;

  // Load existing connections on mount and after every successful sync.
  useEffect(() => {
    setLoadingConns(true);
    getConnections()
      .then(setConnections)
      .catch(() => setConnections([]))
      .finally(() => setLoadingConns(false));
  }, [syncResult]);

  async function handleSync() {
    if (!address || !chainId) return;
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const result = await syncWallet(address, chainId);
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed — please try again.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRemove(walletAddress: string, walletChainId: number) {
    await removeConnection(walletAddress, walletChainId);
    setConnections((prev) =>
      prev.filter(
        (c) => !(c.wallet_address === walletAddress && c.chain_id === walletChainId)
      )
    );
    setSyncResult(null);
  }

  return (
    <div className="space-y-5">

      {/* ── Step 1: Connect wallet ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-[#231F42] bg-[#0B0A14]/60 p-5">
        <h2 className="mb-1 text-sm font-semibold text-white">1. Connect your wallet</h2>
        <p className="mb-4 text-xs text-[#94A3B8] leading-relaxed">
          Works with MetaMask, Coinbase Wallet, Rabby, Frame, and any EVM wallet that
          injects <code className="rounded bg-[#1C1836] px-1 py-0.5 font-mono text-[11px]">window.ethereum</code>.
          Your private keys never leave your device.
        </p>

        {!connected ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={connect}
              disabled={connecting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Spinner />
                  Connecting…
                </>
              ) : (
                <>
                  <WalletIcon />
                  Connect Wallet
                </>
              )}
            </button>
            {walletError && (
              <div className="rounded-lg border border-[#FBBF24]/30 bg-[#FBBF24]/5 px-4 py-3 text-xs text-[#FBBF24]">
                {walletError}
                {walletError.includes("MetaMask") && (
                  <a
                    href="https://metamask.io/download/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 underline"
                  >
                    Download MetaMask →
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Connected address strip */}
            <div className="flex items-center gap-3 rounded-lg border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-4 py-3">
              <div className="size-2 shrink-0 rounded-full bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm text-white">{truncate(address!)}</div>
                <div className="mt-0.5 text-[11px] text-[#94A3B8]">
                  {chainName ?? "Unknown network"}
                  {!chainSupported && (
                    <span className="ml-2 text-[#FBBF24]">
                      ⚠ Unsupported chain — switch below
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={disconnect}
                className="shrink-0 rounded-lg border border-[#231F42] px-3 py-1.5 text-xs text-[#94A3B8] transition hover:text-white"
              >
                Disconnect
              </button>
            </div>

            {/* Chain switcher — only shown when on an unsupported chain */}
            {!chainSupported && chainId !== null && (
              <ChainSelector currentChain={chainId} onSwitch={switchChain} />
            )}
          </div>
        )}
      </section>

      {/* ── Step 2: Sync portfolio ─────────────────────────────────────────── */}
      {connected && chainSupported && (
        <section className="rounded-xl border border-[#231F42] bg-[#0B0A14]/60 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">2. Sync your portfolio</h2>
          <p className="mb-4 text-xs text-[#94A3B8] leading-relaxed">
            Reads your token balances on-chain via Alchemy, prices them with CoinGecko,
            computes overnight gap and intraday risk, and feeds the positions into the
            MochaGuard risk engine. Takes 20–60 s depending on how many tokens you hold.
          </p>

          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {syncing ? (
              <>
                <Spinner />
                Fetching on-chain data…
              </>
            ) : (
              "Sync Portfolio to MochaGuard"
            )}
          </button>

          {syncing && (
            <p className="mt-3 text-xs text-[#64748B]">
              Alchemy → token balances · CoinGecko → prices & OHLCV · risk engine → leverages &amp; margins…
            </p>
          )}

          {syncError && (
            <div className="mt-4 rounded-lg border border-[#FDA4AF]/30 bg-[#FDA4AF]/5 px-4 py-3 text-sm text-[#FDA4AF]">
              {syncError}
            </div>
          )}

          {syncResult && (
            <div className="mt-4 space-y-4">
              <SyncResult result={syncResult} />
              <button
                type="button"
                onClick={() => router.push("/tonight")}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#7C3AED]/40 bg-[#7C3AED]/10 px-5 py-2.5 text-sm font-semibold text-[#C4B5FD] transition hover:bg-[#7C3AED]/20"
              >
                View my overnight risk briefing →
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Connected wallets list ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-[#231F42] bg-[#0B0A14]/60 p-5">
        <h2 className="mb-1 text-sm font-semibold text-white">Connected wallets</h2>
        <p className="mb-4 text-xs text-[#94A3B8]">
          Each sync replaces your portfolio positions with fresh on-chain data.
        </p>

        {loadingConns ? (
          <p className="text-xs text-[#64748B]">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="text-xs text-[#64748B]">No wallets synced yet.</p>
        ) : (
          <div className="space-y-2">
            {connections.map((c) => (
              <ConnectionRow
                key={`${c.wallet_address}-${c.chain_id}`}
                conn={c}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Info strip ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#1C1836] bg-[#0B0A14]/30 px-4 py-3 text-[11px] text-[#64748B] space-y-1">
        <p>
          <span className="text-[#94A3B8]">Supported chains:</span>{" "}
          Ethereum · Polygon · Arbitrum One · Base · Optimism
        </p>
        <p>
          <span className="text-[#94A3B8]">Stablecoins</span> (USDC, USDT, DAI…) are counted as cash, not risk positions.
        </p>
        <p>
          <span className="text-[#94A3B8]">Dust</span> (tokens worth &lt; $10) is automatically excluded.
        </p>
        <p>
          Your wallet address is used for read-only balance lookups only.
          MochaGuard never requests signing permissions.
        </p>
      </div>
    </div>
  );
}

// ─── tiny inline icons (no extra deps) ───────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin size-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}
