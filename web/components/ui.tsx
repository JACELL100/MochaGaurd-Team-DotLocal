import Link from "next/link";
import type { ReactNode } from "react";

import type { Tone } from "@/lib/format";

const toneText: Record<Tone, string> = {
  neutral: "text-foreground",
  safe: "text-safe",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent",
};

const toneBadge: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  safe: "bg-safe-soft text-safe border-safe/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  accent: "bg-accent-soft text-accent border-accent/30",
};

const toneBanner: Record<Tone, string> = {
  neutral: "border-border bg-surface",
  safe: "border-safe/40 bg-safe-soft",
  warn: "border-warn/40 bg-warn-soft",
  danger: "border-danger/40 bg-danger-soft",
  accent: "border-accent/40 bg-accent-soft",
};

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-foreground">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${toneText[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className = "",
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneBadge[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Banner({
  tone,
  icon,
  title,
  body,
  aside,
}: {
  tone: Tone;
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-4 rounded-2xl border p-6 md:flex-row md:items-center md:justify-between ${toneBanner[tone]}`}>
      <div className="flex items-start gap-4">
        {icon && <div className={`text-4xl leading-none ${toneText[tone]}`}>{icon}</div>}
        <div>
          <h1 className={`text-2xl font-semibold tracking-tight ${toneText[tone]}`}>{title}</h1>
          {body && <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/80">{body}</p>}
        </div>
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function SourceBadge({ live, error }: { live: boolean; error?: string | null }) {
  return live ? (
    <Badge tone="safe" title="Data served by the FastAPI engine">
      <span className="size-1.5 rounded-full bg-safe" /> Live engine
    </Badge>
  ) : (
    <Badge tone="danger" title={error ?? "Live service unavailable"}>
      <span className="size-1.5 rounded-full bg-danger" /> Live data unavailable
    </Badge>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">{children}</div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] ${className}`}>{children}</code>;
}

export function VerifyLink({ id, children }: { id: number | null; children?: ReactNode }) {
  if (id === null) return <span className="text-muted">–</span>;
  return (
    <Link href={`/verify?id=${id}`} className="font-mono text-xs text-accent underline-offset-2 hover:underline">
      {children ?? `#${id}`}
    </Link>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none";
export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:brightness-110 disabled:opacity-50";
export const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition hover:border-accent/50";
