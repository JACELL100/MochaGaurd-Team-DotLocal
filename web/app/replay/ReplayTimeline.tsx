"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EVENT_COLORS, ReplayChart } from "@/components/charts/ReplayChart";
import { Badge, Card, Mono, VerifyLink, ghostButtonClass } from "@/components/ui";
import { etDateTime, etTime, lev, money, phaseLabel, pct, shares } from "@/lib/format";
import type { ReplayEvent, ReplayResult } from "@/lib/types";

const KIND_LABEL: Record<ReplayEvent["kind"], string> = {
  freeze: "Freeze",
  ramp_start: "Ramp",
  reduce: "Reduce",
  margin_call: "Margin call",
  close: "Close",
  liquidation: "Liquidation",
  earnings: "Earnings",
  gap: "Gap",
  anchor: "Anchored",
};

export function ReplayTimeline({ replay }: { replay: ReplayResult }) {
  const points = replay.points ?? [];
  const events = replay.events ?? [];
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCursor((c) => {
        if (c >= points.length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [playing, points.length]);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  const current = points[cursor];
  const cursorTime = current ? new Date(current.ts).getTime() : 0;
  const passed = useMemo(() => events.filter((e) => new Date(e.ts).getTime() <= cursorTime), [events, cursorTime]);
  const latest = passed[passed.length - 1];
  const priceChange = current && points[0] ? current.price / points[0].price - 1 : 0;

  const jumpTo = (e: ReplayEvent) => {
    const t = new Date(e.ts).getTime();
    let best = 0;
    let dist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(new Date(p.ts).getTime() - t);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setPlaying(false);
    setCursor(best);
  };

  if (!current) return null;

  return (
    <div className="space-y-4">
      <Card
        title={`${replay.symbol} · ${replay.date}`}
        subtitle="Actual price bars (left) with the current permitted leverage rule (right)."
        action={
          <div className="flex items-center gap-2">
            <button type="button" className={ghostButtonClass} onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : cursor >= points.length - 1 ? "Replay" : "Play"}
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => {
                setPlaying(false);
                setCursor(0);
              }}
            >
              Reset
            </button>
          </div>
        }
      >
        <ReplayChart points={points} events={events} cursor={cursor} onCursor={(i) => {
          setPlaying(false);
          setCursor(i);
        }} />
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={cursor}
          onChange={(e) => {
            setPlaying(false);
            setCursor(Number(e.target.value));
          }}
          className="mt-3 w-full"
          aria-label="Timeline"
        />
        <div className="mt-1 flex justify-between text-[11px] text-muted">
          <span>{etDateTime(points[0].ts)}</span>
          <span>{etDateTime(points[points.length - 1].ts)}</span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="At the cursor" className="lg:col-span-1">
          <dl className="tabular grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-muted">Time</dt>
            <dd className="text-right font-medium">{etTime(current.ts)}</dd>
            <dt className="text-muted">Phase</dt>
            <dd className="text-right">
              <Badge tone={current.phase === "closing_ramp" ? "warn" : current.phase === "open" ? "safe" : "neutral"}>
                {phaseLabel(current.phase)}
                {current.phase === "closing_ramp" && ` ${pct(current.ramp, 0)}`}
              </Badge>
            </dd>
            <dt className="text-muted">Price</dt>
            <dd className="text-right font-medium">
              {money(current.price, true)}{" "}
              <span className={priceChange < 0 ? "text-danger" : "text-safe"}>({pct(priceChange, 1)})</span>
            </dd>
            <dt className="text-muted">Allowed leverage</dt>
            <dd className="text-right text-lg font-semibold text-accent">{current.frozen ? "frozen" : lev(current.max_leverage)}</dd>
            <dt className="text-muted">Events so far</dt>
            <dd className="text-right">{passed.length} / {events.length}</dd>
          </dl>
          {latest && (
            <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                <span className="inline-block size-2 rounded-full" style={{ background: EVENT_COLORS[latest.kind] }} />
                Latest: {KIND_LABEL[latest.kind]} · {etTime(latest.ts)}
              </div>
              {latest.note}
            </div>
          )}
        </Card>

        <Card
          title="Timeline"
          subtitle="Recorded market-session events only. This historical view does not create or replay trades."
          className="lg:col-span-2"
        >
          <ol className="relative space-y-1 border-l border-border pl-4">
            {events.map((e, i) => {
              const done = new Date(e.ts).getTime() <= cursorTime;
              return (
                <li key={`${e.kind}-${e.ts}-${i}`} className="relative">
                  <span
                    className="absolute -left-[21px] top-2.5 size-2.5 rounded-full border-2 border-background"
                    style={{ background: done ? EVENT_COLORS[e.kind] : "#2b251f" }}
                  />
                  <button
                    type="button"
                    onClick={() => jumpTo(e)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-surface-2 ${done ? "" : "opacity-50"}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular w-[92px] shrink-0 text-xs text-muted">{etTime(e.ts)}</span>
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: EVENT_COLORS[e.kind] }}>
                        {KIND_LABEL[e.kind]}
                      </span>
                      {e.symbol && <span className="font-medium">{e.symbol}</span>}
                      {e.account_id && <Mono>{e.account_id}</Mono>}
                      {e.qty ? <span className="text-muted">{shares(e.qty)} sh</span> : null}
                      {e.fill_price ? (
                        <span className="text-muted">
                          fill {money(e.fill_price, true)} · {e.slippage_bps} bps
                        </span>
                      ) : null}
                      {e.decision_id !== null && (
                        <span className="ml-auto">
                          <VerifyLink id={e.decision_id}>verify #{e.decision_id} →</VerifyLink>
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-foreground/75">{e.note}</p>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-muted">Every displayed price came from the persisted live data feed.</p>
        </Card>
      </div>
    </div>
  );
}
