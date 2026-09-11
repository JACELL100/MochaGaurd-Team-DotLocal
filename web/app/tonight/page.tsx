import Link from "next/link";

import { Badge, Banner, PageHeader, SourceBadge, Stat, VerifyLink } from "@/components/ui";
import { getAccounts, getTonight } from "@/lib/api";
import {
  actionLabel,
  actionTone,
  etTime,
  lev,
  money,
  pct,
  shares,
  statusTone,
  tzCity,
} from "@/lib/format";
import type { Explanation, TonightBriefing } from "@/lib/types";
import { PlainReason } from "@/components/ui/PlainReason";
import { AccountPicker } from "./AccountPicker";
import { GlowingCard } from "@/components/ui/GlowingCard";
import { StatusBadge } from "@/components/ui/StatusBadge";


import { Zap, ArrowRight, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";
import { AlertLauncher } from "./AlertLauncher";

export const metadata = { title: "Tonight" };


export default async function TonightPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const accountsRes = await getAccounts();
  const accounts = accountsRes.data ?? [];

  const requested = typeof account === "string" ? account : undefined;
  const fallback = accounts.find((a) => a.status !== "safe") ?? accounts[0];
  const selected = requested ?? fallback?.id;

  const tonightRes = selected ? await getTonight(selected) : null;
  // No stand-in briefing: a risk page that shows invented positions and deadlines is worse
  // than one that says it has nothing to show.
  const briefing = tonightRes?.data ?? null;
  const live = accountsRes.live && (tonightRes?.live ?? true);
  const error = accountsRes.error ?? tonightRes?.error ?? null;

  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <PageHeader
        title="Tonight (The 2 AM Problem)"
        subtitle="The sleep-safe briefing a trader reviews before bed. Every sentence is a decided fact, translated."
        right={
          <div className="flex items-center gap-3">
            {selected && accounts.length > 0 && <AccountPicker accounts={accounts} selected={selected} />}
            <SourceBadge live={live} error={error} />
          </div>
        }
      />

      {briefing ? (
        <Briefing b={briefing} />
      ) : (
        <Banner
          tone={error ? "danger" : "warn"}
          icon={error ? "!" : "◔"}
          title={error ? "Live risk data is unavailable" : "No portfolio is linked yet"}
          body={
            error ??
            "This briefing is built from a real linked portfolio. Once Mochatrade's brokerage service syncs an account and its positions, the engine's overnight decision for it appears here."
          }
        />
      )}
    </div>
  );
}

