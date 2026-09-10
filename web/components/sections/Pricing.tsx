"use client";

import React from "react";
import Link from "next/link";
import { GlowingCard } from "../ui/GlowingCard";
import { StatusBadge } from "../ui/StatusBadge";
import { Check, Zap, Shield, Building2 } from "lucide-react";

export function Pricing() {
  const tiers = [
    {
      name: "Retail Trader",
      tagline: "For active margin & options traders",
      price: "$0",
      period: "free tier",
      icon: Zap,
      features: [
        "Live portfolio surveillance",
        "Overnight gap buffer warnings",
        "Earnings volatility alerts",
        "Sepolia on-chain verification",
        "Fact-grounded AI copilot",
      ],
      popular: false,
      cta: "Launch Console",
      href: "/#console",
    },
    {
      name: "Prop Fund / Pro",
      tagline: "For professional multi-account desks",
      price: "$290",
      period: "per desk / month",
      icon: Shield,
      features: [
        "All Trader features",
        "Sub-millisecond custom engine tuning",
        "Multi-asset overnight ramp schedules",
        "Webhooks & automated hedging hooks",
        "Priority Alpha Vantage premium feed",
        "Custom Merkle anchor frequency",
      ],
      popular: true,
      cta: "Start Pro Trial",
      href: "/login",
    },
    {
      name: "Brokerage Enterprise",
      tagline: "For regulated brokerage infrastructure",
      price: "Custom",
      period: "annual license",
      icon: Building2,
      features: [
        "Full server-to-server sync endpoint",
        "Multi-tenant Supabase RLS deployment",
        "Dedicated private Sepolia/Mainnet anchor",
        "High-throughput 10,000+ accounts book",
        "SLA & dedicated risk engineering support",
        "Auditor compliance export portal",
      ],
      popular: false,
      cta: "Contact Enterprise",
      href: "/login",
    },
  ];

  return (
    <section className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="text-center max-w-3xl mx-auto mb-16">
        <StatusBadge tone="accent">Deployment Tiers</StatusBadge>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mt-3">
          Predictable, Transparent Pricing
        </h2>
        <p className="text-sm sm:text-base text-[#94A3B8] mt-3">
          Deploy locally, connect your brokerage service, or scale with enterprise risk surveillance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
        {tiers.map((t, idx) => {
          const Icon = t.icon;
          return (
            <GlowingCard
              key={idx}
              className={`flex flex-col justify-between relative ${
                t.popular ? "border-[#7C3AED] shadow-[0_0_35px_rgba(124,58,237,0.3)]" : ""
              }`}
            >
              {t.popular && (
                <div className="absolute top-0 right-8 -translate-y-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-[10px] font-bold uppercase tracking-wider text-white border border-[#A78BFA]/50 shadow-[0_0_15px_#7C3AED]">
                  Most Popular
                </div>
              )}

              <div>
                <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/15 border border-[#7C3AED]/30 flex items-center justify-center text-[#C4B5FD] mb-4">
                  <Icon className="w-5 h-5" />
                </div>

                <h3 className="text-xl font-bold text-white">{t.name}</h3>
                <p className="text-xs text-[#94A3B8] mt-1">{t.tagline}</p>

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold font-mono text-white">{t.price}</span>
                  <span className="text-xs text-[#64748B] font-mono">/ {t.period}</span>
                </div>

                <ul className="mt-8 space-y-3">
                  {t.features.map((feat, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-xs text-[#CBD5E1]">
                      <div className="w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-10 pt-6 border-t border-[#1C1836]">
                <Link
                  href={t.href}
                  className={`w-full py-3 rounded-xl text-xs font-semibold flex items-center justify-center transition-all ${
                    t.popular
                      ? "bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:from-[#8B5CF6] hover:to-[#7C3AED] text-white shadow-[0_0_20px_rgba(124,58,237,0.4)]"
                      : "bg-[#121024] hover:bg-[#181530] text-white border border-[#231F42] hover:border-[#7C3AED]/50"
                  }`}
                >
                  {t.cta}
                </Link>
              </div>
            </GlowingCard>
          );
        })}
      </div>
    </section>
  );
}
