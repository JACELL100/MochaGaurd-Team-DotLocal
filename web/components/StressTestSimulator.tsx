"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Flame,
  Zap,
  RotateCcw,
  Clock,
  ArrowDownRight,
  TrendingDown,
  TrendingUp,
  Skull,
  Layers,
  ChevronRight,
  Info,
  Plus,
  Trash2,
  Edit3,
  X,
  Check,
  DollarSign,
  History,
  Sparkles,
  Shield,
  Activity,
  Compass
} from "lucide-react";
import type { AccountSummary, AccountView, PositionRow } from "@/lib/types";
import { money, pct, shares, lev } from "@/lib/format";
import { GlowingCard } from "@/components/ui/GlowingCard";

interface StressTestSimulatorProps {
  accounts: AccountSummary[];
  selectedAccount: AccountView;
  allPortfolios?: Record<string, AccountView>;
}

export interface CrisisScenario {
  id: string;
  label: string;
  sublabel: string;
  date: string;
  gap: number; // e.g. -0.184 for -18.4%
  icon: React.ComponentType<{ className?: string }>;
  tone: "safe" | "warn" | "danger" | "critical";
  headline: string;
  historicalContext: string;
  vixSpike: string;
  liquidityDrain: string;
  hedgeRecommendation: string;
}

export const CRISIS_SCENARIOS: CrisisScenario[] = [
  {
    id: "deepseek-2025",
    label: "DeepSeek AI Shock",
    sublabel: "Jan 27, 2025",
    date: "Jan 27, 2025",
    gap: -0.184,
    icon: Flame,
    tone: "critical",
    headline: "DeepSeek R1 Open-Source Shock Sparks $590B Semiconductor Rout",
    historicalContext: "NVIDIA plummeted 17% in a single session alongside Broadcom (-14%) as the market repriced hyper-scaler capex efficiency. Unlevered accounts survived, but 4x+ margin accounts faced immediate liquidations.",
    vixSpike: "+38.4% (VIX 24.8)",
    liquidityDrain: "Overnight bid-ask spreads widened 4.2x on mega-cap tech perps.",
    hedgeRecommendation: "Auto-Collar: Short 15% QQQ delta or buy 1-week 15% OTM Puts before 15:45 close.",
  },
  {
    id: "nikkei-2024",
    label: "Nikkei Black Monday",
    sublabel: "Aug 5, 2024",
    date: "Aug 5, 2024",
    gap: -0.124,
    icon: TrendingDown,
    tone: "critical",
    headline: "BOJ Rate Hike Collapses Global Yen Carry Trade (-12.4% Overnight)",
    historicalContext: "The Nikkei suffered its steepest crash since Black Monday 1987. Cross-asset margin calls forced instantaneous global liquidations across Nasdaq, Crypto, and US equities before the New York open.",
    vixSpike: "+181% (VIX hit 65.7 intraday)",
    liquidityDrain: "Global multi-broker margin call queue backed up 45 minutes.",
    hedgeRecommendation: "Cash Buffer: Deposit 22% cash margin or eliminate cross-currency leverage.",
  },
  {
    id: "svb-2023",
    label: "SVB Banking Run",
    sublabel: "Mar 10, 2023",
    date: "Mar 10, 2023",
    gap: -0.065,
    icon: Zap,
    tone: "danger",
    headline: "FDIC Shuts Silicon Valley Bank Following $42B Deposit Outflow",
    historicalContext: "Contagion rapidly halted trading across mid-tier bank stocks. High-duration tech exposures suffered liquidity paralysis, triggering risk-off de-risking across growth equity.",
    vixSpike: "+26.5% (VIX 26.5)",
    liquidityDrain: "Prime brokers halted margin lending on regional banking collateral.",
    hedgeRecommendation: "Collateral Rotation: Move speculative collateral into short-dated Treasuries (BIL/SGOV).",
  },
  {
    id: "covid-2020",
    label: "COVID Limit Down",
    sublabel: "Mar 16, 2020",
    date: "Mar 16, 2020",
    gap: -0.120,
    icon: Skull,
    tone: "critical",
    headline: "S&P 500 Halts on Opening Circuit Breaker; VIX Reaches Record 82.7",
    historicalContext: "Overnight futures locked limit-down (-5%) hours before cash open. Cash open immediately triggered the 7% NYSE Level 1 halt. Brokers faced historic bad-debt shortfalls on retail accounts.",
    vixSpike: "VIX 82.69 (All-time high territory)",
    liquidityDrain: "Bid books emptied; institutional market makers pulled secondary quotes.",
    hedgeRecommendation: "Emergency De-Risk: Reduce gross leverage to <1.2x prior to 15:45 cutoff.",
  },
  {
    id: "nvda-earnings-2023",
    label: "NVDA Blowout Gap Up",
    sublabel: "May 25, 2023",
    date: "May 25, 2023",
    gap: 0.244,
    icon: TrendingUp,
    tone: "safe",
    headline: "NVIDIA Shocks Wall Street With 50% Revenue Guidance Beat (+24.4% Gap)",
    historicalContext: "Historic overnight short-squeeze as NVIDIA gained $184B in market cap before breakfast. Short sellers and delta-neutral perp traders suffered catastrophic margin calls.",
    vixSpike: "-14.2% Volatility Crush",
    liquidityDrain: "Perpetual short funding spiked to extreme negative borrowing fees.",
    hedgeRecommendation: "Asymmetric Upside: Maintain capped upside collars without unlimited short delta.",
  },
];

