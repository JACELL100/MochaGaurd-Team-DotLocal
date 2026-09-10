import { Badge, Banner, Mono, PageHeader, SourceBadge, Stat, inputClass } from "@/components/ui";
import { getLeverage } from "@/lib/api";
import { etWallClock } from "@/lib/engine";
import { etDateTime, lev, money, pct, phaseLabel } from "@/lib/format";
import { GlowingCard } from "@/components/ui/GlowingCard";
import { Calculator, Zap, ShieldAlert, Cpu } from "lucide-react";

export const metadata = { title: "Simulate" };

function currentEtDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const PRESETS: Array<{ label: string; time: string }> = [
  { label: "Open 09:30", time: "09:30" },
  { label: "Midday 12:00", time: "12:00" },
  { label: "Ramp 15:45", time: "15:45" },
  { label: "Closed 16:30", time: "16:30" },
];

export default async function SimulatePage({ searchParams }: { searchParams: Promise<{ symbol?: string; notional?: string; date?: string; time?: string; earnings?: string }> }) {
  const sp = await searchParams;
  const symbol = (typeof sp.symbol === "string" && sp.symbol.trim().toUpperCase()) || "NVDA";
  const notional = Math.max(0, Number(typeof sp.notional === "string" ? sp.notional : "") || 50_000);
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : currentEtDate();
  const time = typeof sp.time === "string" && /^\d{2}:\d{2}$/.test(sp.time) ? sp.time : "15:45";
  const earningsParam = typeof sp.earnings === "string" ? sp.earnings : undefined;
  const earnings = earningsParam === "1" ? true : earningsParam === "0" ? false : undefined;

  const ts = etWallClock(date, time);
  // The engine is the only thing allowed to answer "how much leverage". A second copy of the
  // formula in the browser would drift from it and quietly show a limit the API never issued.
  const { data: r, live, error } = await getLeverage({ symbol, notional, ts, earnings_tonight: earnings });

  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <PageHeader
        title="Live Leverage Simulator"
        subtitle="Test dynamic leverage limits, concentration haircuts, and earnings overnight buffers."
        right={<SourceBadge live={live} error={error} />}
      />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr] relative z-20">
        <GlowingCard>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#A78BFA] mb-4">
            <Calculator className="w-4 h-4" />
            Simulation Parameters
          </div>

          <form method="get" className="space-y-4 text-xs font-mono">
            <label className="block text-[#94A3B8]">
              Symbol
              <input name="symbol" defaultValue={symbol} className={`${inputClass} mt-1 font-mono uppercase bg-[#05050A] border-[#231F42]`} autoComplete="off" />
            </label>
            <label className="block text-[#94A3B8]">
              Position size (USD notional)
              <input name="notional" type="number" min={0} step={1000} defaultValue={notional} className={`${inputClass} mt-1 font-mono bg-[#05050A] border-[#231F42]`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[#94A3B8]">
                Session date
                <input name="date" type="date" defaultValue={date} className={`${inputClass} mt-1 bg-[#05050A] border-[#231F42]`} />
              </label>
              <label className="block text-[#94A3B8]">
                Time (ET)
                <input name="time" type="time" defaultValue={time} step={300} className={`${inputClass} mt-1 bg-[#05050A] border-[#231F42]`} />
              </label>
            </div>
            <fieldset className="text-[#94A3B8]">
              <legend className="mb-1.5">Earnings tonight</legend>
              <div className="flex gap-4">
                {[
                  ["", "Auto"],
                  ["1", "Yes"],
                  ["0", "No"],
                ].map(([v, label]) => (
                  <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="earnings" value={v} defaultChecked={(earningsParam ?? "") === v} className="accent-[#7C3AED]" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESETS.map((p) => (
                <button key={p.time} type="submit" name="time" value={p.time} className="rounded-md border border-[#231F42] bg-[#121024] px-2.5 py-1 text-[11px] text-[#C4B5FD] hover:border-[#7C3AED]/50">
                  {p.label}
                </button>
              ))}
            </div>
            <button type="submit" className="w-full py-2.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] shadow-[0_0_20px_rgba(124,58,237,0.4)]">
              Compute Limit
            </button>
          </form>
        </GlowingCard>

        {!r ? (
          <Banner
            tone="danger"
            icon="!"
            title={error ? "The risk engine did not answer" : `${symbol} is not in the live risk universe`}
            body={
              error ??
              "The engine only prices symbols it has loaded split-adjusted history for. Seed the symbol on the API (scripts/seed_market.py) and try again."
            }
          />
        ) : (
        <div className="space-y-6">
          <GlowingCard>
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
                  Allowed Leverage · {r.symbol} · {money(notional)} · {etDateTime(ts)}
                </div>
                <div className={`tabular mt-2 text-6xl font-extrabold tracking-tight ${r.frozen ? "text-amber-400" : "text-white"}`}>
                  {r.frozen ? "Frozen" : lev(r.max_leverage)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={r.phase === "closing_ramp" ? "warn" : r.phase === "open" ? "safe" : "neutral"}>
                    {phaseLabel(r.phase)}
                    {r.phase === "closing_ramp" && ` · ramp ${pct(r.ramp, 0)}`}
                  </Badge>
                  {r.earnings_tonight && <Badge tone="warn">earnings tonight</Badge>}
                  {r.frozen && <Badge tone="accent">guard: frozen</Badge>}
                  {r.max_leverage >= 20 && !r.frozen && <Badge tone="accent">headline cap</Badge>}
                </div>
              </div>

              <div className="max-w-md p-4 rounded-xl bg-[#05050A]/70 border border-[#231F42] text-xs leading-relaxed text-[#CBD5E1]">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#A78BFA] uppercase tracking-wider mb-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  Why this number
                </div>
                {r.explanation?.headline ?? r.reason}
              </div>
            </div>
          </GlowingCard>

          {r.sector && r.sector.peers.length > 0 && (
            <GlowingCard>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-white">
                  Sector, in the markets that were open
                </h3>
                <Badge tone={r.sector.multiplier > 1.05 ? "warn" : "neutral"}>
                  gap ×{r.sector.multiplier.toFixed(2)}
                </Badge>
              </div>
              <p className="text-xs text-[#94A3B8] mb-4">
                The US market is shut for 17.5 hours, but this stock&apos;s sector keeps trading —
                Taiwan and Korea until ~1:30 AM New York, India until 5:45 AM, Europe until 7:00 AM.
                A sector that already moved hard overseas is real information about tonight&apos;s gap.
                Only markets whose session had <em>finished</em> are counted.
              </p>

              <ul className="space-y-1.5">
                {r.sector.peers.map((peer) => (
                  <li
                    key={peer.ticker}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${
                      peer.counted ? "border-[#231F42] bg-[#05050A]/70" : "border-transparent opacity-45"
                    }`}
                  >
                    <span className="w-4 text-center text-[#A78BFA]" aria-hidden>
                      {peer.counted ? "✓" : "·"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[#CBD5E1]">{peer.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
                      {peer.region}
                    </span>
                    <span
                      className={`w-16 text-right font-mono ${
                        peer.move < 0 ? "text-rose-300" : "text-emerald-300"
                      }`}
                    >
                      {peer.move >= 0 ? "+" : ""}
                      {(peer.move * 100).toFixed(2)}%
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-3 border-t border-[#1C1836] pt-3 text-xs text-[#64748B]">
                {r.sector.note || "No sector market has finished trading since the US close."}{" "}
                This only ever widens the move we size against — a calm night overseas is not
                permission to exceed the stock&apos;s own history, and a sharp rally widens it just
                as much as a selloff.
              </p>
            </GlowingCard>
          )}

          {r.explanation && (
            <GlowingCard>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-white">What moved this limit</h3>
                <Badge tone="neutral">{r.explanation.model}</Badge>
              </div>
              <p className="text-xs text-[#94A3B8] mb-4">
                Every factor the engine applied, in the order it applied them. Computed with the
                decision — no model call, so it is always available and always matches the number.
              </p>

              <ul className="space-y-2.5">
                {r.explanation.factors.map((f, i) => (
                  <li key={i} className="flex gap-3 p-3 rounded-lg bg-[#05050A]/70 border border-[#1C1836]">
                    <span
                      className={`mt-0.5 shrink-0 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        f.impact === "raises"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : f.impact === "blocks"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {f.impact}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white">
                        {f.label}
                        <span className="ml-2 font-mono font-normal text-[#C4B5FD]">{f.value}</span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-[#94A3B8]">{f.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 pt-4 border-t border-[#1C1836]">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8] mb-2">
                  Check the arithmetic
                </div>
                <Mono className="block whitespace-pre-wrap break-words text-xs bg-[#05050A] p-3 rounded-lg border border-[#1C1836] text-[#C4B5FD]">
                  {`${r.explanation.formula.concentration_haircut} × ${r.explanation.formula.safety} / (${r.explanation.formula.adverse_move} + ${r.explanation.formula.slippage}) = ${r.explanation.formula.uncapped ?? "–"}`}
                  {"\n"}
                  {`capped at ${r.explanation.formula.headline_cap}x → ${r.explanation.formula.result}x`}
                </Mono>
                <p className="mt-2 text-xs text-[#64748B]">{r.explanation.formula.note}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat label="Position notional" value={money(r.explanation.safety_budget.notional)} />
                <Stat
                  label="Loss if it gaps to p99"
                  value={money(r.explanation.safety_budget.loss_at_p99)}
                  tone="warn"
                />
                <Stat
                  label="Equity required"
                  value={r.explanation.safety_budget.equity_required !== null ? money(r.explanation.safety_budget.equity_required) : "no exposure"}
                />
              </div>
            </GlowingCard>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Adverse move" value={pct(r.adverse_move, 1)} hint={r.earnings_tonight ? "earnings-gap p99" : r.phase === "open" ? "intraday p99" : "overnight gap p99"} tone="warn" />
            <Stat label="Slippage" value={pct(r.slippage, 2)} hint={r.risk ? `${pct(notional / r.risk.adv_dollar, 3)} of ADV$` : "own market impact"} />
            <Stat label="Concentration haircut" value={`×${r.concentration_haircut.toFixed(2)}`} hint={r.concentration_haircut < 1 ? "size > 1% of ADV$" : "no haircut"} tone={r.concentration_haircut < 1 ? "warn" : "neutral"} />
            <Stat
              label="Safety budget"
              value={r.explanation ? r.explanation.formula.safety.toFixed(2) : "–"}
              hint="share of equity a p99 move may cost"
              tone="accent"
            />
          </div>

          {r.risk && (
            <GlowingCard>
              <h3 className="text-sm font-semibold text-white mb-1">Precomputed Risk Statistics</h3>
              <p className="text-xs text-[#94A3B8] mb-4">Historical split-adjusted price metrics loaded into memory.</p>

              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4 font-mono">
                <Stat label="Gap p99" value={pct(r.risk.gap_p99, 1)} />
                <Stat label="Intraday p99" value={pct(r.risk.intraday_p99, 1)} />
                <Stat label="Earnings-gap p99" value={pct(r.risk.earnings_gap_p99, 1)} />
                <Stat label="ADV$" value={money(r.risk.adv_dollar)} />
              </div>
            </GlowingCard>
          )}

          <GlowingCard>
            <div className="flex items-center gap-2 text-xs font-mono text-[#94A3B8] uppercase tracking-wider mb-2">
              <Zap className="w-3.5 h-3.5 text-[#A78BFA]" />
              Deterministic Reason String
            </div>
            <Mono className="block whitespace-pre-wrap break-all text-xs bg-[#05050A] p-3 rounded-lg border border-[#1C1836] text-[#C4B5FD]">{r.reason}</Mono>
          </GlowingCard>
        </div>
        )}
      </div>
    </div>
  );
}
