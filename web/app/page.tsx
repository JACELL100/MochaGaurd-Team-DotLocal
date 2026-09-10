import Link from "next/link";
import { ConcentrationBars, HealthHistogram } from "@/components/charts/BookCharts";
import { Badge, Empty, Mono, SourceBadge, Stat, VerifyLink } from "@/components/ui";
import { getBook } from "@/lib/api";
import type { BookResponse } from "@/lib/types";
import { actionLabel, actionTone, compactMoney, int, lev, pct, shares } from "@/lib/format";

import { HeroSection } from "@/components/sections/HeroSection";
import { DashboardPreview } from "@/components/sections/DashboardPreview";
import { FeaturesGrid } from "@/components/sections/FeaturesGrid";
import { TrustProof } from "@/components/sections/TrustProof";
import { Pricing } from "@/components/sections/Pricing";
import { Divider } from "@/components/ui/Divider";
import { GlowingCard } from "@/components/ui/GlowingCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ShieldCheck, Activity, Terminal } from "lucide-react";

export const metadata = { title: "MochaGuard · Deterministic Risk & Overnight Margin" };

export default async function HomePage() {
  const { data, live, error } = await getBook();

  return (
    <div className="w-full flex flex-col">
      {/* 1. Master Cinematic Hero with Continuous Animated Black Hole */}
      <HeroSection />

      <Divider />

      {/* 2. Interactive Microsecond Surveillance Telemetry */}
      <DashboardPreview />

      <Divider />

      {/* 3. Core Architecture Pillars */}
      <FeaturesGrid />

      <Divider />

      {/* 4. On-Chain Sepolia Merkle Trust Proof */}
      <TrustProof />

      <Divider />

      {/* 5. Live Book Console Section (Real-Time Engine Telemetry) */}
      <section id="console" className="relative py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full scroll-mt-20">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge tone={live ? "safe" : "danger"}>
                {live ? "Engine Connected" : "Local Standby Mode"}
              </StatusBadge>
              <span className="text-xs font-mono text-[#94A3B8]">· Microsecond Book Evaluation</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Live Book Risk Console
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <SourceBadge live={live} error={error} />
          </div>
        </div>

        {data ? (
          <LiveBookContent data={data} />
        ) : (
          <Unavailable error={error} />
        )}
      </section>

      <Divider />

      {/* 6. Pricing & Deployment Tiers */}
      <Pricing />
    </div>
  );
}

