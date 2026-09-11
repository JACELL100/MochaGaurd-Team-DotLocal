"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DeskSeries } from "@/lib/types";
import { etTime, lev, money, pct } from "@/lib/format";

/**
 * Price and allowed leverage for one held symbol.
 *
 * Two stacked panels on a shared time axis, never a dual y-axis: price in dollars and leverage
 * in multiples are different scales, and overlaying them on one axis invents a relationship
 * between two numbers that have none. Stacked panels keep the comparison — the eye reads down
 * the same instant in time — without implying the lines are on the same footing.
 *
 * The leverage panel is the point of the product: it is a step function that falls through the
 * 15:30 ramp and sits at the overnight level while the market is shut, so a trader can see the
 * limit dropping *before* the bell rather than discovering it afterwards.
 */

const WINDOWS = [
  { label: "1D", hours: 24 },
  { label: "2D", hours: 48 },
  { label: "1W", hours: 168 },
] as const;

interface Row {
  ts: string;
  t: number;
  price: number;
  max_leverage: number;
  phase: string;
  frozen: boolean;
}

function ChartTooltip({
  active,
  payload,
  cap,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  cap: number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-[#231F42] bg-[#0B0A14]/95 px-3 py-2 text-xs shadow-xl">
      <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
        {etTime(row.ts)} ET
      </div>
      <div className="mt-1 font-mono tabular-nums text-white">{money(row.price, true)}</div>
      <div className="mt-0.5 font-mono tabular-nums text-[#C4B5FD]">
        {row.frozen ? "frozen — 0x" : `${lev(row.max_leverage)} allowed`}
        <span className="ml-1 text-[10px] text-[#64748B]">of {lev(cap)}</span>
      </div>
      <div className="mt-0.5 text-[10px] capitalize text-[#64748B]">
        {row.phase.replace("_", " ")}
      </div>
    </div>
  );
}

export function SymbolChart({
  series,
  headlineCap,
  onWindowChange,
  activeHours,
}: {
  series: DeskSeries;
  headlineCap: number;
  onWindowChange?: (hours: number) => void;
  activeHours?: number;
}) {
  const [showLeverage, setShowLeverage] = useState(true);

  const rows: Row[] = series.points.map((p) => ({
    ...p,
    t: new Date(p.ts).getTime(),
  }));

  const up = series.window_change >= 0;
  const priceColor = up ? "#0ca30c" : "#d03b3b";
  const pnlUp = (series.unrealised_pnl ?? 0) >= 0;

  // Pad the price band so the line never touches the panel edge.
  const pad = Math.max(0.01, (series.window_high - series.window_low) * 0.12);

  return (
    <div className="rounded-xl border border-[#231F42] bg-[#0B0A14]/70">
      {/* Instrument header — the strip a terminal puts above every chart. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-[#1C1836] px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-bold text-white">{series.symbol}</span>
          <span className="font-mono text-lg tabular-nums text-white">
            {money(series.price, true)}
          </span>
          <span
            className={`font-mono text-xs tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}
          >
            {up ? "▲" : "▼"} {(Math.abs(series.window_change) * 100).toFixed(2)}%
          </span>
          {series.earnings_tonight && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
              earnings tonight
            </span>
          )}
          {series.frozen && (
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300">
              frozen
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-4 font-mono text-xs">
          <span className="text-[#64748B]">
            pos{" "}
            <span className="text-[#CBD5E1]">{money(series.notional)}</span>
          </span>
          {series.unrealised_pnl !== null && (
            <span className="text-[#64748B]">
              P&amp;L{" "}
              <span className={pnlUp ? "text-emerald-400" : "text-rose-400"}>
                {pnlUp ? "+" : "−"}
                {money(Math.abs(series.unrealised_pnl))}
              </span>
            </span>
          )}
          <span className="text-[#64748B]">
            allowed{" "}
            <span className="font-semibold text-[#C4B5FD]">
              {series.frozen ? "0x" : lev(series.max_leverage)}
            </span>
          </span>
        </div>
      </div>

      {/* Price panel */}
      <div className="px-2 pt-3">
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 4 }} syncId={series.symbol}>
            <defs>
              <linearGradient id={`px-${series.symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={priceColor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={priceColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1C1836" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis
              domain={[series.window_low - pad, series.window_high + pad]}
              tick={{ fill: "#64748B", fontSize: 10, fontFamily: "monospace" }}
              tickFormatter={(v: number) => v.toFixed(0)}
              width={46}
              axisLine={false}
              tickLine={false}
            />
            {series.avg_price !== null && (
              <ReferenceLine
                y={series.avg_price}
                stroke="#64748B"
                strokeDasharray="4 4"
                label={{
                  value: `avg ${series.avg_price.toFixed(2)}`,
                  fill: "#64748B",
                  fontSize: 9,
                  position: "insideTopLeft",
                }}
              />
            )}
            <Tooltip content={<ChartTooltip cap={headlineCap} />} />
            <Area
              type="monotone"
              dataKey="price"
              stroke={priceColor}
              strokeWidth={2}
              fill={`url(#px-${series.symbol})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Leverage panel — the product. A step line, because the limit changes in steps. */}
      {showLeverage && (
        <div className="px-2 pb-1">
          <ResponsiveContainer width="100%" height={92}>
            <AreaChart data={rows} margin={{ top: 4, right: 12, bottom: 4, left: 4 }} syncId={series.symbol}>
              <defs>
                <linearGradient id={`lv-${series.symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1C1836" vertical={false} />
              <XAxis
                dataKey="t"
                tick={{ fill: "#64748B", fontSize: 9, fontFamily: "monospace" }}
                tickFormatter={(v: number) => etTime(new Date(v))}
                axisLine={false}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                domain={[0, headlineCap]}
                ticks={[0, headlineCap / 2, headlineCap]}
                tick={{ fill: "#64748B", fontSize: 10, fontFamily: "monospace" }}
                tickFormatter={(v: number) => `${v}x`}
                width={46}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine
                y={headlineCap}
                stroke="#3F3A5C"
                strokeDasharray="3 3"
                label={{
                  value: `advertised ${headlineCap}x`,
                  fill: "#64748B",
                  fontSize: 9,
                  position: "insideTopRight",
                }}
              />
              <Tooltip content={<ChartTooltip cap={headlineCap} />} />
              <Area
                type="stepAfter"
                dataKey="max_leverage"
                stroke="#A78BFA"
                strokeWidth={2}
                fill={`url(#lv-${series.symbol})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1C1836] px-4 py-2">
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1.5 text-[#64748B]">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: priceColor }} />
            price
          </span>
          <span className="flex items-center gap-1.5 text-[#64748B]">
            <span className="h-0.5 w-4 rounded bg-[#A78BFA]" />
            leverage allowed ({lev(series.leverage_low)}–{lev(series.leverage_high)})
          </span>
          <span className="text-[#3F3A5C]">· p99 move {pct(series.adverse_move, 1)}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowLeverage((v) => !v)}
            className="rounded px-2 py-0.5 text-[10px] text-[#64748B] transition-colors hover:bg-[#121024] hover:text-white"
          >
            {showLeverage ? "hide leverage" : "show leverage"}
          </button>
          {onWindowChange &&
            WINDOWS.map((w) => (
              <button
                key={w.label}
                type="button"
                onClick={() => onWindowChange(w.hours)}
                className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  activeHours === w.hours
                    ? "bg-[#7C3AED]/25 text-[#C4B5FD]"
                    : "text-[#64748B] hover:bg-[#121024] hover:text-white"
                }`}
              >
                {w.label}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
