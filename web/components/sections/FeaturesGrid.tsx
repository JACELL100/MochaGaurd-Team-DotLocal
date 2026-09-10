"use client";

import React from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { GlowingCard } from "../ui/GlowingCard";
import { StatusBadge } from "../ui/StatusBadge";
import { ShieldCheck, Moon, Snowflake, Cpu, Lock, Flame, Sparkles } from "lucide-react";

export function FeaturesGrid() {
  const features = [
    {
      icon: ShieldCheck,
      title: "Deterministic Engine",
      subtitle: "Zero wall-clock drift, zero DB lag during calculation",
      desc: "Evaluates every account against dynamic adverse p99 moves, liquidity haircuts, and leverage limits in pure memory at microsecond speeds.",
      badge: "< 1.2ms Execution",
      tone: "safe" as const,
    },
    {
      icon: Moon,
      title: "Overnight Margin Ramp",
      subtitle: "The 2 AM Problem, neutralized",
      desc: "As the closing bell nears, initial margins ramp dynamically for high-risk assets and names reporting earnings tonight, preventing unhedged morning liquidations.",
      badge: "Dynamic Ramping",
      tone: "warn" as const,
    },
    {
      icon: Snowflake,
      title: "Freeze Guard",
      subtitle: "Anti-manipulation & split protection",
      desc: "Positions in stocks experiencing stock splits, circuit breaker trading halts, or stale price feeds are instantly frozen from liquidation or forced de-leveraging.",
      badge: "Fail-Safe Protected",
      tone: "accent" as const,
    },
    {
      icon: Cpu,
      title: "Fact-Bounded Copilot",
      subtitle: "Groq LLM with strict factual anchoring",
      desc: "The copilot only narrates decided facts and metrics output by the core engine. It never invents trades, estimates prices, or hallucinates margin values.",
      badge: "Strict Citations",
      tone: "safe" as const,
    },
  ];

  return (
    <section className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Background Ambience */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.08)_0%,transparent_70%)] pointer-events-none" />

      <div className="text-center max-w-3xl mx-auto mb-16">
        <StatusBadge tone="accent">Core Architecture</StatusBadge>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mt-3">
          Engineered for Absolute Reliability
        </h2>
        <p className="text-sm sm:text-base text-[#94A3B8] mt-3">
          Four pillars of risk architecture that protect brokerages and capital during extreme market tail events.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
        {features.map((f, i) => {
          const Icon = f.icon;
          return (
            <GlowingCard key={i} className="flex flex-col justify-between h-full">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[#7C3AED]/15 border border-[#7C3AED]/35 flex items-center justify-center text-[#C4B5FD] shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                    <Icon className="w-6 h-6" />
                  </div>
                  <StatusBadge tone={f.tone} pulsing={false}>
                    {f.badge}
                  </StatusBadge>
                </div>

                <h3 className="text-xl font-bold text-white tracking-tight">{f.title}</h3>
                <p className="text-xs font-mono text-[#A78BFA] mt-0.5">{f.subtitle}</p>
                <p className="text-sm text-[#CBD5E1] mt-3 leading-relaxed">{f.desc}</p>
              </div>

              <div className="mt-6 pt-4 border-t border-[#1C1836] flex items-center justify-between text-xs text-[#64748B]">
                <span>Component: <span className="text-[#94A3B8] font-mono">api/app/engine/</span></span>
                <span className="text-[#A78BFA] font-mono">100% Tested</span>
              </div>
            </GlowingCard>
          );
        })}
      </div>
    </section>
  );
}
