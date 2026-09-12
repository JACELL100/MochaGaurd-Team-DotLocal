import React from "react";
import { Calculator, Cpu, Sliders } from "lucide-react";

export default function SimulateLoading() {
  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6 animate-fade-in">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#231F42]/80 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#A78BFA] animate-ping" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#A78BFA]">
              Interactive Limit Engine
            </span>
          </div>
          <div className="h-8 w-72 rounded-lg bg-[#181530]" />
          <div className="h-4 w-96 max-w-full rounded bg-[#121024]" />
        </div>
        <div className="h-8 w-32 rounded-full bg-[#181530]" />
      </div>

      {/* Grid: Parameters Form (Left) & Results Waterfall (Right) */}
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left: Input Form Card */}
        <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs font-mono uppercase text-[#A78BFA]">
            <Calculator className="w-4 h-4 text-[#A78BFA]" />
            <span>Simulation Parameters</span>
          </div>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="h-3 w-16 rounded bg-[#121024]" />
              <div className="h-9 w-full rounded-xl bg-[#181530]" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-28 rounded bg-[#121024]" />
              <div className="h-9 w-full rounded-xl bg-[#181530]" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-24 rounded bg-[#121024]" />
              <div className="h-9 w-full rounded-xl bg-[#181530]" />
            </div>
            <div className="h-10 w-full rounded-xl bg-[#7C3AED]/20 border border-[#7C3AED]/30" />
          </div>
        </div>

        {/* Right: Allowed Leverage Hero Card */}
        <div className="space-y-6">
          <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-gradient-to-b from-[#0F0D20] to-[#080711] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="h-4 w-60 rounded bg-[#181530]" />
              <div className="h-6 w-24 rounded-full bg-[#181530]" />
            </div>
            <div className="h-16 w-36 rounded-2xl bg-[#181530]" />
            <div className="h-4 w-48 rounded bg-[#121024]" />
            <div className="flex gap-2 pt-2">
              <div className="h-6 w-28 rounded-full bg-[#121024]" />
              <div className="h-6 w-32 rounded-full bg-[#121024]" />
            </div>
          </div>

          {/* Waterfall Attribution Skeleton */}
          <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 space-y-4">
            <div className="h-4 w-52 rounded bg-[#181530]" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-[#121024]/40 border border-[#231F42]/40">
                  <div className="h-3.5 w-36 rounded bg-[#181530]" />
                  <div className="h-3.5 w-16 rounded bg-[#181530]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
