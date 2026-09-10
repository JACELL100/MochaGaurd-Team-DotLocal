import Link from "next/link";

import { Badge, Banner, Mono, PageHeader, SourceBadge, Stat } from "@/components/ui";
import { GlowingCard } from "@/components/ui/GlowingCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { runSessionReplay } from "@/lib/api";
import { compactMoney, etTime, int, lev, money, pct } from "@/lib/format";
import { Activity, Gauge, ShieldCheck, TrendingDown } from "lucide-react";

export const metadata = { title: "Replay Score" };

/** Rubric weights from the problem statement. */
const WEIGHTS = { broker: 0.5, capital: 0.3, trust: 0.2 };

export default async function ScorePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; step?: string }>;
}) {
  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  const step = Math.min(60, Math.max(1, Number(typeof sp.step === "string" ? sp.step : "") || 15));

  const { data, live, error } = await runSessionReplay({ date, step_minutes: step });

  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <PageHeader
        title="Replay Score"
        subtitle="One session stepped end to end on recorded bars: hold through the gap, unwind at the open, then score what it actually cost."
        right={<SourceBadge live={live} error={error} />}
      />

      {!data ? (
        <Banner
          tone="danger"
          icon="!"
          title="Replay is unavailable"
          body={
            error ??
            "A replay scores the overnight gap against the next session's open, so at least two trading days of daily bars must be seeded."
          }
        />
      ) : (
        <Results data={data} step={step} />
      )}
    </div>
  );
}

