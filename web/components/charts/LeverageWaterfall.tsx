"use client";

import { useState } from "react";

import type { LeverageAttribution, AttributionStep } from "@/lib/types";

/**
 * Why only this much leverage — as a waterfall from the advertised cap to the limit granted.
 *
 * Each bar is leverage removed by one factor, with every earlier factor already applied, so the
 * bars reconcile exactly: cap − Σ lost = granted. The engine computes the steps by re-running
 * the real formula one factor at a time; nothing here re-derives a number.
 *
 * Colour encodes magnitude, not identity — one violet ramp, light (small cut) to dark (large
 * cut) — because every bar measures the same quantity. Severity is also encoded by bar width
 * and a direct label, so the ranking never depends on colour alone. The freeze case is the one
 * exception and uses the reserved status red with its own label.
 */

const RAMP = ["#EDE9FE", "#C4B5FD", "#A78BFA", "#8B5CF6", "#7C3AED"] as const;
const FREEZE = "#d03b3b";

function colorFor(step: AttributionStep, share: number): string {
  if (step.kind === "freeze") return FREEZE;
  // Darker = a bigger bite out of the limit.
  const index = Math.min(RAMP.length - 1, Math.floor(share * RAMP.length));
  return RAMP[index];
}

function fmtLev(value: number): string {
  return Number.isInteger(value) ? `${value}x` : `${value.toFixed(2)}x`;
}

export function LeverageWaterfall({ attribution }: { attribution: LeverageAttribution }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const { cap, granted, utilisation, steps } = attribution;

  const pct = (value: number) => `${(Math.max(0, Math.min(1, value / cap)) * 100).toFixed(1)}%`;

  return (
    <div className="rounded-xl border border-[#231F42] bg-[#05050A]/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-[#121024]/50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">
            Why only {fmtLev(granted)}?
          </span>
          <span className="mt-0.5 block text-xs text-[#94A3B8]">
            {fmtLev(granted)} of the {fmtLev(cap)} maximum —{" "}
            <span className="font-mono text-[#C4B5FD]">{(utilisation * 100).toFixed(0)}%</span> of
            what we advertise. {open ? "Hide" : "Show"} the breakdown.
          </span>
        </span>
        <span
          className={`shrink-0 text-[#A78BFA] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {/* Collapsed: a single bar showing how much of the cap survives. */}
      <div className="px-4 pb-3">
        <div className="flex h-2.5 overflow-hidden rounded bg-[#121024]">
          <div
            className="h-full rounded-l bg-gradient-to-r from-[#7C3AED] to-[#A78BFA]"
            style={{ width: pct(granted) }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-[#64748B]">
          <span>0x</span>
          <span className="text-[#C4B5FD]">granted {fmtLev(granted)}</span>
          <span>cap {fmtLev(cap)}</span>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#1C1836] px-4 py-4">
          {steps.length === 0 ? (
            <p className="text-xs text-[#94A3B8]">
              Nothing reduced this request — it earns the full advertised maximum.
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                  What took the leverage away
                </h4>
                <span className="font-mono text-[10px] text-[#64748B]">
                  {fmtLev(cap)} → {fmtLev(granted)}
                </span>
              </div>

              <ol className="space-y-2.5">
                {steps.map((step, i) => {
                  const share = step.lost / cap;
                  const isActive = active === i;
                  return (
                    <li key={`${step.kind}-${i}`}>
                      <button
                        type="button"
                        onClick={() => setActive(isActive ? null : i)}
                        aria-expanded={isActive}
                        className="w-full text-left"
                      >
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate font-medium text-[#E2E8F0]">
                            {step.label}
                          </span>
                          <span className="shrink-0 font-mono tabular-nums text-[#FDA4AF]">
                            −{fmtLev(step.lost)}
                          </span>
                        </div>

                        {/* The bar: full width = the whole cap. A 2px surface gap separates the
                            removed slice from the remaining-headroom track beside it. */}
                        <div className="mt-1 flex h-3 items-stretch gap-[2px]">
                          <div
                            className="rounded-l-[4px] rounded-r-[4px] transition-opacity"
                            style={{
                              width: pct(step.lost),
                              backgroundColor: colorFor(step, share),
                              opacity: active === null || isActive ? 1 : 0.55,
                            }}
                          />
                          <div
                            className="rounded-r-[4px] bg-[#121024]"
                            style={{ width: pct(step.remaining) }}
                          />
                        </div>

                        <div className="mt-1 flex justify-between font-mono text-[10px] text-[#64748B]">
                          <span>{(share * 100).toFixed(0)}% of the cap</span>
                          <span>{fmtLev(step.remaining)} still available</span>
                        </div>
                      </button>

                      {isActive && (
                        <p className="mt-2 rounded-lg border border-[#231F42] bg-[#0B0A14] px-3 py-2 text-xs leading-relaxed text-[#CBD5E1]">
                          {step.detail}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>

              <div className="mt-4 flex items-baseline justify-between border-t border-[#1C1836] pt-3">
                <span className="text-xs font-semibold text-white">Leverage granted</span>
                <span className="font-mono text-sm font-bold tabular-nums text-[#C4B5FD]">
                  {fmtLev(granted)}
                </span>
              </div>

              <p className="mt-2 text-[11px] leading-4 text-[#64748B]">
                Tap any factor for the reason. The bars reconcile exactly —{" "}
                {fmtLev(cap)} minus every cut above leaves {fmtLev(granted)}. Darker bars took
                more leverage away.
              </p>

              {/* Table view: identity and magnitude without relying on colour at all. */}
              <details className="mt-3">
                <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-[#64748B] hover:text-[#94A3B8]">
                  View as table
                </summary>
                <table className="mt-2 w-full text-left text-[11px]">
                  <thead className="text-[#64748B]">
                    <tr>
                      <th className="py-1 pr-3 font-normal">Factor</th>
                      <th className="py-1 pr-3 text-right font-normal">Removed</th>
                      <th className="py-1 text-right font-normal">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums text-[#CBD5E1]">
                    {steps.map((step, i) => (
                      <tr key={`row-${i}`} className="border-t border-[#1C1836]">
                        <td className="py-1 pr-3 font-sans">{step.label}</td>
                        <td className="py-1 pr-3 text-right">−{fmtLev(step.lost)}</td>
                        <td className="py-1 text-right">{fmtLev(step.remaining)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#231F42] text-white">
                      <td className="py-1 pr-3 font-sans font-semibold">Granted</td>
                      <td className="py-1 pr-3" />
                      <td className="py-1 text-right font-semibold">{fmtLev(granted)}</td>
                    </tr>
                  </tbody>
                </table>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}