const POPULAR_STOCKS = [
  { symbol: "NVDA", name: "NVIDIA Corp", price: 174.25, maxLev: 4.5, defaultAdverse: 0.064 },
  { symbol: "TSLA", name: "Tesla Inc", price: 242.80, maxLev: 3.7, defaultAdverse: 0.080 },
  { symbol: "AAPL", name: "Apple Inc", price: 228.50, maxLev: 7.1, defaultAdverse: 0.041 },
  { symbol: "MSFT", name: "Microsoft Corp", price: 448.20, maxLev: 6.9, defaultAdverse: 0.042 },
  { symbol: "AMZN", name: "Amazon.com Inc", price: 198.60, maxLev: 6.2, defaultAdverse: 0.045 },
  { symbol: "META", name: "Meta Platforms", price: 585.30, maxLev: 5.8, defaultAdverse: 0.052 },
  { symbol: "GOOGL", name: "Alphabet Inc", price: 182.40, maxLev: 7.0, defaultAdverse: 0.039 },
  { symbol: "AMD", name: "Advanced Micro Devices", price: 155.40, maxLev: 4.8, defaultAdverse: 0.058 },
  { symbol: "COIN", name: "Coinbase Global", price: 215.10, maxLev: 3.2, defaultAdverse: 0.095 },
  { symbol: "MSTR", name: "MicroStrategy", price: 340.50, maxLev: 2.8, defaultAdverse: 0.110 },
  { symbol: "PLTR", name: "Palantir Tech", price: 62.40, maxLev: 4.1, defaultAdverse: 0.075 },
  { symbol: "SPY", name: "S&P 500 ETF", price: 598.75, maxLev: 12.0, defaultAdverse: 0.024 },
  { symbol: "QQQ", name: "Invesco QQQ Trust", price: 512.30, maxLev: 10.5, defaultAdverse: 0.028 },
];

