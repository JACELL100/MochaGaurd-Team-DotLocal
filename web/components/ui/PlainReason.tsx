import type { PlainReason as Plain } from "@/lib/types";

const TONE = {
  ok: { ring: "border-emerald-500/30", chip: "bg-emerald-500/15 text-emerald-300", icon: "✓" },
  info: { ring: "border-sky-500/30", chip: "bg-sky-500/15 text-sky-300", icon: "i" },
  warning: { ring: "border-amber-500/35", chip: "bg-amber-500/15 text-amber-300", icon: "!" },
  critical: { ring: "border-rose-500/40", chip: "bg-rose-500/15 text-rose-300", icon: "!" },
} as const;

/**
 * The reason a decision happened, in ordinary language.
 *
 * The engine also emits a terse machine string (`equity=79432 margin_req=95000 …`). That is
 * useful in a log and useless to a person, so screens render this instead and keep the raw
 * string behind a disclosure for auditors.
 */
export function PlainReason({ plain, raw }: { plain?: Plain; raw?: string }) {
  if (!plain) {
    return raw ? <p className="text-xs text-[#94A3B8]">{raw}</p> : null;
  }
  const tone = TONE[plain.severity] ?? TONE.info;
  return (
    <div className={`rounded-xl border ${tone.ring} bg-[#05050A]/60 p-4`}>
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${tone.chip}`}
          aria-hidden
        >
          {tone.icon}
        </span>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold leading-snug text-white">{plain.headline}</p>
          <p className="text-xs leading-relaxed text-[#CBD5E1]">{plain.why}</p>
          {plain.next && (
            <p className="text-xs leading-relaxed text-[#A78BFA]">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-[#94A3B8]">
                What happens next ·{" "}
              </span>
              {plain.next}
            </p>
          )}
          {raw && (
            <details className="pt-1">
              <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-[#64748B] hover:text-[#94A3B8]">
                Engine detail
              </summary>
              <code className="mt-1 block break-all font-mono text-[11px] text-[#64748B]">{raw}</code>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
