import type { ClosureWindow, FundingBook, FundingRow } from "@/lib/types";
import { money } from "@/lib/format";

/**
 * What it costs to hold these positions while the market is shut — and when that cost alone
 * becomes fatal.
 *
 * A perp charges funding hourly on the *full notional*, while the loss lands on equity. At 20x
 * that means carry can breach maintenance margin with the price completely unchanged. Venues
 * show a rate; a rate is not actionable. This shows the deadline it implies.
 */

function money0(value: number): string {
  return money(Math.abs(value));
}

function toneFor(row: FundingRow): { text: string; ring: string; chip: string } {
  if (!row.pays) {
    return {
      text: "text-emerald-400",
      ring: "border-emerald-500/25",
      chip: "bg-emerald-500/15 text-emerald-300",
    };
  }
  const hours = row.hours_to_liquidation;
  if (hours !== null && hours <= 24) {
    return { text: "text-rose-400", ring: "border-rose-500/40", chip: "bg-rose-500/15 text-rose-300" };
  }
  if (hours !== null && hours <= 24 * 7) {
    return {
      text: "text-amber-300",
      ring: "border-amber-500/30",
      chip: "bg-amber-500/15 text-amber-300",
    };
  }
  return { text: "text-[#CBD5E1]", ring: "border-[#231F42]", chip: "bg-[#231F42] text-[#94A3B8]" };
}

export function HoldingCost({
  funding,
  book,
  closure,
}: {
  funding: FundingRow[];
  book?: FundingBook;
  closure?: ClosureWindow;
}) {
  if (funding.length === 0) return null;

  const payers = funding.filter((row) => row.pays);
  const soonest = payers
    .filter((row) => row.hours_to_liquidation !== null)
    .sort((a, b) => (a.hours_to_liquidation ?? 0) - (b.hours_to_liquidation ?? 0))[0];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Cost of holding overnight</h3>
          <p className="text-xs text-[#94A3B8]">
            A perpetual charges funding every hour on the whole position, not on your own money.
            At high leverage that bill alone can close you out — even if the price never moves.
          </p>
        </div>
        {book && (
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#64748B]">
              Net per day
            </div>
            <div
              className={`font-mono text-lg font-bold tabular-nums ${
                book.daily_net > 0 ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {book.daily_net > 0 ? "−" : "+"}
              {money0(book.daily_net)}
            </div>
          </div>
        )}
      </div>

      {/* The headline a trader actually needs: a date, not a rate. */}
      {soonest && (
        <div className="mb-3 rounded-xl border border-rose-500/35 bg-rose-500/5 px-4 py-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-rose-300/80">
            If the price never moves at all
          </div>
          <p className="mt-1 text-sm font-semibold text-white">
            {soonest.symbol} closes out {soonest.when} on holding cost alone
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#CBD5E1]">{soonest.plain.why}</p>
        </div>
      )}

      {closure && closure.hours > 0 && (
        <p className="mb-3 text-xs text-[#94A3B8]">
          The US market is shut for{" "}
          <span className="font-mono font-semibold text-[#C4B5FD]">
            {closure.hours.toFixed(0)} hours
          </span>{" "}
          ({closure.label}) — that is{" "}
          <span className="font-mono text-[#C4B5FD]">{closure.multiplier.toFixed(2)}×</span> the
          risk of a normal night, and{" "}
          {closure.hours.toFixed(0)} hours of funding to pay before you can act.
        </p>
      )}

      <ul className="space-y-1.5">
        {funding.map((row) => {
          const tone = toneFor(row);
          return (
            <li
              key={row.symbol}
              className={`rounded-lg border ${tone.ring} bg-[#05050A]/60 px-3 py-2.5`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-white">{row.symbol}</span>
                  <span className="font-mono text-[10px] uppercase text-[#64748B]">
                    {row.side}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${tone.chip}`}>
                    {row.pays ? "you pay" : "you earn"}
                  </span>
                </span>
                <span className="flex items-baseline gap-4 font-mono text-xs tabular-nums">
                  <span className="text-[#64748B]">
                    per day{" "}
                    <span className={tone.text}>
                      {row.pays ? "−" : "+"}
                      {money0(row.daily_cost)}
                    </span>
                  </span>
                  <span className="text-[#64748B]">
                    to next open{" "}
                    <span className="text-[#CBD5E1]">
                      {row.pays ? "−" : "+"}
                      {money0(row.cost_to_next_open)}
                    </span>
                  </span>
                  <span className={`font-semibold ${tone.text}`}>{row.when}</span>
                </span>
              </div>

              {/* How much of the spare equity this leg's carry eats per day. */}
              {row.daily_share_of_buffer !== null && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded bg-[#121024]">
                    <div
                      className="h-full rounded bg-gradient-to-r from-amber-500 to-rose-500"
                      style={{
                        width: `${Math.min(100, row.daily_share_of_buffer * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-[#64748B]">
                    {(row.daily_share_of_buffer * 100).toFixed(0)}% of spare margin per day
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-4 text-[#64748B]">
        Funding is charged on the full position value. A short position earns it when the rate is
        positive. These figures assume the current rate holds — rates move hourly, so the
        deadline moves with them.
      </p>
    </div>
  );
}
