"use client";

import { buttonClass } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger-soft p-8">
      <h1 className="text-xl font-semibold text-danger">Something broke in the dashboard</h1>
      <p className="mt-2 text-sm text-foreground/80">
        The engine itself is unaffected: the dashboard is strictly downstream of every decision.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-background/60 p-3 font-mono text-xs text-muted">
        {error.message}
        {error.digest ? `\n(digest ${error.digest})` : ""}
      </pre>
      <button type="button" onClick={reset} className={`${buttonClass} mt-4`}>
        Try again
      </button>
    </div>
  );
}