function Briefing({ b }: { b: TonightBriefing }) {
  const a = b.account;
  const tone = statusTone(b.status);
  const icon =
    b.status === "safe" ? (
      <ShieldCheck className="w-8 h-8 text-[#10B981]" />
    ) : b.status === "auto_derisk" ? (
      <ShieldAlert className="w-8 h-8 text-[#EF4444]" />
    ) : (
      <AlertTriangle className="w-8 h-8 text-[#F59E0B]" />
    );
  const actionable = b.cards.filter((card) => card.action !== "freeze");
  const frozen = b.cards.filter((card) => card.action === "freeze");
  const plainDecisions = b.decisions.filter((decision) => decision.plain);

  return (
    <div className="space-y-6 relative z-20">

      <Banner
        tone={tone}
        icon={icon}
        title={b.headline}
        body={b.summary}
        aside={
          <div className="rounded-xl border border-[#231F42] bg-[#0B0A14]/80 px-4 py-3 text-sm">
            <div className="text-[11px] uppercase tracking-wider text-[#94A3B8]">
              {a.display_name ?? a.account_id} · {tzCity(a.tz)}
            </div>
            <div className="tabular mt-1 text-lg font-semibold text-white">{b.local_time} local</div>
            <div className="mt-0.5 text-xs text-[#64748B]">
              {etTime(b.as_of)} in New York · deadline {b.deadline_local} ({b.deadline_et})
            </div>
            <div className="mt-1 text-[10px] font-mono text-[#64748B]">
              {b.model === "template" ? "Deterministic briefing fallback" : `Groq briefing · ${b.model}`}
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Equity" value={money(a.equity)} hint={`cash ${money(a.cash)}`} />
        <Stat label="Gross exposure" value={money(a.gross_exposure)} hint={`${lev(a.leverage_used)} leverage used`} />
        <Stat
          label="Margin required"
          value={money(a.margin_required)}
          hint={a.margin_ratio !== null ? `ratio ${a.margin_ratio.toFixed(2)}` : "no positions"}
          tone={a.margin_ratio !== null && a.margin_ratio < 1 ? "danger" : "neutral"}
        />
        <Stat
          label="Worst case tonight"
          value={money(a.worst_case_loss)}
          hint={`${pct(a.worst_case_loss / Math.max(a.equity, 1), 0)} of equity at p99`}
          tone={a.worst_case_loss >= a.equity ? "danger" : "warn"}
        />
        <Stat label="Deadline" value={b.deadline_local} hint={b.deadline_et} tone="accent" />
      </div>

      {/* Interactive Sentinel & Simulator Action Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Stress Test Shock Launcher Card */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-[#7C3AED]/40 bg-gradient-to-r from-[#121024] via-[#1A1636] to-[#0B0A14] p-5 shadow-[0_0_30px_rgba(124,58,237,0.15)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED]/20 border border-[#7C3AED]/40 text-[#A78BFA]">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-tight">Simulate Overnight Shocks</div>
              <div className="text-xs text-[#94A3B8]">Test market gap crashes (-5% to -35%) in real time.</div>
            </div>
          </div>
          <Link
            href={`/stress-test?account=${a.account_id}`}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:brightness-110 shadow-[0_0_20px_rgba(124,58,237,0.4)] flex items-center gap-2 shrink-0 transition-all"
          >
            Launch Stress Test
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Telegram & Siren Push Alerts Card */}
        <AlertLauncher
          accountId={a.account_id}
          accountName={a.display_name ?? a.account_id}
          symbol={a.positions[0]?.symbol ?? "NVDA"}
        />
      </div>

      {actionable.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-white">What to do before {b.deadline_local}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {actionable.map((c, i) => (
              <ExplanationCard key={c.decision_id ?? i} c={c} tz={a.tz} />
            ))}
          </div>
        </section>
      )}

      {/* Every decision, with the reason it happened. The cards above are the narrated form and
          only exist once the copilot has run; these are computed with the decision itself, so
          this section is never empty when there is something to explain. */}
      {plainDecisions.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-white">Why the engine acted</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {plainDecisions.map((d, i) => (
              <PlainReason key={d.id ?? `p${i}`} plain={d.plain} raw={d.reason} />
            ))}
          </div>
        </section>
      )}

      {frozen.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {frozen.map((c, i) => (
            <ExplanationCard key={c.decision_id ?? `f${i}`} c={c} tz={a.tz} />
          ))}
        </section>
      )}

      <GlowingCard>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Active Account Positions</h3>
            <p className="text-xs text-[#94A3B8]">Allowed leverage is per position: overnight gap risk, earnings, and liquidity footprint.</p>
          </div>
          <Link href={`/simulate?symbol=${a.positions[0]?.symbol ?? "NVDA"}`} className="text-xs text-[#A78BFA] hover:underline">
            Open in simulator →
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-left text-[11px] uppercase tracking-wider text-[#64748B] border-b border-[#1C1836]">
              <tr>
                <th className="pb-2.5 pr-4 font-medium">Symbol</th>
                <th className="pb-2.5 pr-4 text-right font-medium">Qty</th>
                <th className="pb-2.5 pr-4 text-right font-medium">Price</th>
                <th className="pb-2.5 pr-4 text-right font-medium">Notional</th>
                <th className="pb-2.5 pr-4 text-right font-medium">Allowed Lev</th>
                <th className="pb-2.5 pr-4 text-right font-medium">p99 Move</th>
                <th className="pb-2.5 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-[#1C1836]/60">
              {a.positions.map((p) => (
                <tr key={p.symbol} className="hover:bg-[#121024]/40 transition-colors">
                  <td className="py-2.5 pr-4 font-semibold text-white">{p.symbol}</td>
                  <td className="py-2.5 pr-4 text-right text-[#CBD5E1]">{shares(p.qty)}</td>
                  <td className="py-2.5 pr-4 text-right text-[#CBD5E1]">{money(p.price, true)}</td>
                  <td className="py-2.5 pr-4 text-right text-white">{money(p.notional)}</td>
                  <td className="py-2.5 pr-4 text-right text-[#C4B5FD]">{lev(p.max_leverage)}</td>
                  <td className="py-2.5 pr-4 text-right text-[#CBD5E1]">{pct(p.adverse_move)}</td>
                  <td className="py-2.5">
                    <div className="flex gap-1.5">
                      {p.earnings_tonight && <StatusBadge tone="warn">Earnings Tonight</StatusBadge>}
                      {p.frozen && <StatusBadge tone="accent">Frozen</StatusBadge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlowingCard>
    </div>
  );
}

function ExplanationCard({ c, tz }: { c: Explanation; tz: string }) {
  const tone = actionTone(c.action);
  return (
    <GlowingCard className="h-full flex flex-col justify-between">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Badge tone={tone}>{actionLabel(c.action)}</Badge>
          <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
            {c.max_leverage !== null && <span>cap {lev(c.max_leverage)}</span>}
            <VerifyLink id={c.decision_id} />
          </div>
        </div>
        <h3 className="text-base font-bold text-white leading-snug">{c.headline}</h3>
        <p className="mt-2 text-xs leading-relaxed text-[#CBD5E1]">{c.body}</p>
        {c.action_hint && (
          <div className="mt-4 rounded-lg border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-4 py-3 text-xs text-white">
            <span className="mr-2 text-[10px] font-bold uppercase tracking-wider text-[#A78BFA]">Action Required</span>
            {c.action_hint}
          </div>
        )}
      </div>
      <p className="mt-4 pt-3 border-t border-[#1C1836] text-[10px] text-[#64748B] font-mono">
        Local timezone {tz} · {c.model === "template" ? "Deterministic fact template" : `Grounded Groq narration: ${c.model}`}
      </p>
    </GlowingCard>
  );
}
