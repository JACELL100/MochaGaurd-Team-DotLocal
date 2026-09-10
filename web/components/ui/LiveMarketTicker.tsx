"use client";

import React, { useEffect, useState } from "react";
import { TextLoop } from "./TextLoop";

interface TickerItem {
  symbol: string;
  name: string;
  price: string;
  change: string;
  up: boolean;
  type: "btc" | "eth" | "sol" | "nasdaq" | "sp500" | "nvda";
  color: string;
}

// High-fidelity official SVGs for crypto & stock tickers
function TickerLogo({ type }: { type: string }) {
  switch (type) {
    case "btc":
      return (
        <svg className="w-4 h-4" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="16" fill="#F7931A" />
          <path
            fill="#FFFFFF"
            d="M23.189 14.02c0.314-2.096-1.283-3.223-3.465-3.975l0.708-2.84-1.728-0.43-0.69 2.765c-0.454-0.114-0.922-0.22-1.385-0.326l0.695-2.783-1.728-0.43-0.708 2.839c-0.376-0.086-0.744-0.17-1.09-0.258l0.002-0.007-2.384-0.596-0.46 1.846s1.283 0.294 1.256 0.312c0.7 0.175 0.826 0.638 0.805 1.006l-0.806 3.235c0.048 0.012 0.11 0.03 0.179 0.057l-0.183-0.046-1.13 4.532c-0.086 0.213-0.304 0.533-0.796 0.41l-1.26-0.315-0.859 1.98 2.25 0.561c0.418 0.105 0.828 0.214 1.232 0.318l-0.716 2.875 1.727 0.43 0.708-2.84c0.472 0.127 0.93 0.245 1.378 0.357l-0.704 2.825 1.728 0.431 0.716-2.869c2.948 0.558 5.164 0.333 6.097-2.333 0.752-2.146-0.037-3.385-1.588-4.192 1.13-0.26 1.98-1.003 2.207-2.538zM19.105 19.345c-0.535 2.146-4.152 0.986-5.325 0.694l0.95-3.81c1.173 0.293 4.928 0.872 4.375 3.116zM19.988 13.987c-0.488 1.954-3.502 0.962-4.478 0.719l0.862-3.454c0.976 0.244 4.12 0.699 3.616 2.735z"
          />
        </svg>
      );
    case "eth":
      return (
        <svg className="w-4 h-4" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="16" fill="#627EEA" />
          <g fill="#FFFFFF" fillRule="nonzero">
            <path d="M16.498 4v8.87l7.497 3.35z" fillOpacity="0.6" />
            <path d="M16.498 4L9 16.22l7.498-3.35z" />
            <path d="M16.498 21.968v6.027L24 17.616z" fillOpacity="0.6" />
            <path d="M16.498 27.995v-6.027L9 17.616z" />
            <path d="M16.498 20.573l7.497-4.353-7.497-3.348z" fillOpacity="0.2" />
            <path d="M9 16.22l7.498 4.353v-7.701z" fillOpacity="0.6" />
          </g>
        </svg>
      );
    case "sol":
      return (
        <svg className="w-4 h-4" viewBox="0 0 397 311">
          <defs>
            <linearGradient id="sol-grad-1" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00FFA3" />
              <stop offset="100%" stopColor="#DC1FFF" />
            </linearGradient>
            <linearGradient id="sol-grad-2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00FFA3" />
              <stop offset="100%" stopColor="#DC1FFF" />
            </linearGradient>
            <linearGradient id="sol-grad-3" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00FFA3" />
              <stop offset="100%" stopColor="#DC1FFF" />
            </linearGradient>
          </defs>
          <path fill="url(#sol-grad-1)" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
          <path fill="url(#sol-grad-2)" d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
          <path fill="url(#sol-grad-3)" d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
        </svg>
      );
    case "nasdaq":
      return (
        <div className="w-4 h-4 rounded bg-[#002B49] border border-[#0091FF]/40 flex items-center justify-center font-bold text-[8px] text-[#0091FF] font-mono leading-none">
          NQ
        </div>
      );
    case "sp500":
      return (
        <div className="w-4 h-4 rounded bg-[#7C3AED]/20 border border-[#A78BFA]/40 flex items-center justify-center font-bold text-[7px] text-[#C4B5FD] font-mono leading-none">
          S&amp;P
        </div>
      );
    case "nvda":
      return (
        <div className="w-4 h-4 rounded bg-[#76B900] flex items-center justify-center font-bold text-[8px] text-black font-mono leading-none shadow-[0_0_8px_#76B900]">
          NV
        </div>
      );
    default:
      return <div className="w-3.5 h-3.5 rounded-full bg-[#7C3AED]" />;
  }
}