function Results({ data, step }: { data: NonNullable<Awaited<ReturnType<typeof runSessionReplay>>["data"]>; step: number }) {
  const s = data.scores;
  // Broker loss is the pass/fail term: zero is the target, so it is shown as a state, not a curve.
  const brokerClean = s.broker_loss === 0;
  const capitalScore = Math.min(1, s.capital_efficiency / 20);
  const composite = WEIGHTS.broker * (brokerClean ? 1 : 0) + WEIGHTS.capital * capitalScore + WEIGHTS.trust * s.user_trust;

  const ramp = data.timeline.filter((t) => t.phase === "closing_ramp" || t.ramp > 0);
  const worstGap = Object.entries(s.gaps).sort((a, b) => a[1] - b[1]).slice(0, 5);

  return (
    <div className="space-y-6 relative z-20">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={brokerClean ? "safe" : "danger"}>
          {brokerClean ? "No broker loss" : "Broker loss incurred"}
        </StatusBadge>
        <span className="text-xs font-mono text-[#94A3B8]">
          session {data.session_date} → open {data.next_session} · {data.steps} steps @ {step}m ·{" "}
          {int(data.decisions)} decisions · {int(data.fills)} fills
        </span>
      </div>

      {data.plain && (
        <GlowingCard
          className={
            data.plain.severity === "critical" ? "border border-rose-500/40" : "border border-emerald-500/30"
          }
        >
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] mb-2">
            What happened, in plain terms
          </div>
          <p className="text-base font-semibold text-white">{data.plain.headline}</p>
          <dl className="mt-3 space-y-2 border-t border-[#1C1836] pt-3 text-xs leading-relaxed">
            <div>
              <dt className="font-semibold text-[#C4B5FD]">Broker loss</dt>
              <dd className="text-[#CBD5E1]">{data.plain.broker_loss}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#C4B5FD]">Capital efficiency</dt>
              <dd className="text-[#CBD5E1]">{data.plain.capital_efficiency}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#C4B5FD]">User trust</dt>
              <dd className="text-[#CBD5E1]">{data.plain.user_trust}</dd>
            </div>
          </dl>
        </GlowingCard>
      )}

      {/* The three rubric numbers */}
      <div className="grid gap-4 md:grid-cols-3">
        <GlowingCard className={brokerClean ? "border border-emerald-500/30" : "border border-rose-500/40"}>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
            <ShieldCheck className="w-3.5 h-3.5" /> Broker loss · 50%
          </div>
          <div className={`tabular mt-2 text-4xl font-extrabold ${brokerClean ? "text-emerald-400" : "text-rose-400"}`}>
            {money(s.broker_loss)}
          </div>
          <p className="mt-2 text-xs text-[#94A3B8]">
            Equity still below zero after the gap and the unwind — money the customer cannot repay.
            {s.accounts_negative > 0 && ` ${int(s.accounts_negative)} accounts negative.`}
          </p>
        </GlowingCard>

        <GlowingCard>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
            <Gauge className="w-3.5 h-3.5" /> Capital efficiency · 30%
          </div>
          <div className="tabular mt-2 text-4xl font-extrabold text-white">{lev(s.capital_efficiency)}</div>
          <p className="mt-2 text-xs text-[#94A3B8]">
            Average leverage actually allowed across the session. This is the product — a safe engine
            nobody wants to use scores zero here.
          </p>
        </GlowingCard>

        <GlowingCard>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
            <TrendingDown className="w-3.5 h-3.5" /> User trust · 20%
          </div>
          <div className="tabular mt-2 text-4xl font-extrabold text-white">{pct(s.user_trust, 0)}</div>
          <p className="mt-2 text-xs text-[#94A3B8]">
            Share of what we sold that we actually needed to sell. We sold {money(s.notional_sold)}, of
            which {money(s.notional_sold_unnecessarily)} recovered by the open.
          </p>
        </GlowingCard>
      </div>

      <GlowingCard>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
              Weighted composite
            </div>
            <div className="tabular mt-1 text-3xl font-bold text-white">{pct(composite, 1)}</div>
            <p className="mt-1 text-xs text-[#64748B]">
              0.5 × broker-loss gate + 0.3 × (avg leverage / 20x) + 0.2 × user trust
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="Book sold" value={s.share_of_book_sold !== null ? pct(s.share_of_book_sold, 1) : "–"} />
            <Stat label="Positions reduced" value={int(s.positions_reduced)} />
            <Stat label="Equity start → end" value={`${compactMoney(s.equity_start)} → ${compactMoney(s.equity_end)}`} />
          </div>
        </div>
      </GlowingCard>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* The ramp: proof there is no 3:59:59 cliff */}
        <GlowingCard>
          <h3 className="text-sm font-semibold text-white mb-1">The closing ramp</h3>
          <p className="text-xs text-[#94A3B8] mb-4">
            De-risking spread across 15:30–16:00 instead of one cliff at the bell. Customers get a
            window to reduce themselves, and there is still a liquid market to sell into.
          </p>
          {ramp.length === 0 ? (
            <p className="text-xs text-[#64748B]">This session had no ramp steps in range.</p>
          ) : (
            <div className="space-y-1.5">
              {ramp.map((t) => (
                <div key={t.ts} className="flex items-center gap-3 text-xs font-mono">
                  <span className="w-12 text-[#94A3B8]">{etTime(t.ts)}</span>
                  <span className="w-12 text-[#C4B5FD]">{t.ramp.toFixed(2)}</span>
                  <div className="flex-1 h-2 rounded bg-[#121024] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#7C3AED] to-[#A78BFA]"
                      style={{ width: `${Math.min(100, t.ramp * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-white">{int(t.accounts_at_risk)} acting</span>
                </div>
              ))}
            </div>
          )}
        </GlowingCard>

        {/* Job 3 */}
        <GlowingCard>
          <h3 className="text-sm font-semibold text-white mb-1">The morning after</h3>
          <p className="text-xs text-[#94A3B8] mb-4">
            Worst margin ratio first, healthy accounts untouched, our own selling capped at 10% of
            expected minute volume so we do not crash the price we are selling into.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Stat label="Pre-close reductions" value={int(data.auto_derisk_fills)} />
            <Stat
              label="Open-bell unwinds"
              value={int(data.unwind_fills)}
              tone={data.unwind_fills > 0 ? "warn" : "safe"}
            />
          </div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] mb-2">
            Overnight gaps
          </div>
          <div className="flex flex-wrap gap-2">
            {worstGap.map(([sym, g]) => (
              <Badge key={sym} tone={g < -0.02 ? "danger" : g < 0 ? "warn" : "neutral"}>
                {sym} {g >= 0 ? "+" : ""}
                {(g * 100).toFixed(2)}%
              </Badge>
            ))}
          </div>
        </GlowingCard>
      </div>

      <GlowingCard>
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#A78BFA] mb-3">
          <Activity className="w-3.5 h-3.5" /> Session events
        </div>
        <ol className="space-y-2">
          {data.events.map((e, i) => (
            <li key={i} className="flex gap-3 text-xs">
              <span className="w-12 shrink-0 font-mono text-[#94A3B8]">{etTime(e.ts)}</span>
              <Badge tone={e.kind === "gap" ? "danger" : e.kind === "unwind" ? "warn" : "neutral"}>{e.kind}</Badge>
              <span className="text-[#CBD5E1]">{e.note}</span>
            </li>
          ))}
        </ol>
      </GlowingCard>

      <p className="text-xs text-[#64748B]">
        Run id <Mono>{data.run_id}</Mono> · decisions and fills are persisted under this id and can be{" "}
        <Link href="/verify" className="text-[#C4B5FD] hover:underline">verified on Sepolia</Link>.
        {data.symbols_missing_next_open.length > 0 && (
          <> Symbols without a recorded next open (held flat): {data.symbols_missing_next_open.join(", ")}.</>
        )}
      </p>
    </div>
  );
}
