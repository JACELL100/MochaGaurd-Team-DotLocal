"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Play,
  Zap,
  Layers,
  Lock,
  BarChart3,
} from "lucide-react";
import { ThreeEarthGlobe } from "../backgrounds/ThreeEarthGlobe";
import { HeroFintechCosmos } from "../backgrounds/HeroFintechCosmos";
import { LiveMarketTicker } from "../ui/LiveMarketTicker";

export function HeroSection() {
  const pillars = [
    {
      icon: Zap,
      title: "Sub-Second",
      subtitle: "Risk Detection",
      color: "text-[#A78BFA]",
      glow: "rgba(167, 139, 250, 0.4)",
    },
    {
      icon: Layers,
      title: "On-Chain",
      subtitle: "Settlement Proofs",
      color: "text-[#C4B5FD]",
      glow: "rgba(196, 181, 253, 0.4)",
    },
    {
      icon: Lock,
      title: "Automated",
      subtitle: "Liquidation Protection",
      color: "text-[#8B5CF6]",
      glow: "rgba(139, 92, 246, 0.4)",
    },
    {
      icon: BarChart3,
      title: "Unified Portfolio",
      subtitle: "Across Exchanges",
      color: "text-[#7C3AED]",
      glow: "rgba(124, 58, 237, 0.4)",
    },
  ];

  return (
    <section className="relative w-full min-h-[100vh] flex flex-col justify-between overflow-hidden bg-[#05050A] text-white pt-20">
      {/* 1. Deep Space Fintech Cosmos & Precision Telemetry Layer */}
      <HeroFintechCosmos />

      {/* 2. Photorealistic 3D Earth Globe Horizon with Natural Night-Lights & Thin Edge Halo */}
      <div className="absolute inset-0 pointer-events-none select-none flex items-end justify-center z-10">
        <div className="relative w-full h-[620px] sm:h-[720px] md:h-[840px] flex items-center justify-center pointer-events-auto">
          {/* Photorealistic 3D Earth Globe */}
          <ThreeEarthGlobe className="w-full h-full" />

          {/* Soft Bottom Horizon Fade into Ticker */}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#05050A] via-[#05050A]/70 to-transparent pointer-events-none" />
        </div>
      </div>

      {/* 3. Hero Content Header & Typography */}
      <div className="relative z-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center pt-6 pb-4">
        {/* Top Tracking Micro-Tagline */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mb-4"
        >
          <span className="text-[11px] sm:text-xs font-mono font-semibold tracking-[0.35em] text-[#94A3B8] uppercase">
            PROTECT · MONITOR · TRADE · SLEEP BETTER
          </span>
        </motion.div>

        {/* Master Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.08] drop-shadow-[0_12px_35px_rgba(0,0,0,0.9)]"
        >
          A Safer Tomorrow <br />
          for <span className="bg-gradient-to-r from-[#C4B5FD] via-[#A78BFA] to-[#7C3AED] bg-clip-text text-transparent drop-shadow-[0_0_25px_rgba(124,58,237,0.6)]">Your Trades.</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5 text-sm sm:text-base text-[#CBD5E1] max-w-2xl font-normal leading-relaxed drop-shadow-md"
        >
          Real-time risk monitoring, automated protection and on-chain transparency for your crypto &amp; stock portfolios. Because opportunities shouldn&apos;t turn into liquidations.
        </motion.p>

        {/* Call to Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 flex flex-wrap items-center justify-center gap-4"
        >
          <a
            href="#console"
            className="px-7 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:from-[#8B5CF6] hover:to-[#7C3AED] shadow-[0_0_30px_rgba(124,58,237,0.6)] border border-[#A78BFA]/50 flex items-center gap-2 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            Launch Live Console <ArrowRight className="w-4 h-4 text-[#C4B5FD]" />
          </a>

          <Link
            href="/tonight"
            className="px-6 py-3 rounded-xl text-sm font-semibold text-[#E2E8F0] bg-[#0B0A14]/90 hover:bg-[#181530] border border-[#231F42] hover:border-[#7C3AED]/60 backdrop-blur-xl flex items-center gap-2 transition-all shadow-[0_6px_20px_rgba(0,0,0,0.6)]"
          >
            <Play className="w-3.5 h-3.5 fill-[#A78BFA] text-[#A78BFA]" />
            Watch Demo
          </Link>
        </motion.div>
      </div>

      {/* 5. Globe Center Status & 4-Pillar Floating Glass Dock */}
      <div className="relative z-30 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex flex-col items-center mt-auto pb-4">
        {/* Central Tag Above Dock */}
        <div className="flex flex-col items-center mb-6">
          <span className="text-[10px] font-mono font-semibold tracking-[0.3em] text-[#94A3B8] uppercase">
            GLOBAL MARKETS. PROTECTED.
          </span>
          <div className="w-px h-6 bg-gradient-to-b from-[#7C3AED]/60 to-transparent mt-2" />
        </div>

        {/* 4-Pillar Floating Glass Dock */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: "easeOut" }}
          className="w-full max-w-4xl grid grid-cols-2 md:grid-cols-4 gap-3 p-3.5 sm:p-4 rounded-2xl bg-[#0B0A14]/90 border border-[#231F42] shadow-[0_20px_40px_rgba(0,0,0,0.8),0_0_30px_rgba(124,58,237,0.15)] backdrop-blur-xl"
        >
          {pillars.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#121024]/60 transition-colors group cursor-default"
              >
                <div
                  className="w-10 h-10 rounded-xl bg-[#121024] border border-[#231F42] flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
                  style={{
                    boxShadow: `0 0 15px ${item.glow}`,
                  }}
                >
                  <Icon className={`w-5 h-5 ${item.color}`} />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-white leading-tight">{item.title}</div>
                  <div className="text-[11px] text-[#94A3B8] leading-tight mt-0.5">{item.subtitle}</div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>

      {/* 6. Continuous Live Market Ticker with Real Yahoo Finance Data & TextLoop */}
      <LiveMarketTicker />
    </section>
  );
}