const DEFAULT_TICKERS: TickerItem[] = [
  { symbol: "BTC", name: "BTC", price: "$78,264.02", change: "+2.40%", up: true, type: "btc", color: "#F7931A" },
  { symbol: "ETH", name: "ETH", price: "$2,466.02", change: "+1.70%", up: true, type: "eth", color: "#627EEA" },
  { symbol: "SOL", name: "SOL", price: "$102.31", change: "-0.98%", up: false, type: "sol", color: "#14F195" },
  { symbol: "NASDAQ", name: "NASDAQ", price: "26,253.34", change: "+0.60%", up: true, type: "nasdaq", color: "#38BDF8" },
  { symbol: "S&P 500", name: "S&P 500", price: "7,636.36", change: "+0.48%", up: true, type: "sp500", color: "#A78BFA" },
  { symbol: "NVDA", name: "NVDA", price: "$142.80", change: "+3.12%", up: true, type: "nvda", color: "#10B981" },
];

export function LiveMarketTicker() {
  const [tickers, setTickers] = useState<TickerItem[]>(DEFAULT_TICKERS);

  useEffect(() => {
    let isMounted = true;
    const fetchMarketData = async () => {
      try {
        const res = await fetch("/api/ticker");
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data?.tickers && data.tickers.length > 0) {
          const mapped = data.tickers.map((t: any) => {
            let type: "btc" | "eth" | "sol" | "nasdaq" | "sp500" | "nvda" = "btc";
            const sym = t.name.toLowerCase();
            if (sym.includes("btc")) type = "btc";
            else if (sym.includes("eth")) type = "eth";
            else if (sym.includes("sol")) type = "sol";
            else if (sym.includes("nasdaq")) type = "nasdaq";
            else if (sym.includes("p 500") || sym.includes("sp")) type = "sp500";
            else if (sym.includes("nvda")) type = "nvda";

            return {
              ...t,
              type,
            };
          });
          setTickers(mapped);
        }
      } catch {
        // keep default
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 30000); // refresh every 30s

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Format loop text for TextLoop fallback
  const loopString = tickers
    .map((t) => `${t.name} ${t.price} (${t.change})`)
    .join("  ✦  ");

  return (
    <div className="relative z-30 w-full bg-[#05050A]/95 border-t border-[#1C1836] py-2.5 px-4 sm:px-6 lg:px-8 overflow-hidden select-none">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Left Badge: Live Markets Indicator */}
        <div className="flex items-center gap-2 shrink-0 pr-4 border-r border-[#1C1836]">
          <div className="flex items-center gap-2 font-mono text-xs font-bold text-white tracking-wider">
            <span>LIVE MARKETS</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10B981]" />
            </span>
          </div>
        </div>

        {/* Center: Real SVG Logomarks Continuous Marquee Loop */}
        <div className="flex-1 overflow-hidden max-w-4xl mx-2 hidden sm:block">
          <div className="flex items-center overflow-hidden">
            <div className="inline-flex items-center gap-6 animate-marquee whitespace-nowrap py-1">
              {tickers.concat(tickers).map((t, idx) => (
                <div
                  key={`${t.name}-${idx}`}
                  className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-[#0B0A14]/85 border border-[#231F42] hover:border-[#7C3AED]/50 transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
                >
                  <TickerLogo type={t.type} />
                  <span className="text-xs font-bold font-mono text-white tracking-wide">
                    {t.name}
                  </span>
                  <span className="text-xs font-mono text-[#E2E8F0] font-medium">{t.price}</span>
                  <span
                    className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      t.up
                        ? "text-emerald-400 bg-emerald-500/15 border border-emerald-500/25"
                        : "text-rose-400 bg-rose-500/15 border border-rose-500/25"
                    }`}
                  >
                    {t.change}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile TextLoop Fallback */}
        <div className="flex-1 overflow-hidden sm:hidden">
          <TextLoop
            text={loopString}
            shape="line"
            speed={70}
            fontSize={12}
            fontWeight={600}
            color="#E2E8F0"
            pauseOnHover={true}
          />
        </div>

        {/* Right Status Badge */}
        <div className="flex items-center gap-2 shrink-0 pl-4 border-l border-[#1C1836] text-xs font-mono text-emerald-400 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10B981] animate-pulse" />
          <span className="hidden md:inline">All Systems Operational</span>
          <span className="md:hidden">100% OK</span>
        </div>
      </div>
    </div>
  );
}
