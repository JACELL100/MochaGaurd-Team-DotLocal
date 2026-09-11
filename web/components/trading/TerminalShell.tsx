import type { ReactNode } from "react";

import { SourceBadge } from "@/components/ui";

/**
 * The chrome every signed-in page wears, so the app reads as one terminal rather than a set of
 * documents.
 *
 * A trading screen does three things a marketing page does not: it names the instrument or
 * workspace in a tight monospaced strip, it keeps connection state permanently visible, and it
 * spends no vertical space on prose. So the title is small and uppercase, the live badge is
 * always in the same corner, and the description is one line that can be skipped.
 */
export function TerminalShell({
  eyebrow,
  title,
  meta,
  live,
  error,
  actions,
  children,
}: {
  /** Workspace label — the section of the terminal you are in. */
  eyebrow: string;
  title: string;
  /** Key/value chips: the facts a trader reads before anything else. */
  meta?: Array<{ label: string; value: ReactNode; tone?: "default" | "accent" | "warn" | "danger" }>;
  live: boolean;
  error?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full">
      {/* Instrument strip */}
      <div className="border-b border-[#1C1836] bg-[#07060F]/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7C3AED]">
                {eyebrow}
              </span>
              <span className="text-sm font-semibold tracking-tight text-white">{title}</span>
            </div>

            {meta && meta.length > 0 && (
              <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                {meta.map((item) => (
                  <div key={item.label} className="flex items-baseline gap-1.5">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
                      {item.label}
                    </dt>
                    <dd
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        item.tone === "accent"
                          ? "text-[#C4B5FD]"
                          : item.tone === "warn"
                            ? "text-amber-300"
                            : item.tone === "danger"
                              ? "text-rose-400"
                              : "text-[#E2E8F0]"
                      }`}
                    >
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            <SourceBadge live={live} error={error} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}

/**
 * A labelled panel. Terminals divide the screen into framed modules with a thin caption bar,
 * not into cards floating in whitespace.
 */
export function Panel({
  title,
  hint,
  right,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-[#231F42] bg-[#0B0A14]/70 ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1C1836] bg-[#07060F]/60 px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#94A3B8]">
            {title}
          </h2>
          {hint && <span className="truncate text-[10px] text-[#64748B]">{hint}</span>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
