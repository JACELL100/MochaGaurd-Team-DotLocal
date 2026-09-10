"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Activity, AlertTriangle, ArrowUpRight, TrendingDown } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

interface RiskGaugeProps {
  value?: number; // 0.0 to 1.0 (e.g. 0.42 = 42%)
  label?: string;
  sublabel?: string;
  className?: string;
}

export function RiskGauge({
  value = 0.42,
  label = "Aggregate Book Stress",
  sublabel = "Based on historical p99 adverse gaps",
  className = "",
}: RiskGaugeProps) {
  const [hovered, setHovered] = useState(false);
  const clamped = Math.max(0, Math.min(1, value));
  const percent = (clamped * 100).toFixed(1);

  // Status computation
  const tone = clamped < 0.45 ? "safe" : clamped < 0.75 ? "warn" : "danger";
  const statusLabel = tone === "safe" ? "Nominal Stress" : tone === "warn" ? "Elevated Buffer" : "Critical Risk";

  // Segmented circumference calculations
  const totalTicks = 32;
  const activeTicks = Math.round(clamped * totalTicks);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative overflow-hidden rounded-2xl bg-[#0B0A14]/90 border border-[#231F42] backdrop-blur-xl p-6 transition-all duration-300 ${
        hovered ? "border-[#7C3AED]/50 shadow-[0_10px_35px_rgba(124,58,237,0.18)]" : "shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
      } ${className}`}
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between pb-4 border-b border-[#1C1836]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10B981] animate-pulse" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#94A3B8]">
            Surveillance Telemetry
          </span>
        </div>
        <StatusBadge tone={tone as any} pulsing={tone !== "safe"}>
          {statusLabel}
        </StatusBadge>
      </div>

      {/* Main Radial Telemetry & Metrics Display */}
      <div className="py-6 flex flex-col sm:flex-row items-center justify-between gap-6">
        {/* Left: High-Precision Segmented Arc Gauge */}
        <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90 transform">
            {/* Background Track Circle */}
            <circle
              cx="70"
              cy="70"
              r="56"
              fill="none"
              stroke="#181530"
              strokeWidth="7"
              strokeDasharray="351.8"
              strokeDashoffset="0"
              strokeLinecap="round"
            />

            {/* Glowing Active Arc */}
            <motion.circle
              cx="70"
              cy="70"
              r="56"
              fill="none"
              stroke="url(#radial-risk-grad)"
              strokeWidth="7"
              strokeDasharray="351.8"
              initial={{ strokeDashoffset: 351.8 }}
              animate={{ strokeDashoffset: 351.8 - (clamped * 351.8) }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              strokeLinecap="round"
              className="filter drop-shadow-[0_0_10px_rgba(124,58,237,0.5)]"
            />

            {/* Inner Precision Ticks */}
            {Array.from({ length: totalTicks }).map((_, i) => {
              const angle = (i / totalTicks) * 360 * (Math.PI / 180);
              const r1 = 44;
              const r2 = i % 4 === 0 ? 38 : 41;
              const x1 = 70 + r1 * Math.cos(angle);
              const y1 = 70 + r1 * Math.sin(angle);
              const x2 = 70 + r2 * Math.cos(angle);
              const y2 = 70 + r2 * Math.sin(angle);
              const isActive = i <= activeTicks;

              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isActive ? (i > totalTicks * 0.75 ? "#EF4444" : i > totalTicks * 0.45 ? "#F59E0B" : "#A78BFA") : "#231F42"}
                  strokeWidth={i % 4 === 0 ? "1.5" : "1"}
                  strokeLinecap="round"
                />
              );
            })}

            <defs>
              <linearGradient id="radial-risk-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="45%" stopColor="#7C3AED" />
                <stop offset="75%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#EF4444" />
              </linearGradient>
            </defs>
          </svg>

          {/* Center Readout HUD */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-extrabold font-mono tracking-tight text-white">
              {percent}%
            </span>
            <span className="text-[10px] font-mono text-[#A78BFA] uppercase tracking-wider">
              Stress Score
            </span>
          </div>
        </div>

        {/* Right: Metrics & Breakdown Breakdown */}
        <div className="flex-1 w-full space-y-3">
          <div>
            <h4 className="text-base font-bold text-white tracking-tight">{label}</h4>
            <p className="text-xs text-[#94A3B8] leading-relaxed mt-0.5">{sublabel}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
            <div className="p-2.5 rounded-lg bg-[#05050A] border border-[#1C1836]">
              <span className="text-[10px] uppercase text-[#64748B] block">Safety Margin</span>
              <span className="text-xs font-bold text-emerald-400 mt-0.5 block">58.0% Healthy</span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#05050A] border border-[#1C1836]">
              <span className="text-[10px] uppercase text-[#64748B] block">Worst-Case Tail</span>
              <span className="text-xs font-bold text-[#CBD5E1] mt-0.5 block">p99 Adverse</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Telemetry Bar: Live Distribution Indicators */}
      <div className="pt-4 border-t border-[#1C1836] space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-[#94A3B8]">
          <span>Liquidation Buffer</span>
          <span className="text-white font-semibold">1.72x Collateral Cushion</span>
        </div>

        {/* Segmented Progress Strip */}
        <div className="w-full h-1.5 rounded-full bg-[#181530] overflow-hidden flex">
          <div className="h-full bg-emerald-500 rounded-l-full" style={{ width: "35%" }} />
          <div className="h-full bg-[#7C3AED]" style={{ width: "25%" }} />
          <div className="h-full bg-amber-500" style={{ width: "20%" }} />
          <div className="h-full bg-rose-500 rounded-r-full" style={{ width: "20%" }} />
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-[#64748B] pt-0.5">
          <span>0% Safe</span>
          <span>45% Ramp</span>
          <span>75% Margin Call</span>
          <span>100% Breached</span>
        </div>
      </div>
    </div>
  );
}
