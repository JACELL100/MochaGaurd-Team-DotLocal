"use client";

import { useState } from "react";

import type { PositionRisk } from "@/lib/types";
import { money } from "@/lib/format";

/**
 * Why a position is risky — ranked, in plain language, with what to do about it.
 *
 * The engine's output alone is an instruction ("reduce TSLA by 653 shares"). That tells a
 * trader what to do and nothing about why, which is exactly the complaint people have about
 * risk systems. This shows the factors behind it, ordered by how much each contributes, so the
 * reader can see *which* lever to pull rather than just being told to sell.
 *
 * Colour encodes severity (one violet ramp, light to dark), but the ranking is also carried by
 * bar width, order, a percentage, and a written band — so it survives being read in greyscale
 * or by someone colourblind.
 */

const RAMP = ["#EDE9FE", "#C4B5FD", "#A78BFA", "#8B5CF6", "#7C3AED"] as const;

const LEVEL = {
  severe: { text: "text-rose-400", ring: "border-rose-500/40", word: "Severe" },
  high: { text: "text-orange-300", ring: "border-orange-500/35", word: "High" },
  moderate: { text: "text-amber-300", ring: "border-amber-500/30", word: "Moderate" },
  low: { text: "text-emerald-400", ring: "border-emerald-500/25", word: "Low" },
  unknown: { text: "text-[#94A3B8]", ring: "border-[#231F42]", word: "Unknown" },
} as const;

function colorFor(weight: number): string {
  return RAMP[Math.min(RAMP.length - 1, Math.floor(weight * RAMP.length))];
}

export function RiskBreakdown({ risk }: { risk: PositionRisk }) {
  const [open, setOpen] = useState<number | null>(0);
  const level = LEVEL[risk.level] ?? LEVEL.unknown;

  return (
    <div className={`rounded-xl border ${level.ring} bg-[#05050A]/60 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">{risk.symbol}</span>
            <span className={`font-mono text-[10px] uppercase tracking-wider ${level.text}`}>
              {level.word} risk
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#CBD5E1]">{risk.summary}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
            Worst case
          </div>
          <div className={`font-mono text-base font-bold tabular-nums ${level.text}`}>
            −{money(risk.worst_case_loss)}
          </div>
        </div>
      </div>

      {/* One stacked bar: the whole risk on this leg, split by cause. */}
      {risk.factors.length > 0 && (
        <>
          <div className="mt-3 flex h-2.5 items-stretch gap-[2px] overflow-hidden rounded">
            {risk.factors.map((f, i) => (
              <button
                key={f.kind}
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                title={`${f.label} — ${(f.weight * 100).toFixed(0)}% of this position's risk`}
                aria-label={`${f.label}, ${(f.weight * 100).toFixed(0)} percent`}
                className="h-full transition-opacity first:rounded-l last:rounded-r"
                style={{
                  width: `${Math.max(3, f.weight * 100)}%`,
                  backgroundColor: colorFor(f.weight),
                  opacity: open === null || open === i ? 1 : 0.45,
                }}
              />
            ))}
          </div>

          <ol className="mt-3 space-y-1">
            {risk.factors.map((f, i) => {
              const isOpen = open === i;
              return (
                <li key={f.kind}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-baseline gap-2.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-[#121024]/70"
                  >
                    <span
                      className="mt-1 size-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: colorFor(f.weight) }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-[#E2E8F0]">
                      {f.label}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-[#94A3B8]">
                      {f.value}
                    </span>
                    <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-[#C4B5FD]">
                      {(f.weight * 100).toFixed(0)}%
                    </span>
                  </button>

                  {isOpen && (
                    <div className="ml-6 mt-1 space-y-1.5 rounded-lg border border-[#231F42] bg-[#0B0A14] px-3 py-2">
                      <p className="text-xs leading-relaxed text-[#CBD5E1]">{f.detail}</p>
                      <p className="text-xs leading-relaxed text-emerald-300/90">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
                          What helps ·{" "}
                        </span>
                        {f.what_helps}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="mt-2 px-1.5 text-[11px] text-[#64748B]">
            Tap any cause for the detail and what reduces it. Percentages are that cause&apos;s
            share of the risk on this position.
          </p>
        </>
      )}
    </div>
  );
}

/** The whole book's risk, one card per position, worst first. */
export function RiskPanel({ risk }: { risk: PositionRisk[] }) {
  if (risk.length === 0) return null;
  const total = risk.reduce((sum, r) => sum + r.worst_case_loss, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Why you are at risk tonight</h3>
          <p className="text-xs text-[#94A3B8]">
            Not just what to sell — what is actually driving the risk on each position, biggest
            first, and what reduces it.
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
            If every position gaps
          </div>
          <div className="font-mono text-lg font-bold tabular-nums text-amber-300">
            −{money(total)}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {risk.map((r) => (
          <RiskBreakdown key={r.symbol} risk={r} />
        ))}
      </div>
    </div>
  );
}
