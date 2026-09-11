"use client";

import { useRouter } from "next/navigation";

import type { DeskResponse } from "@/lib/types";
import { DeskCharts } from "./DeskCharts";

/**
 * Bridges the server-rendered page to the interactive chart deck.
 *
 * Changing the window is a navigation, not client state: the leverage line must be recomputed
 * per bar on the server, so a wider window is a new request rather than a client-side zoom.
 */
export function DeskChartsPanel({
  desk,
  hours,
  accountId,
}: {
  desk: DeskResponse;
  hours: number;
  accountId?: string;
}) {
  const router = useRouter();

  return (
    <DeskCharts
      desk={{ ...desk, hours }}
      onWindowChange={(next) => {
        const params = new URLSearchParams();
        if (accountId) params.set("account", accountId);
        params.set("hours", String(next));
        router.push(`/tonight?${params.toString()}`, { scroll: false });
      }}
    />
  );
}
