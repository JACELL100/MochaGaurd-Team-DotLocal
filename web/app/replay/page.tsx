import { Badge, Banner, Stat, inputClass } from "@/components/ui";
import { StatusBar } from "@/components/trading/StatusBar";
import { TerminalShell } from "@/components/trading/TerminalShell";
import { getReplay } from "@/lib/api";
import { int, lev, money, pct } from "@/lib/format";
import { ReplayTimeline } from "./ReplayTimeline";
import { GlowingCard } from "@/components/ui/GlowingCard";
import { StatusBadge } from "@/components/ui/StatusBadge";

export const metadata = { title: "Replay" };


export default async function ReplayPage({ searchParams }: { searchParams: Promise<{ symbol?: string; date?: string }> }) {
  const sp = await searchParams;
  const symbol = (typeof sp.symbol === "string" && sp.symbol.trim().toUpperCase()) || "NVDA";
  const date = typeof sp.date === "string" && sp.date ? sp.date : undefined;

  const res = await getReplay({ symbol, date });
  // This view replays real recorded bars. Substituting a synthetic price path would contradict
  // the one guarantee it makes, so an unavailable session is reported as unavailable.
  const data = res.data;
  const live = res.live;
  const error = res.error;

  if (!data) {
    return (
      <>
        <StatusBar engineLive={live} />
        <TerminalShell
          eyebrow="Risk / Session tape"
          title={`Session review · ${symbol}`}
          live={live}
          error={error}
        >
        <Banner
          tone="danger"
          icon="!"
          title={`No recorded session for ${symbol}`}
          body={
            error ??
            "Intraday history for this symbol and date has not been persisted yet. Seed it on the API with scripts/seed_market.py, then reload."
          }
        />
        </TerminalShell>
      </>
    );
  }

  const s = data.summary;
  const symbols = data.symbols.length ? data.symbols : [data.symbol];

  return (
    <>
      <StatusBar engineLive={live} />
      <TerminalShell
        eyebrow="Risk / Session tape"
        title={`Session review · ${data.symbol}`}
        live={live}
        error={error}
        meta={[
          { label: "date", value: data.date },
          { label: "open", value: money(s.open_price, true) },
          { label: "close", value: money(s.close_price, true) },
          { label: "change", value: pct(s.price_change, 2),
            tone: s.price_change < 0 ? "danger" : "default" },
          { label: "min allowed", value: lev(s.min_allowed_leverage), tone: "accent" },
          { label: "bars", value: int(s.bars) },
        ]}
        actions={
            <form method="get" className="flex items-center gap-2">
              <select name="symbol" defaultValue={data.symbol} className={`${inputClass} w-auto bg-[#0B0A14] border-[#231F42] text-xs font-mono`} aria-label="Symbol">
                {symbols.map((sym: string) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
              <input type="date" name="date" defaultValue={data.date} className={`${inputClass} w-auto bg-[#0B0A14] border-[#231F42] text-xs font-mono`} aria-label="Session date" />
              <button type="submit" className="rounded-lg bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] px-3 py-1.5 text-xs font-semibold text-white">
                Run
              </button>
            </form>
        }
      >

      {!live && (
        <div className="mb-6 p-3 rounded-xl bg-[#7C3AED]/15 border border-[#7C3AED]/30 flex items-center justify-between text-xs text-[#C4B5FD]">
          <span>Demonstration Replay: NVDA historical earnings session with dynamic closing ramp</span>
          <StatusBadge tone="accent">Persisted Bars</StatusBadge>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 relative z-20">
        <Stat label="Actual bars" value={int(s.bars)} hint="persisted market prints" />
        <Stat label="Open" value={money(s.open_price, true)} hint="session open" />
        <Stat label="Close" value={money(s.close_price, true)} hint="session close" />
        <Stat label="Session move" value={pct(s.price_change, 2)} hint="actual price change" tone={s.price_change < 0 ? "danger" : "safe"} />
        <Stat label="Minimum allowed lev" value={lev(s.min_allowed_leverage)} hint="$10k reference position" tone="warn" />
        <Stat label="Close allowed lev" value={lev(s.close_allowed_leverage)} hint="current risk rules" tone="accent" />
      </div>

      <GlowingCard className="relative z-20">
        <ReplayTimeline replay={data as any} />
      </GlowingCard>

      <p className="text-xs font-mono text-[#64748B]">
        <Badge tone="neutral">{data.points.length} bars</Badge> actual intraday prints from
        configured market providers. Rules are applied to recorded prices; nothing is simulated.
      </p>
      </TerminalShell>
    </>
  );
}
