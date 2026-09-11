import Link from "next/link";

import { Badge, Banner, Stat, VerifyLink } from "@/components/ui";
import { StatusBar } from "@/components/trading/StatusBar";
import { TerminalShell } from "@/components/trading/TerminalShell";
import { getAccounts, getDesk, getTonight } from "@/lib/api";
import {
  actionLabel,
  actionTone,
  etTime,
  lev,
  money,
  pct,
  shares,
  statusTone,
  timeIn,
  tzCity,
} from "@/lib/format";
import type { Explanation } from "@/lib/types";
import { AccountHeader } from "@/components/trading/AccountHeader";
import { DeskChartsPanel } from "@/components/trading/DeskChartsPanel";
import { HoldingCost } from "@/components/trading/HoldingCost";
import { RiskPanel } from "@/components/trading/RiskBreakdown";
import { PositionsBlotter } from "@/components/trading/PositionsBlotter";
import { PlainReason } from "@/components/ui/PlainReason";
import { AccountPicker } from "./AccountPicker";
import { GlowingCard } from "@/components/ui/GlowingCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Moon, ShieldCheck, Clock, Terminal } from "lucide-react";

export const metadata = { title: "Tonight" };


export default async function TonightPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; hours?: string }>;
}) {
  const { account, hours: hoursParam } = await searchParams;
  const hours = Math.max(6, Math.min(336, Number(hoursParam) || 48));
  const accountsRes = await getAccounts();
  const accounts = accountsRes.data ?? [];

  const requested = typeof account === "string" ? account : undefined;
  const fallback = accounts.find((a) => a.status !== "safe") ?? accounts[0];
  const selected = requested ?? fallback?.id;

  // Charts and briefing come from the same account, fetched together.
  const [tonightRes, deskRes] = selected
    ? await Promise.all([getTonight(selected), getDesk(selected, hours)])
    : [null, null];
  // No stand-in briefing: a risk page that shows invented positions and deadlines is worse
  // than one that says it has nothing to show.
  const briefing = tonightRes?.data ?? null;
  const live = accountsRes.live && (tonightRes?.live ?? true);
  const error = accountsRes.error ?? tonightRes?.error ?? null;

  const acct = briefing?.account;
  return (
    <>
      <StatusBar engineLive={live} />
      <TerminalShell
        eyebrow="Trading / Desk"
        title={acct?.display_name ?? "Trading desk"}
        live={live}
        error={error}
        meta={
          acct
            ? [
                { label: "equity", value: money(acct.equity) },
                { label: "exposure", value: money(acct.gross_exposure), tone: "accent" },
                { label: "lev used", value: lev(acct.leverage_used), tone: "accent" },
                {
                  label: "margin",
                  value: acct.margin_ratio !== null ? acct.margin_ratio.toFixed(2) : "–",
                  tone: acct.margin_ratio !== null && acct.margin_ratio < 1.25 ? "danger" : "default",
                },
                { label: "act by", value: briefing.deadline_local, tone: "warn" },
              ]
            : undefined
        }
        actions={
          selected && accounts.length > 0 ? (
            <AccountPicker accounts={accounts} selected={selected} />
          ) : undefined
        }
      >
      {briefing ? (
        <Briefing b={briefing} desk={deskRes?.data ?? null} hours={hours} selected={selected} />
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
      </TerminalShell>
    </>
  );
}

function Briefing({
  b,
  desk,
  hours,
  selected,
}: {
  b: any;
  desk: import("@/lib/types").DeskResponse | null;
  hours: number;
  selected?: string;
}) {
  const a = b.account;
  const tone = statusTone(b.status);
  const icon = b.status === "safe" ? "✅" : b.status === "auto_derisk" ? "🛑" : "⚠️";
  const actionable = b.cards.filter((c: any) => c.action !== "freeze");
  const frozen = b.cards.filter((c: any) => c.action === "freeze");
  const plainDecisions = (b.decisions ?? []).filter((d: any) => d.plain);

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
          </div>
        }
      />

      {/* The terminal strip: the numbers a broker puts above the blotter. */}
      <AccountHeader account={a} />

      {desk && desk.series.length > 0 && (
        <GlowingCard>
          <DeskChartsPanel desk={desk} hours={hours} accountId={selected} />
        </GlowingCard>
      )}

      {/* The deadline, in the trader's own timezone. The status bar carries the clock; this
          carries the two moments that matter and what happens if nobody acts. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-xs">
        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
          Deadline
        </span>
        <span className="text-[#CBD5E1]">
          Act by{" "}
          <span className="font-mono font-semibold text-white">{b.deadline_local}</span>{" "}
          <span className="text-[#64748B]">({b.deadline_et}, {tzCity(a.tz)})</span>
        </span>
        <span className="text-[#CBD5E1]">
          Auto de-risk{" "}
          <span className="font-mono font-semibold text-amber-300">3:45 PM ET</span>{" "}
          <span className="text-[#64748B]">if nobody responds</span>
        </span>
      </div>

      {actionable.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-white">What to do before {b.deadline_local}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {actionable.map((c: any, i: number) => (
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
            {plainDecisions.map((d: any, i: number) => (
              <PlainReason key={d.id ?? `p${i}`} plain={d.plain} raw={d.reason} />
            ))}
          </div>
        </section>
      )}

      {frozen.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {frozen.map((c: any, i: number) => (
            <ExplanationCard key={c.decision_id ?? `f${i}`} c={c} tz={a.tz} />
          ))}
        </section>
      )}

      {/* Why the risk exists, before what to do about it. An instruction without a reason is
          the thing traders distrust about risk systems. */}
      {b.risk && b.risk.length > 0 && (
        <GlowingCard>
          <RiskPanel risk={b.risk} />
        </GlowingCard>
      )}

      <GlowingCard>
        <PositionsBlotter positions={a.positions} equity={a.equity} />
      </GlowingCard>

      {b.funding && b.funding.length > 0 && (
        <GlowingCard>
          <HoldingCost funding={b.funding} book={b.funding_book} closure={b.closure} />
        </GlowingCard>
      )}
    </div>
  );
}

function ExplanationCard({ c, tz }: { c: any; tz: string }) {
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
        Local timezone {tz} · Grounded LLM: {c.model}
      </p>
    </GlowingCard>
  );
}
