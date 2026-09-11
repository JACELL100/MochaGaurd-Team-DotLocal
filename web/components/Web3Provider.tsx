"use client";

/**
 * Web3Provider — lightweight EVM wallet context using the standard
 * window.ethereum provider injected by MetaMask, Coinbase Wallet, Rabby, etc.
 *
 * No wagmi, no WalletConnect SDK, no heavy npm packages.
 * The EIP-1193 provider API is universally supported by every major EVM wallet.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ─── types ────────────────────────────────────────────────────────────────────

export interface WalletState {
  address: string | null;
  chainId: number | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
}

// ─── EIP-1193 chain params ────────────────────────────────────────────────────

const CHAIN_PARAMS: Record<number, { chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }> = {
  1:     { chainName: "Ethereum Mainnet",  rpcUrls: ["https://cloudflare-eth.com"],        nativeCurrency: { name: "Ether",   symbol: "ETH",  decimals: 18 }, blockExplorerUrls: ["https://etherscan.io"] },
  137:   { chainName: "Polygon",           rpcUrls: ["https://polygon-rpc.com"],           nativeCurrency: { name: "POL",     symbol: "POL",  decimals: 18 }, blockExplorerUrls: ["https://polygonscan.com"] },
  42161: { chainName: "Arbitrum One",      rpcUrls: ["https://arb1.arbitrum.io/rpc"],      nativeCurrency: { name: "Ether",   symbol: "ETH",  decimals: 18 }, blockExplorerUrls: ["https://arbiscan.io"] },
  8453:  { chainName: "Base",              rpcUrls: ["https://mainnet.base.org"],          nativeCurrency: { name: "Ether",   symbol: "ETH",  decimals: 18 }, blockExplorerUrls: ["https://basescan.org"] },
  10:    { chainName: "Optimism",          rpcUrls: ["https://mainnet.optimism.io"],       nativeCurrency: { name: "Ether",   symbol: "ETH",  decimals: 18 }, blockExplorerUrls: ["https://optimistic.etherscan.io"] },
};

// ─── context ──────────────────────────────────────────────────────────────────

const Ctx = createContext<WalletState>({
  address: null, chainId: null, connected: false,
  connecting: false, error: null,
  connect: async () => {}, disconnect: () => {}, switchChain: async () => {},
});

export function useWallet() {
  return useContext(Ctx);
}

// ─── provider ─────────────────────────────────────────────────────────────────

export function Web3Provider({ children }: { children: ReactNode }) {
  const [address,    setAddress]    = useState<string | null>(null);
  const [chainId,    setChainId]    = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Probe for an already-connected account on mount (no permission prompt).
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum as EthereumProvider;

    eth.request({ method: "eth_accounts" })
      .then((raw) => {
        const accounts = raw as string[];
        if (accounts[0]) {
          setAddress(accounts[0].toLowerCase());
          eth.request({ method: "eth_chainId" })
            .then((rawHex) => setChainId(parseInt(rawHex as string, 16)));
        }
      })
      .catch(() => {});

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts[0]?.toLowerCase() ?? null);
      if (!accounts[0]) setChainId(null);
    };
    const onChain = (...args: unknown[]) => {
      const hex = args[0] as string;
      setChainId(parseInt(hex, 16));
    };

    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged",    onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged",    onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setError("No EVM wallet detected. Please install MetaMask (metamask.io) and refresh.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const eth = window.ethereum as EthereumProvider;
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const hex      = (await eth.request({ method: "eth_chainId" })) as string;
      setAddress(accounts[0]?.toLowerCase() ?? null);
      setChainId(parseInt(hex, 16));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("rejected") ? "Connection cancelled." : msg);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  const switchChain = useCallback(async (targetChainId: number) => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum as EthereumProvider;
    const hexId = `0x${targetChainId.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (switchErr: unknown) {
      // 4902 = chain not added yet — add it
      const code = (switchErr as { code?: number }).code;
      if (code === 4902 && CHAIN_PARAMS[targetChainId]) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hexId, ...CHAIN_PARAMS[targetChainId] }],
        });
      } else {
        throw switchErr;
      }
    }
    setChainId(targetChainId);
  }, []);

  return (
    <Ctx.Provider value={{
      address, chainId, connected: !!address,
      connecting, error, connect, disconnect, switchChain,
    }}>
      {children}
    </Ctx.Provider>
  );
}

// ─── minimal EIP-1193 type ────────────────────────────────────────────────────

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?:             (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
