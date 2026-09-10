"use client";

import { usePathname, useRouter } from "next/navigation";

import { inputClass } from "@/components/ui";
import { tzCity } from "@/lib/format";
import type { AccountSummary } from "@/lib/types";

const STATUS_ICON = { safe: "✅", action_needed: "⚠️", auto_derisk: "🛑" } as const;

export function AccountPicker({ accounts, selected }: { accounts: AccountSummary[]; selected: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Account
      <select
        className={`${inputClass} w-auto min-w-64`}
        value={selected}
        onChange={(e) => router.push(`${pathname}?account=${encodeURIComponent(e.target.value)}`)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {STATUS_ICON[a.status]} {a.display_name ?? a.id} · {tzCity(a.tz)} · {a.id}
          </option>
        ))}
      </select>
    </label>
  );
}
