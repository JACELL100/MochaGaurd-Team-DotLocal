import React from "react";
import { Shield, Radio, Activity, Cpu, Sparkles } from "lucide-react";

export default function TonightLoading() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full animate-fade-in">
      {/* Top Telemetry Beacon */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#231F42]/80 bg-[#0B0A14]/90 px-4 py-2.5 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7C3AED] opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#A78BFA]" />
          </div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#CBD5E1] flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-[#A78BFA]" />
            Calibrating 15:45 ET De-Risk Engine · Reading Live Book
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-[#64748B]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#34D399]" />
          <span>REAL-TIME PIPELINE</span>
        </div>
      </div>

      {/* Account Header Skeleton */}
      <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-6 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-6 w-48 rounded-lg bg-[#181530]" />
              <div className="h-5 w-20 rounded-full bg-[#181530]" />
            </div>
            <div className="h-4 w-64 rounded bg-[#121024]" />
          </div>
          <div className="flex items-center gap-4">
            <div className="space-y-1 text-right">
              <div className="h-3 w-16 ml-auto rounded bg-[#121024]" />
              <div className="h-7 w-28 rounded bg-[#181530]" />
            </div>
            <div className="h-10 w-px bg-[#231F42]" />
            <div className="space-y-1 text-right">
              <div className="h-3 w-16 ml-auto rounded bg-[#121024]" />
              <div className="h-7 w-24 rounded bg-[#181530]" />
            </div>
          </div>
        </div>
      </div>

      {/* Action Deck Cards (Telegram Sentinel & Stress Test Launcher) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#181530]" />
            <div className="space-y-1.5">
              <div className="h-4 w-44 rounded bg-[#181530]" />
              <div className="h-3 w-32 rounded bg-[#121024]" />
            </div>
          </div>
          <div className="h-14 rounded-xl bg-[#121024]/60 border border-[#231F42]/40" />
          <div className="flex items-center justify-between pt-1">
            <div className="h-3 w-28 rounded bg-[#121024]" />
            <div className="h-8 w-32 rounded-xl bg-[#181530]" />
          </div>
        </div>

        <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#181530]" />
            <div className="space-y-1.5">
              <div className="h-4 w-40 rounded bg-[#181530]" />
              <div className="h-3 w-36 rounded bg-[#121024]" />
            </div>
          </div>
          <div className="h-14 rounded-xl bg-[#121024]/60 border border-[#231F42]/40" />
          <div className="flex items-center justify-between pt-1">
            <div className="h-3 w-32 rounded bg-[#121024]" />
            <div className="h-8 w-32 rounded-xl bg-[#181530]" />
          </div>
        </div>
      </div>

      {/* 15:45 Ramp Timeline Skeleton */}
      <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-4 w-52 rounded bg-[#181530]" />
          <div className="h-4 w-28 rounded bg-[#121024]" />
        </div>
        <div className="h-3 rounded-full bg-[#121024] w-full" />
        <div className="grid grid-cols-4 gap-2 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-16 rounded bg-[#181530]" />
              <div className="h-2.5 w-24 rounded bg-[#121024]" />
            </div>
          ))}
        </div>
      </div>

      {/* Positions Blotter Table Skeleton */}
      <div className="terminal-skeleton-shimmer rounded-2xl border border-[#231F42] bg-[#0B0A14] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#231F42] pb-3">
          <div className="h-4 w-44 rounded bg-[#181530]" />
          <div className="h-3 w-20 rounded bg-[#121024]" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-[#121024]/40 border border-[#231F42]/50 p-3.5">
              <div className="flex items-center gap-3">
                <div className="h-7 w-16 rounded-lg bg-[#181530]" />
                <div className="space-y-1">
                  <div className="h-3 w-28 rounded bg-[#181530]" />
                  <div className="h-2.5 w-20 rounded bg-[#121024]" />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="h-4 w-20 rounded bg-[#181530]" />
                <div className="h-6 w-24 rounded-lg bg-[#181530]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
