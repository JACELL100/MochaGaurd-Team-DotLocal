"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { RiskGauge } from "../ui/RiskGauge";
import { GlowingCard } from "../ui/GlowingCard";
import { StatusBadge } from "../ui/StatusBadge";
import { TrendingUp, AlertTriangle, ShieldCheck, Flame, Cpu, ArrowUpRight } from "lucide-react";

// A static illustration of the product surface, shown above the real book console on the
// landing page. The figures below are illustrative, not engine output, and the section is
// labelled as such -- the live numbers are rendered further down the page from /dashboard/book.
export function DashboardPreview() {
  const [activeTab, setActiveTab] = useState<"margin" | "concentration" | "copilot">("margin");

  const positions = [
    { symbol: "NVDA", notional: "$1,450,200", leverage: "3.4x", margin: "34.5%", status: "safe", risk: "Earnings tonight" },
    { symbol: "MSFT", notional: "$980,000", leverage: "2.1x", margin: "21.0%", status: "safe", risk: "Low volatility" },
    { symbol: "SMCI", notional: "$420,500", leverage: "5.8x", margin: "68.2%", status: "warn", risk: "Crowding haircut" },
    { symbol: "GME", notional: "$180,000", leverage: "1.0x", margin: "100%", status: "danger", risk: "Freeze guard active" },
  ];

  return (
    <section className="relative py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="text-center max-w-3xl mx-auto mb-12">
        <StatusBadge tone="accent">Illustration</StatusBadge>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mt-3">
          Surveillance at Microsecond Speed
        </h2>
        <p className="text-sm sm:text-base text-[#94A3B8] mt-2">
          Calculates portfolio health before high-impact gaps hit the market.
        </p>
        <p className="text-xs text-[#64748B] mt-3">
          Illustrative figures. Live engine output for the real book is in the{" "}
          <a href="#console" className="text-[#C4B5FD] hover:underline">risk console below</a>.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: risk gauge (illustrative) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <RiskGauge
            value={0.42}
            label="Aggregate Book Stress"
            sublabel="Based on historical p99 adverse gaps"
          />

          <GlowingCard className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-[#94A3B8]">
                Copilot Grounding
              </span>
              <StatusBadge tone="safe" pulsing={false}>
                Deterministic
              </StatusBadge>
            </div>
            <p className="text-xs text-[#CBD5E1] leading-relaxed">
              &quot;Book leverage reduced on SMCI &amp; NVDA ahead of 20:00 ET close. Overnight margin requirements increased to 45% due to after-market earnings volatility.&quot;
            </p>
            <div className="flex items-center gap-2 pt-2 border-t border-[#231F42] text-[11px] text-[#A78BFA] font-mono">
              <Cpu className="w-3.5 h-3.5" />
              Grounded on 42 engine assertions
            </div>
          </GlowingCard>
        </div>

        {/* Center & Right Column: Interactive Portfolio Monitor */}
        <div className="lg:col-span-2">
          <GlowingCard className="h-full flex flex-col">
            {/* Header with Navigation Pills */}
            <div className="flex flex-wrap items-center justify-between pb-4 border-b border-[#231F42] gap-4">
              <div>
                <h3 className="text-base font-semibold text-white">Active Positions &amp; Margin Haircuts</h3>
                <p className="text-xs text-[#94A3B8]">Crowding haircuts dynamically scale with single-stock notional.</p>
              </div>

              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[#05050A] border border-[#231F42]">
                <button
                  onClick={() => setActiveTab("margin")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeTab === "margin" ? "bg-[#7C3AED] text-white" : "text-[#94A3B8] hover:text-white"
                  }`}
                >
                  Live Margins
                </button>
                <button
                  onClick={() => setActiveTab("concentration")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeTab === "concentration" ? "bg-[#7C3AED] text-white" : "text-[#94A3B8] hover:text-white"
                  }`}
                >
                  Concentration
                </button>
              </div>
            </div>

            {/* Position Table */}
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left font-mono uppercase tracking-wider text-[#64748B] border-b border-[#1C1836]">
                    <th className="pb-2.5 font-medium">Asset</th>
                    <th className="pb-2.5 font-medium">Gross Notional</th>
                    <th className="pb-2.5 font-medium">Leverage</th>
                    <th className="pb-2.5 font-medium">Overnight Margin</th>
                    <th className="pb-2.5 font-medium">Risk Factor</th>
                    <th className="pb-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1C1836]/60 font-mono">
                  {positions.map((p) => (
                    <tr key={p.symbol} className="hover:bg-[#121024]/40 transition-colors">
                      <td className="py-3 font-semibold text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />
                        {p.symbol}
                      </td>
                      <td className="py-3 text-[#E2E8F0]">{p.notional}</td>
                      <td className="py-3 text-[#C4B5FD]">{p.leverage}</td>
                      <td className="py-3 text-[#CBD5E1]">{p.margin}</td>
                      <td className="py-3 text-[#94A3B8] font-sans text-xs">{p.risk}</td>
                      <td className="py-3 text-right">
                        <StatusBadge
                          tone={p.status as any}
                          pulsing={p.status !== "safe"}
                        >
                          {p.status === "safe" ? "Protected" : p.status === "warn" ? "Ramping" : "Frozen"}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bottom Summary Bar */}
            <div className="mt-auto pt-6 border-t border-[#231F42] grid grid-cols-3 gap-4 text-center">
              <div className="p-2.5 rounded-lg bg-[#05050A]/60 border border-[#1C1836]">
                <span className="text-[10px] uppercase font-mono text-[#94A3B8]">Total Gross</span>
                <div className="text-sm font-bold font-mono text-white mt-0.5">$3,030,700</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#05050A]/60 border border-[#1C1836]">
                <span className="text-[10px] uppercase font-mono text-[#94A3B8]">Effective Cap</span>
                <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">3.8x</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#05050A]/60 border border-[#1C1836]">
                <span className="text-[10px] uppercase font-mono text-[#94A3B8]">Sepolia Anchor</span>
                <div className="text-sm font-bold font-mono text-[#C4B5FD] mt-0.5">Pending 20:00 ET</div>
              </div>
            </div>
          </GlowingCard>
        </div>
      </div>
    </section>
  );
}
