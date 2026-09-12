import React from "react";
import { ShieldAlert, Flame, Cpu, Gauge } from "lucide-react";

export default function StressTestLoading() {
  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8 animate-fade-in">
      {/* Page Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#231F42]/80 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#A78BFA] animate-ping" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#A78BFA]">
              Interactive Stress Engine
            </span>
          </div>
          <div className="h-8 w-64 rounded-lg bg-[#181530]" />
          <div className="h-4 w-96 max-w-full rounded bg-[#121024]" />
        </div>
        <div className="h-8 w-44 rounded-full bg-[#181530]" />
      </div>

      {/* Top Account & Switcher Bar Skeleton */}
      <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#181530] border border-[#231F42]">
              <Flame className="w-5 h-5 text-[#A78BFA] opacity-60" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-5 w-48 rounded bg-[#181530]" />
                <div className="h-4 w-20 rounded-full bg-[#121024]" />
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-28 rounded bg-[#121024]" />
                <div className="h-3 w-28 rounded bg-[#121024]" />
                <div className="h-3 w-24 rounded bg-[#121024]" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-20 rounded-xl bg-[#121024]" />
            <div className="h-9 w-36 rounded-xl bg-[#181530]" />
          </div>
        </div>
      </div>

      {/* The 2:00 AM Gap Shock Controller Card Skeleton */}
      <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-gradient-to-b from-[#0F0D20] to-[#080711] p-6 space-y-6 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#A78BFA] opacity-70" />
              <div className="h-3 w-52 rounded bg-[#181530]" />
            </div>
            <div className="h-6 w-72 rounded bg-[#181530]" />
            <div className="h-3 w-80 max-w-full rounded bg-[#121024]" />
          </div>
          <div className="h-14 w-40 rounded-2xl bg-[#181530] border border-[#7C3AED]/30" />
        </div>

        {/* Shock Slider Track Placeholder with Calibrated Ticks */}
        <div className="space-y-3 pt-2">
          <div className="h-3 w-full rounded-full bg-[#121024] relative overflow-hidden">
            <div className="absolute top-0 bottom-0 left-0 w-2/5 bg-[#7C3AED]/40 rounded-full" />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-[#64748B]">
            <span>-35% Crash</span>
            <span>-20% Correction</span>
            <span>-8% Gap (Default)</span>
            <span>0% Flat</span>
            <span>+10% Rally</span>
          </div>
        </div>

        {/* 4 Crisis Metric Cards Skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[#231F42] bg-[#05050A]/80 p-3.5 space-y-2">
              <div className="h-2.5 w-20 rounded bg-[#121024]" />
              <div className="h-5 w-24 rounded bg-[#181530]" />
              <div className="h-2 w-16 rounded bg-[#121024]/60" />
            </div>
          ))}
        </div>
      </div>

      {/* 15:45 Automated De-Risk Plan Skeleton */}
      <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#231F42] pb-3">
          <div className="space-y-1">
            <div className="h-4 w-48 rounded bg-[#181530]" />
            <div className="h-3 w-64 rounded bg-[#121024]" />
          </div>
          <div className="h-6 w-32 rounded-full bg-[#181530]" />
        </div>
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-[#121024]/50 border border-[#231F42]/40 p-3">
              <div className="h-4 w-28 rounded bg-[#181530]" />
              <div className="h-4 w-20 rounded bg-[#121024]" />
              <div className="h-4 w-24 rounded bg-[#181530]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
