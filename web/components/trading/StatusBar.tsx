"use client";

import { useEffect, useState } from "react";

/**
 * The always-on strip a trading terminal pins to the screen: what time it is in New York, what
 * the session is doing, and how long until it changes.
 *
 * It ticks client-side because a server-rendered clock is wrong the moment it is sent. The
 * session phase is derived from the ET wall clock rather than fetched, so the bar keeps working
 * even when the engine is unreachable — a dead clock in a trading app reads as a dead app.
 */

const ET = "America/New_York";

interface Session {
  phase: "pre" | "open" | "closing_ramp" | "closed" | "weekend";
  label: string;
  tone: string;
  /** Seconds until the next boundary (open, ramp, or close). */
  until: number;
  untilLabel: string;
}

function etParts(now: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday as string,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function session(now: Date): Session {
  const { weekday, hour, minute, second } = etParts(now);
  const mins = hour * 60 + minute;
  const secs = mins * 60 + second;
  const to = (targetMins: number) => Math.max(0, targetMins * 60 - secs);
  const fmtGap = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (weekday === "Sat" || weekday === "Sun") {
    return {
      phase: "weekend",
      label: "Weekend · US market shut",
      tone: "text-[#64748B]",
      until: 0,
      untilLabel: "opens Monday 9:30",
    };
  }
  if (mins < 4 * 60) {
    return { phase: "closed", label: "Closed", tone: "text-[#64748B]", until: to(4 * 60),
             untilLabel: `pre-market in ${fmtGap(to(4 * 60))}` };
  }
  if (mins < 9 * 60 + 30) {
    return { phase: "pre", label: "Pre-market", tone: "text-sky-300", until: to(9 * 60 + 30),
             untilLabel: `opens in ${fmtGap(to(9 * 60 + 30))}` };
  }
  if (mins < 15 * 60 + 30) {
    return { phase: "open", label: "Open", tone: "text-emerald-400", until: to(15 * 60 + 30),
             untilLabel: `ramp in ${fmtGap(to(15 * 60 + 30))}` };
  }
  if (mins < 16 * 60) {
    return { phase: "closing_ramp", label: "Closing ramp", tone: "text-amber-300",
             until: to(16 * 60), untilLabel: `closes in ${fmtGap(to(16 * 60))}` };
  }
  return { phase: "closed", label: "Closed", tone: "text-[#64748B]", until: 0,
           untilLabel: "opens 9:30 ET" };
}

export function StatusBar({ engineLive }: { engineLive: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // The interval is the subscription; the first tick comes from it on the next frame rather
    // than from a synchronous setState in the effect body, which would cascade a render.
    const id = setInterval(() => setNow(new Date()), 1000);
    const first = requestAnimationFrame(() => setNow(new Date()));
    return () => {
      clearInterval(id);
      cancelAnimationFrame(first);
    };
  }, []);

  // Reserve the strip until the client clock exists, so server and client markup agree.
  if (!now) return <div className="h-[29px] border-b border-[#1C1836] bg-[#05050A]" />;

  const s = session(now);
  const etClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: ET,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
  const localClock = new Intl.DateTimeFormat("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="border-b border-[#1C1836] bg-[#05050A]">
      <div className="mx-auto flex max-w-7xl items-center gap-x-5 gap-y-1 overflow-x-auto px-4 py-1.5 font-mono text-[11px] sm:px-6 lg:px-8">
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${
              s.phase === "open"
                ? "bg-emerald-400"
                : s.phase === "closing_ramp"
                  ? "bg-amber-400"
                  : s.phase === "pre"
                    ? "bg-sky-400"
                    : "bg-[#64748B]"
            }`}
          />
          <span className={`font-semibold ${s.tone}`}>{s.label}</span>
        </span>

        <span className="shrink-0 text-[#64748B]">{s.untilLabel}</span>

        <span className="shrink-0 tabular-nums text-[#CBD5E1]">
          {etClock} <span className="text-[#64748B]">ET</span>
        </span>

        <span className="shrink-0 tabular-nums text-[#94A3B8]">
          {localClock}{" "}
          <span className="text-[#64748B]">{localZone.split("/").pop()?.replace("_", " ")}</span>
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${engineLive ? "bg-emerald-400" : "bg-rose-500"}`} />
          <span className={engineLive ? "text-emerald-400" : "text-rose-400"}>
            {engineLive ? "engine live" : "engine offline"}
          </span>
        </span>
      </div>
    </div>
  );
}