export function StressTestSimulator({
  accounts,
  selectedAccount: initialAccount,
  allPortfolios = {},
}: StressTestSimulatorProps) {
  // Shock slider: from -35% (-0.35) to +10% (+0.10)
  const [gapPct, setGapPct] = useState<number>(-0.184); // default to DeepSeek Shock (-18.4%)
  const [selectedCrisis, setSelectedCrisis] = useState<CrisisScenario | null>(CRISIS_SCENARIOS[0]);
  const [armorDeployed, setArmorDeployed] = useState(false);
  const [selectedAccountModal, setSelectedAccountModal] = useState(false);
  const [currentAccount, setCurrentAccount] = useState<AccountView>(initialAccount);

  // Dynamic custom positions & user equity for live editing
  const [positions, setPositions] = useState<PositionRow[]>(initialAccount.positions || []);
  const [equity, setEquity] = useState<number>(initialAccount.equity);
  const [isEditingEquity, setIsEditingEquity] = useState(false);
  const [equityInput, setEquityInput] = useState(String(initialAccount.equity));

  // Modal to add a new stock
  const [showAddStockModal, setShowAddStockModal] = useState(false);
  const [selectedStockTicker, setSelectedStockTicker] = useState("NVDA");
  const [customShares, setCustomShares] = useState("50");
  const [customPrice, setCustomPrice] = useState("174.25");
  const [customEarnings, setCustomEarnings] = useState(false);
  const [customLev, setCustomLev] = useState("4.5");

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Sync state if initialAccount changes from SSR
  useEffect(() => {
    setCurrentAccount(initialAccount);
    setPositions(initialAccount.positions || []);
    setEquity(initialAccount.equity);
    setEquityInput(String(initialAccount.equity));
  }, [initialAccount]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setSelectedAccountModal(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle switching account
  const handleSwitchAccount = (acctId: string) => {
    setSelectedAccountModal(false);
    const found = allPortfolios[acctId];
    if (found) {
      setCurrentAccount(found);
      setPositions(found.positions || []);
      setEquity(found.equity);
      setEquityInput(String(found.equity));
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("account", acctId);
        window.history.pushState({}, "", url.toString());
      }
    } else {
      if (typeof window !== "undefined") {
        window.location.href = `/stress-test?account=${encodeURIComponent(acctId)}`;
      }
    }
  };

  // Pre-fill stock details when user selects from dropdown
  const handleSelectTicker = (ticker: string) => {
    setSelectedStockTicker(ticker);
    const info = POPULAR_STOCKS.find((s) => s.symbol === ticker);
    if (info) {
      setCustomPrice(String(info.price));
      setCustomLev(String(info.maxLev));
    }
  };

  // Add stock to current portfolio
  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(customShares);
    const price = parseFloat(customPrice);
    const maxLev = parseFloat(customLev);

    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) return;

    const notional = qty * price;
    const info = POPULAR_STOCKS.find((s) => s.symbol === selectedStockTicker);
    const adverse = info?.defaultAdverse ?? 0.05;

    const existingIndex = positions.findIndex((p) => p.symbol === selectedStockTicker);
    if (existingIndex >= 0) {
      const updated = [...positions];
      const prev = updated[existingIndex];
      const newQty = prev.qty + qty;
      updated[existingIndex] = {
        ...prev,
        qty: newQty,
        price,
        notional: newQty * price,
        earnings_tonight: customEarnings,
        max_leverage: maxLev,
      };
      setPositions(updated);
    } else {
      const newPos: PositionRow = {
        symbol: selectedStockTicker,
        qty,
        price,
        notional,
        max_leverage: maxLev,
        adverse_move: adverse,
        earnings_tonight: customEarnings,
        frozen: false,
      };
      setPositions([newPos, ...positions]);
    }

    setShowAddStockModal(false);
  };

  // Remove stock from portfolio
  const handleRemoveStock = (symbol: string) => {
    setPositions(positions.filter((p) => p.symbol !== symbol));
  };

  // Reset to original account portfolio
  const handleResetPortfolio = () => {
    setPositions(currentAccount.positions || []);
    setEquity(currentAccount.equity);
    setEquityInput(String(currentAccount.equity));
    setGapPct(-0.08);
    setArmorDeployed(false);
    setSelectedCrisis(null);
  };

  // 1-Click Margin Armor Collar Hedge Deployment
  const handleDeployArmor = () => {
    if (armorDeployed) return;
    const targetHedgeNotional = Math.round(liveGrossExposure * 0.40);
    const sqqqPrice = 28.50;
    const hedgeShares = Math.max(10, Math.round(targetHedgeNotional / sqqqPrice));

    const hedgePos: PositionRow = {
      symbol: "SQQQ (Margin Armor)",
      qty: hedgeShares,
      price: sqqqPrice,
      notional: hedgeShares * sqqqPrice,
      max_leverage: 10.0,
      adverse_move: 0.02,
      earnings_tonight: false,
      frozen: false,
    };

    setPositions([hedgePos, ...positions]);
    setArmorDeployed(true);
  };

  // Save edited equity
  const handleSaveEquity = () => {
    const val = parseFloat(equityInput);
    if (!isNaN(val) && val > 0) {
      setEquity(val);
    }
    setIsEditingEquity(false);
  };

  // Calculate live portfolio baseline
  const liveGrossExposure = useMemo(() => {
    return positions.reduce((sum, p) => sum + p.qty * p.price, 0);
  }, [positions]);

  const liveLeverage = useMemo(() => {
    return equity > 0 ? liveGrossExposure / equity : 0;
  }, [liveGrossExposure, equity]);

  // Math simulation for each position under the overnight gap
  const sim = useMemo(() => {
    let totalLoss = 0;
    let newGross = 0;
    let marginRequired = 0;

    const simulatedPositions = positions.map((p: PositionRow) => {
      // If position has earnings tonight, gap volatility is amplified by 1.4x
      const effectiveGap = p.earnings_tonight && gapPct < 0 ? gapPct * 1.4 : gapPct;
      const initialNotional = p.qty * p.price;
      const newNotional = Math.max(0, initialNotional * (1 + effectiveGap));
      const posLoss = newNotional - initialNotional;
      totalLoss += posLoss;
      newGross += newNotional;

      // Leverage rule for margin requirement
      const effectiveLev = Math.max(1, p.max_leverage || 4.5);
      const posMarginReq = newNotional / effectiveLev;
      marginRequired += posMarginReq;

      return {
        ...p,
        effectiveGap,
        initialNotional,
        newNotional,
        posLoss,
        effectiveLev,
        posMarginReq,
      };
    });

    // In a leveraged portfolio, equity drops dollar-for-dollar with market loss!
    const newEquity = equity + totalLoss;
    const isNegativeEquity = newEquity < 0;
    const brokerLoss = isNegativeEquity ? Math.abs(newEquity) : 0;
    const buffer = newEquity - marginRequired;
    const marginRatio = marginRequired > 0 ? (newEquity > 0 ? newEquity / marginRequired : 0) : 1.0;

    // Liquidation calculations (worst-margin / most levered first)
    const marginDeficit = Math.max(0, marginRequired - newEquity);
    let cumulativeRelief = 0;
    const liquidationPlan: Array<{
      symbol: string;
      sharesToSell: number;
      notionalSold: number;
      slippageBps: number;
      slippageCost: number;
      urgency: "mandatory" | "advisory" | "none";
    }> = [];

    if (newEquity <= 0) {
      // Insolvent: full liquidation forced
      for (const pos of simulatedPositions) {
        const newPrice = pos.price * (1 + pos.effectiveGap);
        const slippageBps = 150;
        const slippageCost = pos.newNotional * 0.015;
        liquidationPlan.push({
          symbol: pos.symbol,
          sharesToSell: Math.ceil(pos.qty),
          notionalSold: pos.newNotional,
          slippageBps,
          slippageCost,
          urgency: "mandatory",
        });
      }
    } else if (marginDeficit > 0) {
      // Sort positions by leverage descending (derisk highest leverage first)
      const sorted = [...simulatedPositions].sort((a, b) => b.effectiveLev - a.effectiveLev);

      for (const pos of sorted) {
        if (cumulativeRelief >= marginDeficit) {
          liquidationPlan.push({
            symbol: pos.symbol,
            sharesToSell: 0,
            notionalSold: 0,
            slippageBps: 0,
            slippageCost: 0,
            urgency: "none",
          });
          continue;
        }

        const remainingDeficit = marginDeficit - cumulativeRelief;
        const reliefPerDollar = 1 - 1 / pos.effectiveLev;
        const dollarNeeded = reliefPerDollar > 0 ? remainingDeficit / reliefPerDollar : remainingDeficit;
        const dollarToSell = Math.min(pos.newNotional, dollarNeeded);
        const newPrice = pos.price * (1 + pos.effectiveGap);
        const sharesToSell = newPrice > 0 ? Math.ceil(dollarToSell / newPrice) : 0;

        // Slippage formula: 10bps + 0.10 * sqrt(participation)
        const slippageBps = Math.min(180, Math.round(10 + 25 * Math.sqrt(dollarToSell / 50_000)));
        const slippageCost = dollarToSell * (slippageBps / 10_000);

        cumulativeRelief += dollarToSell * reliefPerDollar;

        liquidationPlan.push({
          symbol: pos.symbol,
          sharesToSell,
          notionalSold: dollarToSell,
          slippageBps,
          slippageCost,
          urgency: dollarToSell > 0 ? (marginRatio < 0.7 ? "mandatory" : "advisory") : "none",
        });
      }
    }

    const totalSharesSold = liquidationPlan.reduce((acc, cur) => acc + cur.sharesToSell, 0);
    const totalSlippage = liquidationPlan.reduce((acc, cur) => acc + cur.slippageCost, 0);

    return {
      totalLoss,
      newEquity,
      newGross,
      marginRequired,
      marginRatio,
      buffer,
      isNegativeEquity,
      brokerLoss,
      marginDeficit,
      liquidationPlan,
      totalSharesSold,
      totalSlippage,
      positions: simulatedPositions,
    };
  }, [gapPct, equity, positions]);

  // Determine threat level
  const threatLevel = useMemo(() => {
    if (sim.isNegativeEquity)
      return {
        label: `INSOLVENT (BROKER SHORTFALL: ${money(sim.brokerLoss)})`,
        color: "text-[#EF4444]",
        bg: "bg-[#EF4444]/20",
        border: "border-[#EF4444]/60",
        tone: "critical",
      };
    if (sim.marginRatio < 0.7)
      return {
        label: `CRITICAL 15:45 DE-RISK (SELL ${shares(sim.totalSharesSold)} SHARES)`,
        color: "text-[#F87171]",
        bg: "bg-[#F87171]/20",
        border: "border-[#F87171]/50",
        tone: "danger",
      };
    if (sim.marginRatio < 1.0)
      return {
        label: `ACTION REQUIRED (MARGIN DEFICIT: ${money(sim.marginDeficit)})`,
        color: "text-[#FBBF24]",
        bg: "bg-[#FBBF24]/20",
        border: "border-[#FBBF24]/50",
        tone: "warn",
      };
    return {
      label: "PORTFOLIO HEALTHY (SAFE TO SLEEP)",
      color: "text-[#34D399]",
      bg: "bg-[#10B981]/20",
      border: "border-[#10B981]/50",
      tone: "safe",
    };
  }, [sim]);

  return (
    <div className="space-y-8 relative">
      {/* Top Header Card & Account Switcher (Z-INDEX 60 so dropdown floats cleanly on top) */}
      <div className="relative z-[60] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#7C3AED]/20 border border-[#7C3AED]/40 text-[#A78BFA]">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-white">
                {currentAccount.display_name || currentAccount.account_id}
              </h2>
              <span className="rounded-full bg-[#1E1B4B] px-2.5 py-0.5 text-[10px] font-mono font-medium text-[#A78BFA] border border-[#7C3AED]/30">
                {currentAccount.tz}
              </span>
            </div>
            <div className="text-xs text-[#94A3B8] mt-1 flex flex-wrap items-center gap-3">
              {/* Editable Equity */}
              <div className="flex items-center gap-1.5">
                <span>Account Equity:</span>
                {isEditingEquity ? (
                  <div className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      value={equityInput}
                      onChange={(e) => setEquityInput(e.target.value)}
                      className="w-28 rounded bg-[#181530] border border-[#7C3AED] px-1.5 py-0.5 text-xs text-white font-mono"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveEquity}
                      className="p-1 rounded bg-[#10B981]/20 text-[#34D399] hover:bg-[#10B981]/40"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingEquity(false)}
                      className="p-1 rounded bg-[#EF4444]/20 text-[#EF4444] hover:bg-[#EF4444]/40"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingEquity(true)}
                    className="group inline-flex items-center gap-1 text-white font-mono font-semibold hover:text-[#A78BFA] transition-colors"
                    title="Click to edit account starting equity"
                  >
                    <span>{money(equity)}</span>
                    <Edit3 className="w-3 h-3 text-[#64748B] group-hover:text-[#A78BFA]" />
                  </button>
                )}
              </div>
              <span>·</span>
              <span>
                Gross: <span className="text-white font-mono font-semibold">{money(liveGrossExposure)}</span>
              </span>
              <span>·</span>
              <span>
                Leverage:{" "}
                <span
                  className={`font-mono font-semibold ${
                    liveLeverage >= 4.0 ? "text-[#F87171]" : liveLeverage >= 2.0 ? "text-[#FBBF24]" : "text-[#34D399]"
                  }`}
                >
                  {lev(liveLeverage)}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls & Dropdown */}
        <div className="flex items-center gap-2 relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={handleResetPortfolio}
            className="flex items-center gap-1.5 rounded-xl border border-[#231F42] bg-[#121024] px-3 py-2 text-xs text-[#94A3B8] hover:text-white hover:border-[#7C3AED]/40 transition-all"
            title="Reset positions and equity to original baseline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedAccountModal(!selectedAccountModal)}
            className="flex items-center gap-2 rounded-xl border border-[#7C3AED]/50 bg-[#1A1636] px-4 py-2 text-xs font-semibold text-[#C4B5FD] hover:bg-[#201B46] shadow-[0_0_20px_rgba(124,58,237,0.25)] transition-all"
          >
            <Layers className="w-3.5 h-3.5 text-[#A78BFA]" />
            Switch Portfolio
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${selectedAccountModal ? "rotate-90" : ""}`} />
          </button>

          {/* High Z-Index Dropdown */}
          {selectedAccountModal && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-[#7C3AED]/40 bg-[#0B0A14] p-3 shadow-[0_25px_60px_rgba(0,0,0,0.95)] z-[100] max-h-80 overflow-y-auto backdrop-blur-2xl">
              <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#A78BFA] flex items-center justify-between border-b border-[#231F42] pb-2 mb-1.5">
                <span>Select Portfolio Profile</span>
                <span className="text-[#64748B]">{accounts.length} Profiles</span>
              </div>
              <div className="space-y-1">
                {accounts.map((acct) => (
                  <button
                    key={acct.id}
                    type="button"
                    onClick={() => handleSwitchAccount(acct.id)}
                    className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-xs text-left transition-all ${
                      acct.id === currentAccount.account_id
                        ? "bg-[#7C3AED]/30 text-white font-bold border border-[#7C3AED]/50"
                        : "text-[#94A3B8] hover:bg-[#181530] hover:text-white"
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="truncate font-medium">{acct.display_name || acct.id}</div>
                      <div className="text-[10px] text-[#64748B]">{acct.tz}</div>
                    </div>
                    <span className="font-mono text-[11px] text-[#A78BFA] shrink-0 font-semibold">
                      {money(acct.equity)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Shock Controller Card */}
      <GlowingCard className="border-[#231F42] bg-gradient-to-b from-[#0F0D20] to-[#080711] relative z-10">
        <div className="flex flex-col gap-6">
          {/* Title & Current Shock Display */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#A78BFA]">
                <ShieldAlert className="w-4 h-4" />
                Overnight Market Shock Simulator
              </div>
              <h3 className="text-xl font-extrabold text-white tracking-tight mt-1">
                The 2:00 AM Gap Shock Controller
              </h3>
              <p className="text-xs text-[#94A3B8] mt-1 max-w-xl">
                Simulate an immediate market gap against your positions between New York close (16:00 ET) and morning open.
              </p>
            </div>

            {/* Big Shock Percentage Pill */}
            <div className="flex items-center gap-3">
              <div
                className={`flex flex-col items-end px-5 py-2.5 rounded-xl border ${
                  gapPct < 0
                    ? gapPct <= -0.12
                      ? "border-[#EF4444]/60 bg-[#EF4444]/15 text-[#EF4444]"
                      : "border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#F59E0B]"
                    : "border-[#10B981]/60 bg-[#10B981]/15 text-[#10B981]"
                }`}
              >
                <span className="text-[10px] font-mono uppercase tracking-wider opacity-80">Simulated Gap</span>
                <span className="text-3xl font-black font-mono tracking-tight">
                  {gapPct > 0 ? `+${(gapPct * 100).toFixed(1)}%` : `${(gapPct * 100).toFixed(1)}%`}
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Range Slider */}
          <div className="space-y-3 pt-2">
            <div className="relative flex items-center">
              <input
                type="range"
                min="-0.35"
                max="0.10"
                step="0.005"
                value={gapPct}
                onChange={(e) => setGapPct(parseFloat(e.target.value))}
                className="w-full h-3 bg-[#181530] rounded-lg appearance-none cursor-pointer accent-[#7C3AED] focus:outline-none"
              />
            </div>

            {/* Slider Tick Marks */}
            <div className="flex justify-between text-[10px] font-mono text-[#64748B] px-1">
              <span className="text-[#EF4444] font-semibold">-35% Crash</span>
              <span className="text-[#F87171]">-20% Severe</span>
              <span className="text-[#FBBF24]">-10% Correction</span>
              <span className="text-[#94A3B8]">0.0% Flat</span>
              <span className="text-[#34D399] font-semibold">+10% Rally</span>
            </div>
          </div>

          {/* Black Swan Time Machine (Historical Crisis Replay Engine) */}
          <div className="pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#A78BFA] flex items-center gap-1.5 font-bold">
                <History className="w-3.5 h-3.5 text-[#A78BFA]" />
                The Black Swan Time Machine · Historical Crisis Replay
              </div>
              <span className="text-[10px] font-mono text-[#64748B] flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#7C3AED]" />
                Interactive Stress Presets
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {CRISIS_SCENARIOS.map((p) => {
                const Icon = p.icon;
                const active = selectedCrisis?.id === p.id || Math.abs(gapPct - p.gap) < 0.004;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedCrisis(p);
                      setGapPct(p.gap);
                    }}
                    className={`flex flex-col text-left p-3 rounded-xl border transition-all duration-200 ${
                      active
                        ? "border-[#7C3AED] bg-[#7C3AED]/20 shadow-[0_0_25px_rgba(124,58,237,0.4)]"
                        : "border-[#231F42] bg-[#0E0C1C] hover:border-[#7C3AED]/40 hover:bg-[#141126]"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <Icon
                        className={`w-3.5 h-3.5 ${
                          p.tone === "critical"
                            ? "text-[#EF4444]"
                            : p.tone === "danger"
                            ? "text-[#F87171]"
                            : p.tone === "warn"
                            ? "text-[#FBBF24]"
                            : "text-[#34D399]"
                        }`}
                      />
                      <span className="font-mono text-[11px] font-bold text-white">
                        {p.gap > 0 ? `+${(p.gap * 100).toFixed(1)}%` : `${(p.gap * 100).toFixed(1)}%`}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-white truncate">{p.label}</span>
                    <span className="text-[10px] text-[#A78BFA] font-mono truncate">{p.date}</span>
                  </button>
                );
              })}
            </div>

            {/* Interactive Crisis Dossier Card */}
            {selectedCrisis && (
              <div className="mt-4 rounded-2xl border border-[#7C3AED]/40 bg-[#0B0A16] p-4.5 shadow-2xl backdrop-blur-xl relative overflow-hidden animate-fade-in">
                <div className="absolute -right-8 -bottom-8 w-40 h-40 bg-[#7C3AED]/10 rounded-full blur-3xl pointer-events-none" />

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#231F42] pb-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-2 w-2 rounded-full bg-[#EF4444] animate-ping" />
                    <span className="rounded-full bg-[#EF4444]/15 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#F87171] border border-[#EF4444]/30">
                      CRISIS DOSSIER: {selectedCrisis.date}
                    </span>
                    <span className="text-xs font-bold text-white tracking-tight">
                      {selectedCrisis.headline}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[#181530] px-2 py-0.5 text-[10px] font-mono text-[#C4B5FD] border border-[#231F42]">
                      VIX: {selectedCrisis.vixSpike}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Historical Narrative */}
                  <div className="lg:col-span-7 space-y-2">
                    <p className="text-xs text-[#CBD5E1] leading-relaxed">
                      {selectedCrisis.historicalContext}
                    </p>
                    <div className="text-[11px] font-mono text-[#94A3B8] flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-[#F59E0B]" />
                      <span>{selectedCrisis.liquidityDrain}</span>
                    </div>
                  </div>

                  {/* MochaGuard Survival Verdict & 1-Click Margin Armor */}
                  <div className="lg:col-span-5 flex flex-col justify-between p-3.5 rounded-xl border border-[#231F42] bg-[#05050A]/80">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA] mb-1">
                        MochaGuard Survival Engine
                      </div>
                      <div className="text-xs text-white">
                        {sim.isNegativeEquity ? (
                          <span className="text-[#F87171] font-medium">
                            ⚠️ Unattended account loses 100% equity and incurs{" "}
                            <strong className="font-mono font-bold">{money(sim.brokerLoss)}</strong> in negative bad debt. MochaGuard trims positions at 15:45 to guarantee broker solvency.
                          </span>
                        ) : (
                          <span className="text-[#34D399] font-medium">
                            ✓ Account survives with{" "}
                            <strong className="font-mono font-bold">{money(sim.newEquity)}</strong> equity remaining (Buffer: {money(sim.buffer)}).
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pt-3">
                      {armorDeployed ? (
                        <div className="flex items-center gap-2 rounded-xl bg-[#10B981]/15 border border-[#10B981]/40 px-3 py-2 text-xs font-mono font-semibold text-[#34D399]">
                          <ShieldCheck className="w-4 h-4 text-[#34D399]" />
                          <span>Margin Armor Active: Protective Hedge Added</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleDeployArmor}
                          className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#7C3AED] bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] px-3 py-2 text-xs font-bold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] hover:brightness-110 active:scale-[0.98] transition-all"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          <span>Deploy 1-Click Collar Hedge (SQQQ Inverse)</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </GlowingCard>

      {/* KPI Threat Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative z-10">
        {/* KPI 1: Simulated Equity */}
        <div className="rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">Simulated Equity</div>
          <div
            className={`tabular mt-2 text-2xl font-bold font-mono ${
              sim.newEquity <= 0 ? "text-[#EF4444]" : sim.newEquity < equity * 0.5 ? "text-[#FBBF24]" : "text-white"
            }`}
          >
            {money(sim.newEquity)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-mono">
            {sim.totalLoss < 0 ? (
              <span className="text-[#F87171] flex items-center gap-0.5">
                <ArrowDownRight className="w-3.5 h-3.5" />
                {money(sim.totalLoss)} ({pct(equity > 0 ? sim.totalLoss / equity : 0)})
              </span>
            ) : (
              <span className="text-[#34D399]">No overnight drawdown</span>
            )}
          </div>
        </div>

        {/* KPI 2: Margin Coverage Ratio */}
        <div className="rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">Margin Health Ratio</div>
          <div
            className={`tabular mt-2 text-2xl font-bold font-mono ${
              sim.marginRatio >= 1.0 ? "text-[#34D399]" : sim.marginRatio >= 0.7 ? "text-[#FBBF24]" : "text-[#EF4444]"
            }`}
          >
            {(sim.marginRatio * 100).toFixed(0)}%
          </div>
          <div className="mt-1 text-xs text-[#64748B] font-mono">
            Required: <span className="text-white">{money(sim.marginRequired)}</span>
          </div>
        </div>

        {/* KPI 3: Mandatory Auto-Liquidation */}
        <div className="rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 relative overflow-hidden">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">15:45 Automated De-Risk</div>
          <div
            className={`tabular mt-2 text-2xl font-bold font-mono ${
              sim.totalSharesSold > 0 ? "text-[#F87171]" : "text-[#34D399]"
            }`}
          >
            {sim.totalSharesSold > 0 ? `${shares(sim.totalSharesSold)} shares` : "0 shares"}
          </div>
          <div className="mt-1 text-xs text-[#64748B] font-mono">
            Est. Slippage:{" "}
            <span className={sim.totalSlippage > 0 ? "text-[#F87171]" : "text-white"}>
              {sim.totalSlippage > 0 ? money(sim.totalSlippage) : "$0"}
            </span>
          </div>
        </div>

        {/* KPI 4: Broker Bad Debt Protection */}
        <div
          className={`rounded-2xl border p-5 relative overflow-hidden ${
            sim.isNegativeEquity
              ? "border-[#EF4444]/60 bg-[#EF4444]/10"
              : "border-[#231F42] bg-[#0B0A14]"
          }`}
        >
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">Broker Shortfall Risk</div>
          <div
            className={`tabular mt-2 text-2xl font-bold font-mono ${
              sim.isNegativeEquity ? "text-[#EF4444] animate-pulse" : "text-[#34D399]"
            }`}
          >
            {sim.isNegativeEquity ? money(sim.brokerLoss) : "$0.00"}
          </div>
          <div className="mt-1 text-xs font-mono text-[#64748B]">
            {sim.isNegativeEquity ? (
              <span className="text-[#EF4444] font-semibold">Broker Shortfall Incurred</span>
            ) : (
              <span className="text-[#34D399] flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> 100% Equity Protected
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Visual Threat Meter & Runway Bar */}
      <div className={`rounded-2xl border p-6 space-y-4 relative z-10 transition-all duration-300 ${threatLevel.border} bg-[#0B0A14]`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                sim.isNegativeEquity
                  ? "bg-[#EF4444] animate-ping"
                  : sim.marginRatio < 1.0
                  ? "bg-[#FBBF24]"
                  : "bg-[#34D399]"
              }`}
            />
            <span className={`text-xs font-mono font-bold tracking-wider uppercase ${threatLevel.color}`}>
              Status: {threatLevel.label}
            </span>
          </div>

          <div className="text-xs font-mono">
            {sim.buffer >= 0 ? (
              <span className="text-[#94A3B8]">
                Buffer: <span className="text-[#34D399] font-bold">+{money(sim.buffer)}</span> before liquidation trigger
              </span>
            ) : (
              <span className="text-[#F87171] font-bold">
                Deficit: -{money(Math.abs(sim.buffer))} (15:45 De-Risking Triggered)
              </span>
            )}
          </div>
        </div>

        {/* Visual Multi-Segment Runway Progress Bar */}
        <div className="relative h-4 w-full bg-[#181530] rounded-full overflow-hidden p-0.5 flex gap-0.5">
          {sim.isNegativeEquity ? (
            /* Pulsing Insolvent Bar */
            <div className="h-full w-full bg-gradient-to-r from-[#EF4444] to-[#B91C1C] animate-pulse rounded-full" />
          ) : sim.marginRatio < 1.0 ? (
            /* Warning / Deficit Ratio Bar */
            <>
              <div
                className="h-full bg-gradient-to-r from-[#F59E0B] to-[#F87171] rounded-l-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(10, sim.marginRatio * 100))}%` }}
              />
              <div
                className="h-full bg-[#EF4444]/40 rounded-r-full transition-all duration-300"
                style={{ width: `${Math.min(90, Math.max(0, (1 - sim.marginRatio) * 100))}%` }}
              />
            </>
          ) : (
            /* Safe Green Comfort Zone */
            <div
              className="h-full bg-gradient-to-r from-[#10B981] to-[#34D399] rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(25, (sim.marginRatio / 2) * 100))}%` }}
            />
          )}
        </div>

        <div className="flex justify-between text-[11px] font-mono text-[#64748B]">
          <span className={sim.isNegativeEquity ? "text-[#EF4444] font-bold" : ""}>0% Equity</span>
          <span className={sim.marginRatio < 1.0 && !sim.isNegativeEquity ? "text-[#FBBF24] font-bold" : ""}>
            Margin Call Line (1.0x)
          </span>
          <span className={sim.marginRatio >= 1.5 ? "text-[#34D399] font-bold" : ""}>Comfort Zone (&gt;1.5x)</span>
        </div>
      </div>

      {/* The 2 AM Execution Matrix Table */}
      <div className="rounded-2xl border border-[#231F42] bg-[#0B0A14] overflow-hidden relative z-10">
        <div className="p-5 border-b border-[#231F42] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold text-white tracking-wide">
              The 2:00 AM Automated Action Matrix
            </h4>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Exact per-position order routing executed automatically at 15:45 ET before overnight freeze.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-[#A78BFA] px-3 py-1 rounded-lg bg-[#121024] border border-[#231F42]">
              {positions.length} Positions
            </span>

            {/* "+ Add Stock" Button */}
            <button
              type="button"
              onClick={() => setShowAddStockModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:brightness-110 shadow-[0_0_15px_rgba(124,58,237,0.3)] transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Stock
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#121024]/60 text-[#94A3B8] font-mono text-[10px] uppercase tracking-wider border-b border-[#231F42]">
              <tr>
                <th className="py-3 px-4">Symbol</th>
                <th className="py-3 px-4">Qty</th>
                <th className="py-3 px-4">Initial Value</th>
                <th className="py-3 px-4">Shock Price</th>
                <th className="py-3 px-4">Drawdown</th>
                <th className="py-3 px-4">Overnight Limit</th>
                <th className="py-3 px-4 text-right">Auto Action</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#231F42]/40 font-mono">
              {sim.positions.map((pos) => {
                const plan = sim.liquidationPlan.find((l) => l.symbol === pos.symbol);
                const hasAction = plan && plan.sharesToSell > 0;
                return (
                  <tr key={pos.symbol} className="hover:bg-[#121024]/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{pos.symbol}</span>
                        {pos.earnings_tonight && (
                          <span className="rounded bg-[#EF4444]/20 border border-[#EF4444]/40 px-1.5 py-0.5 text-[9px] font-bold text-[#EF4444]">
                            EARNINGS AMC
                          </span>
                        )}
                        {pos.frozen && (
                          <span className="rounded bg-[#F59E0B]/20 border border-[#F59E0B]/40 px-1.5 py-0.5 text-[9px] font-bold text-[#F59E0B]">
                            FROZEN
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[#94A3B8]">{pos.qty}</td>
                    <td className="py-3 px-4 text-[#94A3B8]">{money(pos.initialNotional)}</td>
                    <td className="py-3 px-4 text-white font-semibold">
                      {money(pos.price * (1 + pos.effectiveGap), true)}
                    </td>
                    <td className="py-3 px-4 text-[#F87171]">
                      {money(pos.posLoss)} ({(pos.effectiveGap * 100).toFixed(1)}%)
                    </td>
                    <td className="py-3 px-4 text-[#A78BFA]">{lev(pos.effectiveLev)}</td>
                    <td className="py-3 px-4 text-right">
                      {hasAction ? (
                        <div className="inline-flex flex-col items-end">
                          <span className="rounded-md bg-[#EF4444]/20 border border-[#EF4444]/50 px-2 py-0.5 text-[11px] font-bold text-[#EF4444]">
                            SELL {shares(plan.sharesToSell)}
                          </span>
                          <span className="text-[10px] text-[#94A3B8] mt-0.5">
                            Slip: {plan.slippageBps}bps ({money(plan.slippageCost)})
                          </span>
                        </div>
                      ) : (
                        <span className="rounded-md bg-[#10B981]/20 border border-[#10B981]/40 px-2 py-0.5 text-[11px] font-bold text-[#34D399]">
                          HOLD (SAFE)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveStock(pos.symbol)}
                        className="p-1 rounded-lg text-[#64748B] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
                        title={`Remove ${pos.symbol} from portfolio`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Stock Modal */}
      {showAddStockModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-[#7C3AED]/40 bg-[#0B0A14] p-6 shadow-[0_25px_60px_rgba(0,0,0,0.95)]">
            <div className="flex items-center justify-between border-b border-[#231F42] pb-4 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7C3AED]/20 text-[#A78BFA]">
                  <Plus className="w-4 h-4" />
                </div>
                <h4 className="text-base font-bold text-white">Add Stock to Portfolio</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStockModal(false)}
                className="rounded-lg p-1 text-[#94A3B8] hover:text-white hover:bg-[#181530]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddStock} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-[#94A3B8] mb-1.5">Select Stock Ticker</label>
                <select
                  value={selectedStockTicker}
                  onChange={(e) => handleSelectTicker(e.target.value)}
                  className="w-full rounded-xl border border-[#231F42] bg-[#121024] px-3 py-2 text-white font-mono focus:border-[#7C3AED] focus:outline-none"
                >
                  {POPULAR_STOCKS.map((s) => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.symbol} — {s.name} (${s.price})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#94A3B8] mb-1.5">Quantity (Shares)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={customShares}
                    onChange={(e) => setCustomShares(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#231F42] bg-[#121024] px-3 py-2 text-white font-mono focus:border-[#7C3AED] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[#94A3B8] mb-1.5">Current Price ($)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.01"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#231F42] bg-[#121024] px-3 py-2 text-white font-mono focus:border-[#7C3AED] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#94A3B8] mb-1.5">Overnight Max Lev</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    step="0.1"
                    value={customLev}
                    onChange={(e) => setCustomLev(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#231F42] bg-[#121024] px-3 py-2 text-white font-mono focus:border-[#7C3AED] focus:outline-none"
                  />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-xl border border-[#231F42] bg-[#121024]">
                    <input
                      type="checkbox"
                      checked={customEarnings}
                      onChange={(e) => setCustomEarnings(e.target.checked)}
                      className="accent-[#7C3AED]"
                    />
                    <span className="text-[#EF4444] font-semibold text-[11px]">Earnings AMC</span>
                  </label>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:brightness-110 shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all"
                >
                  Add to Stress Test Portfolio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Explanatory Footer Callout */}
      <div className="rounded-2xl border border-[#231F42] bg-[#0E0C1C] p-5 flex items-start gap-4 relative z-10">
        <div className="p-2 rounded-xl bg-[#7C3AED]/20 text-[#A78BFA] shrink-0 mt-0.5">
          <Info className="w-5 h-5" />
        </div>
        <div className="text-xs text-[#94A3B8] leading-relaxed">
          <h5 className="font-semibold text-white text-sm mb-1">Why MochaGuard does not wait for a margin call reply:</h5>
          When holding a levered portfolio into New York market close (16:00 ET), waiting for customer email confirmation is a guarantee of bad debt. By pricing 99th-percentile gaps dynamically and calculating the mathematical participation against average dollar volume, MochaGuard preserves equity and ensures your portfolio wakes up solvent every single morning.
        </div>
      </div>
    </div>
  );
}
