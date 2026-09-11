import type { AccountView } from "@/lib/types";
import { lev, money, pct } from "@/lib/format";

/**
 * The metric strip a broker puts above the blotter, plus the one thing they usually bury:
 * how close this account is to a margin call, and how much of tonight's risk its equity covers.
 *
 * `margin_ratio` is equity ÷ margin required. Below 1.0 the account cannot support its own
 * positions, so the bands are anchored there rather than on an arbitrary scale.
 */

function healthBand(ratio: number | null) {
  if (ratio === null) return { label: "No positions", tone: "neutral", fill: "#3F3A5C", share: 0 };
  if (ratio < 1.0)
    return { label: "Margin call", tone: "critical", fill: "#d03b3b", share: Math.max(0.04, ratio / 3) };
  if (ratio < 1.25)
    return { label: "At risk", tone: "serious", fill: "#ec835a", share: ratio / 3 };
  if (ratio < 1.75)
    return { label: "Thin", tone: "warning", fill: "#fab219", share: ratio / 3 };
  return { label: "Healthy", tone: "good", fill: "#0ca30c", share: Math.min(1, ratio / 3) };
}

function Metric({
  label,
  value,
  hint,
  accent = "text-white",
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#64748B]">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-lg font-bold tabular-nums ${accent}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[10px] text-[#64748B]">{hint}</div>}
    </div>
  );
}

export function AccountHeader({
  account,
  headlineCap = 20,
}: {
  account: AccountView;
  headlineCap?: number;
}) {
  const band = healthBand(account.margin_ratio);
  const used = account.leverage_used ?? 0;
  const levShare = Math.max(0, Math.min(1, used / headlineCap));
  // How much of the account's equity a 99th-percentile gap across every position would take.
  const riskShare =
    account.equity > 0 ? Math.min(1, account.worst_case_loss / account.equity) : 1;

  return (
    <div className="rounded-xl border border-[#231F42] bg-[#0B0A14]/80 p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="Equity"
          value={money(account.equity)}
          hint={`${money(account.cash)} cash`}
        />
        <Metric
          label="Exposure"
          value={money(account.gross_exposure)}
          hint={`${lev(used)} of ${lev(headlineCap)} used`}
          accent="text-[#C4B5FD]"
        />
        <Metric
          label="Margin required"
          value={money(account.margin_required)}
          hint={
            account.margin_ratio !== null ? `${account.margin_ratio.toFixed(2)}× covered` : undefined
          }
        />
        <Metric
          label="If everything gaps"
          value={`−${money(account.worst_case_loss)}`}
          hint={`${pct(riskShare, 0)} of equity`}
          accent="text-amber-300"
        />
        <Metric
          label="Margin health"
          value={account.margin_ratio !== null ? account.margin_ratio.toFixed(2) : "–"}
          hint={band.label}
          accent={
            band.tone === "critical"
              ? "text-rose-400"
              : band.tone === "serious"
                ? "text-orange-300"
                : band.tone === "warning"
                  ? "text-amber-300"
                  : "text-emerald-400"
          }
        />
        <Metric label="Positions" value={String(account.positions.length)} hint="open legs" />
      </div>

      <div className="mt-4 grid gap-4 border-t border-[#1C1836] pt-4 sm:grid-cols-2">
        {/* Leverage used against the advertised ceiling. */}
        <div>
          <div className="mb-1 flex items-baseline justify-between text-[11px]">
            <span className="text-[#94A3B8]">Leverage in use</span>
            <span className="font-mono text-[#C4B5FD]">
              {lev(used)} / {lev(headlineCap)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-[#121024]">
            <div
              className="h-full rounded bg-gradient-to-r from-[#7C3AED] to-[#A78BFA]"
              style={{ width: `${levShare * 100}%` }}
            />
          </div>
        </div>

        {/* Margin health. Status colour + a written band, never colour alone. */}
        <div>
          <div className="mb-1 flex items-baseline justify-between text-[11px]">
            <span className="text-[#94A3B8]">Margin health</span>
            <span className="font-mono" style={{ color: band.fill }}>
              {band.label}
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded bg-[#121024]">
            <div
              className="h-full rounded"
              style={{ width: `${band.share * 100}%`, backgroundColor: band.fill }}
            />
            {/* The 1.0 line: below it the account cannot support its positions. */}
            <div
              className="absolute top-0 h-full w-[2px] bg-[#F8FAFC]/70"
              style={{ left: `${(1 / 3) * 100}%` }}
              title="1.00 — below this a margin call is required"
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-[#64748B]">
            <span>0</span>
            <span>1.00 call</span>
            <span>3.00+</span>
          </div>
        </div>
      </div>
    </div>
  );
}
