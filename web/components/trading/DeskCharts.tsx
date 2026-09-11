"use client";

import { useState } from "react";

import type { DeskResponse } from "@/lib/types";
import { lev, money } from "@/lib/format";
import { SymbolChart } from "./SymbolChart";

/**
 * The chart deck: one instrument in focus, the rest as a watchlist rail beside it.
 *
 * The window buttons re-request from the server rather than slicing client-side, because the
 * leverage line has to be recomputed at each bar's own timestamp — a wider window is not the
 * same data zoomed out, it is more decisions.
 */
export function DeskCharts({
  desk,
  onWindowChange,
}: {
  desk: DeskResponse;
  onWindowChange?: (hours: number) => void;
}) {
  const [focus, setFocus] = useState(desk.series[0]?.symbol ?? "");
  const active = desk.series.find((s) => s.symbol === focus) ?? desk.series[0];

  if (!active) {
    return (
      <p className="text-xs text-[#94A3B8]">
        No recorded price bars for the symbols in this account yet.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
      <SymbolChart
        series={active}
        headlineCap={desk.headline_cap}
        onWindowChange={onWindowChange}
        activeHours={desk.hours}
      />

      {/* Watchlist: every held symbol, with its own allowed limit. */}
      <div className="space-y-1.5">
        <div className="px-1 text-[10px] font-mono uppercase tracking-wider text-[#64748B]">
          Your positions
        </div>
        {desk.series.map((s) => {
          const isActive = s.symbol === active.symbol;
          const up = s.window_change >= 0;
          const pnlUp = (s.unrealised_pnl ?? 0) >= 0;
          return (
            <button
              key={s.symbol}
              type="button"
              onClick={() => setFocus(s.symbol)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                isActive
                  ? "border-[#7C3AED]/50 bg-[#121024]"
                  : "border-[#231F42] hover:border-[#7C3AED]/30 hover:bg-[#121024]/60"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-white">{s.symbol}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    up ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {up ? "+" : "−"}
                  {(Math.abs(s.window_change) * 100).toFixed(2)}%
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-[10px]">
                <span className="text-[#64748B]">{money(s.price, true)}</span>
                {s.unrealised_pnl !== null && (
                  <span className={pnlUp ? "text-emerald-400/80" : "text-rose-400/80"}>
                    {pnlUp ? "+" : "−"}
                    {money(Math.abs(s.unrealised_pnl))}
                  </span>
                )}
              </div>
              {/* The limit, as a bar against the advertised cap. */}
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded bg-[#05050A]">
                  <div
                    className="h-full rounded bg-gradient-to-r from-[#7C3AED] to-[#A78BFA]"
                    style={{
                      width: `${Math.min(100, (s.max_leverage / desk.headline_cap) * 100)}%`,
                    }}
                  />
                </div>
                <span
                  className={`font-mono text-[10px] ${
                    s.frozen ? "text-amber-400" : "text-[#C4B5FD]"
                  }`}
                >
                  {s.frozen ? "0x" : lev(s.max_leverage)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