function LiveBookContent({ data }: { data: BookResponse }) {
  const s = data.summary;
  const actionable = data.decisions.filter((d: any) => d.action !== "hold");
  const brokerLossShare = s.gross_exposure ? s.broker_loss_at_p99 / s.gross_exposure : 0;

  return (
    <div className="space-y-6">
      {data.ops_brief && (
        <GlowingCard className="border border-[#7C3AED]/30 bg-[#0B0A14]/90">
          <div className="flex items-center gap-2 text-xs font-mono text-[#A78BFA] uppercase tracking-wider mb-2">
            <Terminal className="w-3.5 h-3.5" />
            Copilot Operational Brief (Grounded Facts Only)
          </div>
          <p className="text-sm leading-relaxed text-[#E2E8F0]">{data.ops_brief}</p>
        </GlowingCard>
      )}

      {data.plain && (
        <GlowingCard
          className={
            data.plain.severity === "critical"
              ? "border border-rose-500/40"
              : data.plain.severity === "warning"
                ? "border border-amber-500/35"
                : "border border-emerald-500/30"
          }
        >
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] mb-2">
            What the engine is seeing right now
          </div>
          <p className="text-base font-semibold text-white">{data.plain.headline}</p>
          <p className="mt-2 text-sm leading-relaxed text-[#CBD5E1]">{data.plain.why}</p>
          <p className="mt-2 text-sm leading-relaxed text-[#CBD5E1]">{data.plain.exposure}</p>
          {data.plain.drivers.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-[#1C1836] pt-3">
              {data.plain.drivers.map((driver, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-[#94A3B8]">
                  <span className="text-[#A78BFA]" aria-hidden>›</span>
                  <span>{driver}</span>
                </li>
              ))}
            </ul>
          )}
        </GlowingCard>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Gross exposure" value={compactMoney(s.gross_exposure)} hint={`${lev(s.avg_leverage_used)} avg leverage used`} />
        <Stat label="Net equity" value={compactMoney(s.net_equity)} hint={`${pct(s.net_equity / Math.max(s.gross_exposure, 1), 0)} of gross`} />
        <Stat label="Worst-case loss (p99 gaps)" value={compactMoney(s.worst_case_loss)} hint="every position gaps to its p99" tone="warn" />
        <Stat
          label="Broker loss at p99"
          value={compactMoney(s.broker_loss_at_p99)}
          hint={`${pct(brokerLossShare, 3)} of gross`}
          tone={s.broker_loss_at_p99 > 0 ? "danger" : "safe"}
        />
        <Stat
          label="Accounts at risk"
          value={int(s.accounts_at_risk)}
          hint={`${s.reduce} reduce · ${s.margin_call} call · ${s.close} close`}
          tone={s.accounts_at_risk ? "warn" : "safe"}
        />
        <Stat
          label="Frozen symbols"
          value={s.frozen_symbols.length}
          hint={s.frozen_symbols.length ? s.frozen_symbols.join(", ") : "none"}
          tone={s.frozen_symbols.length ? "accent" : "neutral"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlowingCard>
          <h3 className="text-sm font-semibold text-white mb-1">Top-5 Concentration</h3>
          <p className="text-xs text-[#94A3B8] mb-4">Share of gross notional. Crowding dynamically scales leverage cap.</p>
          {s.top_concentration.length ? <ConcentrationBars data={s.top_concentration} /> : <Empty>No positions.</Empty>}
        </GlowingCard>

        <GlowingCard>
          <h3 className="text-sm font-semibold text-white mb-1">Margin Health Histogram</h3>
          <p className="text-xs text-[#94A3B8] mb-4">Accounts grouped by equity / required margin ratio.</p>
          <HealthHistogram data={s.margin_health_hist} />
        </GlowingCard>
      </div>

      <GlowingCard>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Actionable Risk Decisions ({actionable.length})</h3>
            <p className="text-xs text-[#94A3B8]">Every non-hold decision is Merkle-anchored to Sepolia at daily 20:00 ET close.</p>
          </div>
          <span className="text-xs font-mono text-[#A78BFA]">Latency: {s.evaluate_ms?.toFixed(2)} ms</span>
        </div>

        {actionable.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left font-mono text-[11px] uppercase tracking-wider text-[#64748B] border-b border-[#1C1836]">
                <tr>
                  <th className="pb-2.5 pr-4 font-medium">Decision</th>
                  <th className="pb-2.5 pr-4 font-medium">Account</th>
                  <th className="pb-2.5 pr-4 font-medium">Symbol</th>
                  <th className="pb-2.5 pr-4 font-medium">Action</th>
                  <th className="pb-2.5 pr-4 text-right font-medium">Max Lev</th>
                  <th className="pb-2.5 pr-4 text-right font-medium">Adverse</th>
                  <th className="pb-2.5 pr-4 text-right font-medium">Qty Reduce</th>
                  <th className="pb-2.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-[#1C1836]/60 font-mono">
                {actionable.slice(0, 25).map((d: any, i: number) => (
                  <tr key={d.id ?? i} className="hover:bg-[#121024]/40 transition-colors">
                    <td className="py-2.5 pr-4">
                      <VerifyLink id={d.id} />
                    </td>
                    <td className="py-2.5 pr-4">
                      {d.account_id ? (
                        <Link href={`/tonight?account=${d.account_id}`} className="hover:text-[#A78BFA] transition-colors">
                          {d.account_id}
                        </Link>
                      ) : (
                        <span className="text-[#64748B]">book</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-white">{d.symbol ?? "–"}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={actionTone(d.action)}>{actionLabel(d.action)}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right">{lev(d.max_leverage)}</td>
                    <td className="py-2.5 pr-4 text-right">{pct(d.adverse_move)}</td>
                    <td className="py-2.5 pr-4 text-right">{d.qty_to_reduce ? `${shares(d.qty_to_reduce)} sh` : "–"}</td>
                    <td className="py-2.5 min-w-[22rem] max-w-[34rem]">
                      {d.plain ? (
                        <>
                          <span className="block text-xs font-semibold text-white">{d.plain.headline}</span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-[#94A3B8]">{d.plain.why}</span>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-[#64748B] hover:text-[#94A3B8]">
                              Engine detail
                            </summary>
                            <Mono className="mt-1 block break-all text-[11px]">{d.reason}</Mono>
                          </details>
                        </>
                      ) : (
                        <Mono className="whitespace-nowrap">{d.reason}</Mono>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>All accounts within safe margin tolerances. Zero liquidation actions required.</Empty>
        )}
      </GlowingCard>
    </div>
  );
}

function Unavailable({ error }: { error: string | null }) {
  // Only offer sign-in when signing in is actually the fix. A seeding or engine problem is not
  // solved by another trip through Google, and saying so wastes the reader's time.
  const needsSignIn = !error || /sign in|unauthor|401/i.test(error);
  return (
    <GlowingCard className="text-center py-12 border-dashed border-[#231F42]">
      <div className="w-12 h-12 rounded-xl bg-[#7C3AED]/15 border border-[#7C3AED]/30 flex items-center justify-center text-[#C4B5FD] mx-auto mb-3">
        <Activity className="w-6 h-6 animate-pulse" />
      </div>
      <h3 className="text-lg font-bold text-white">
        {needsSignIn ? "Sign in to see the live book" : "Live book unavailable"}
      </h3>
      <p className="text-sm text-[#94A3B8] max-w-md mx-auto mt-2 leading-relaxed">
        {error ?? "The risk engine is reachable but this view needs a signed-in session."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {needsSignIn && (
          <Link
            href="/login"
            className="px-5 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] shadow-[0_0_15px_rgba(124,58,237,0.4)]"
          >
            Sign In with Google
          </Link>
        )}
        <Link
          href="/replay"
          className="px-5 py-2 rounded-lg text-xs font-semibold text-[#CBD5E1] bg-[#121024] border border-[#231F42] hover:border-[#7C3AED]/50"
        >
          Test Historical Replay
        </Link>
      </div>
    </GlowingCard>
  );
}
