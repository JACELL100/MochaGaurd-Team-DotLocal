"use client";

import { useState } from "react";
import Link from "next/link";

import type { PositionRow } from "@/lib/types";
import { lev, money, pct, shares } from "@/lib/format";

/**
 * The positions blotter, laid out the way a broker's trading screen is.
 *
 * Two halves per row, deliberately: the left is what any broker shows you (size, cost basis,
 * mark, P&L); the right is what this product adds and most brokers do not — the leverage this
 * *specific* leg is allowed right now, the equity it ties up, and what it loses if it gaps.
 * Keeping them side by side is the pitch: the risk number sits next to the position it governs.
 */

type SortKey = "symbol" | "notional" | "unrealised_pnl" | "max_leverage" | "worst_case_loss";

function pnlTone(value: number | null): string {
  if (value === null) return "text-[#64748B]";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-[#94A3B8]";
}

function signedMoney(value: number | null): string {
  if (value === null) return "–";
  return `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
}

function signedPct(value: number | null): string {
  if (value === null) return "–";
  return `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

/** Share of account equity this single leg ties up as margin. */
function legUtilisation(row: PositionRow, equity: number): number | null {
  if (!row.margin_required || equity <= 0) return null;
  return Math.min(1, row.margin_required / equity);
}

export function PositionsBlotter({
  positions,
  equity,
  headlineCap = 20,
}: {
  positions: PositionRow[];
  equity: number;
  headlineCap?: number;
}) {
  const [sort, setSort] = useState<SortKey>("notional");
  const [desc, setDesc] = useState(true);

  const sorted = [...positions].sort((a, b) => {
    if (sort === "symbol") {
      return desc ? b.symbol.localeCompare(a.symbol) : a.symbol.localeCompare(b.symbol);
    }
    const left = (a[sort] as number | null) ?? 0;
    const right = (b[sort] as number | null) ?? 0;
    return desc ? right - left : left - right;
  });

  const totalPnl = positions.reduce((sum, row) => sum + (row.unrealised_pnl ?? 0), 0);
  const anyBasis = positions.some((row) => row.avg_price !== null);

  function header(key: SortKey, label: string, align = "text-right") {
    const active = sort === key;
    return (
      <th className={`whitespace-nowrap py-2 ${align}`}>
        <button
          type="button"
          onClick={() => {
            if (active) setDesc((v) => !v);
            else {
              setSort(key);
              setDesc(true);
            }
          }}
          className={`font-normal transition-colors hover:text-white ${
            active ? "text-[#C4B5FD]" : "text-[#64748B]"
          }`}
        >
          {label}
          {active && <span aria-hidden>{desc ? " ↓" : " ↑"}</span>}
        </button>
      </th>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Open positions</h3>
          <p className="text-xs text-[#94A3B8]">
            Each leg carries its own leverage limit — set by that stock&apos;s gap risk, its
            liquidity, and the clock.
          </p>
        </div>
        {anyBasis && (
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#64748B]">
              Unrealised P&amp;L
            </div>
            <div className={`font-mono text-lg font-bold tabular-nums ${pnlTone(totalPnl)}`}>
              {signedMoney(totalPnl)}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead className="border-b border-[#231F42] font-mono text-[10px] uppercase tracking-wider">
            <tr>
              {header("symbol", "Symbol", "text-left")}
              <th className="py-2 text-right font-normal text-[#64748B]">Qty</th>
              <th className="py-2 text-right font-normal text-[#64748B]">Avg</th>
              <th className="py-2 text-right font-normal text-[#64748B]">Mark</th>
              {header("unrealised_pnl", "P&L")}
              {header("notional", "Value")}
              {header("max_leverage", "Max lev")}
              <th className="py-2 text-right font-normal text-[#64748B]">Margin used</th>
              {header("worst_case_loss", "If it gaps")}
              <th className="py-2 text-right font-normal text-[#64748B]">Holding cost</th>
              <th className="py-2 pl-3 text-left font-normal text-[#64748B]">Flags</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {sorted.map((row) => {
              const util = legUtilisation(row, equity);
              const capShare = Math.max(0, Math.min(1, row.max_leverage / headlineCap));
              return (
                <tr
                  key={row.symbol}
                  className="border-b border-[#121024] transition-colors last:border-0 hover:bg-[#121024]/50"
                >
                  <td className="py-2.5 font-sans">
                    <Link
                      href={`/simulate?symbol=${row.symbol}&notional=${Math.round(row.notional)}`}
                      className="font-semibold text-white hover:text-[#A78BFA]"
                    >
                      {row.symbol}
                    </Link>
                  </td>
                  <td className="py-2.5 text-right text-[#CBD5E1]">{shares(row.qty)}</td>
                  <td className="py-2.5 text-right text-[#64748B]">
                    {row.avg_price !== null ? money(row.avg_price, true) : "–"}
                  </td>
                  <td className="py-2.5 text-right text-white">{money(row.price, true)}</td>
                  <td className={`py-2.5 text-right ${pnlTone(row.unrealised_pnl)}`}>
                    {signedMoney(row.unrealised_pnl)}
                    <span className="ml-1 text-[10px] opacity-70">
                      {signedPct(row.unrealised_pct)}
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-[#CBD5E1]">{money(row.notional)}</td>

                  <td className="py-2.5 text-right">
                    <div
                      className={`font-semibold ${row.frozen ? "text-amber-400" : "text-[#C4B5FD]"}`}
                    >
                      {row.frozen ? "0x" : lev(row.max_leverage)}
                    </div>
                    <div
                      className="ml-auto mt-1 h-1 w-16 overflow-hidden rounded bg-[#121024]"
                      title={`${lev(row.max_leverage)} of ${lev(headlineCap)} maximum`}
                    >
                      <div
                        className="h-full rounded bg-gradient-to-r from-[#7C3AED] to-[#A78BFA]"
                        style={{ width: `${capShare * 100}%` }}
                      />
                    </div>
                  </td>

                  <td className="py-2.5 text-right text-[#CBD5E1]">
                    {row.margin_required !== null ? money(row.margin_required) : "–"}
                    {util !== null && (
                      <span className="ml-1 text-[10px] text-[#64748B]">
                        {(util * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>

                  <td
                    className="py-2.5 text-right text-amber-300/90"
                    title="Loss if this leg gaps to its 99th-percentile adverse move"
                  >
                    −{money(row.worst_case_loss)}
                    <span className="ml-1 text-[10px] text-[#64748B]">
                      {pct(row.adverse_move, 1)}
                    </span>
                  </td>

                  <td className="py-2.5 text-right">
                    {row.funding ? (
                      <>
                        <div
                          className={
                            row.funding.pays ? "text-amber-300/90" : "text-emerald-400"
                          }
                        >
                          {row.funding.pays ? "−" : "+"}
                          {money(Math.abs(row.funding.daily_cost))}
                          <span className="ml-1 text-[10px] text-[#64748B]">/day</span>
                        </div>
                        <div
                          className={`text-[10px] ${
                            row.funding.pays && row.funding.hours_to_liquidation !== null
                              ? "text-rose-400/90"
                              : "text-[#64748B]"
                          }`}
                        >
                          {row.funding.pays ? row.funding.when : "you earn"}
                        </div>
                      </>
                    ) : (
                      <span className="text-[#3F3A5C]">–</span>
                    )}
                  </td>

                  <td className="py-2.5 pl-3">
                    <span className="flex flex-wrap gap-1">
                      {row.earnings_tonight && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-sans text-[10px] text-amber-300">
                          earnings
                        </span>
                      )}
                      {row.frozen && (
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-sans text-[10px] text-rose-300">
                          frozen
                        </span>
                      )}
                      {!row.earnings_tonight && !row.frozen && (
                        <span className="text-[10px] text-[#3F3A5C]">—</span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-4 text-[#64748B]">
        <span className="text-[#94A3B8]">Max lev</span> is what this stock is allowed right now,
        not a fixed account setting — the bar shows it against the {lev(headlineCap)} we advertise.{" "}
        <span className="text-[#94A3B8]">If it gaps</span> is what the leg loses at its
        99th-percentile adverse move.{" "}
        <span className="text-[#94A3B8]">Holding cost</span> is the funding charged per day, and
        when that cost alone would close the position if the price never moved. Click a symbol
        to see why its limit is what it is.
      </p>
    </div>
  );
}
