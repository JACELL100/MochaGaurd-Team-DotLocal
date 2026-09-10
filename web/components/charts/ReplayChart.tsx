"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { etTime, lev, money } from "@/lib/format";
import type { ReplayEvent, ReplayPoint } from "@/lib/types";

export const EVENT_COLORS: Record<ReplayEvent["kind"], string> = {
  freeze: "#d4a05a",
  ramp_start: "#948a7d",
  reduce: "#f5b942",
  margin_call: "#f26d6d",
  close: "#f26d6d",
  liquidation: "#f26d6d",
  earnings: "#8ab4f8",
  gap: "#8ab4f8",
  anchor: "#3ecf8e",
};

interface Row extends ReplayPoint {
  i: number;
}

export function ReplayChart({
  points,
  events,
  cursor,
  onCursor,
}: {
  points: ReplayPoint[];
  events: ReplayEvent[];
  cursor: number;
  onCursor: (i: number) => void;
}) {
  const rows: Row[] = points.map((p, i) => ({ ...p, i }));
  const priceOf = (i: number) => rows[i]?.price ?? 0;

  // Snap each event to the nearest bar index so markers align with the series.
  const markers = events
    .map((e) => {
      const t = new Date(e.ts).getTime();
      let best = -1;
      let bestDist = Infinity;
      rows.forEach((r, i) => {
        const d = Math.abs(new Date(r.ts).getTime() - t);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return { ...e, i: best, inRange: bestDist <= 30 * 60 * 1000 };
    })
    .filter((m) => m.i >= 0 && m.inRange && m.kind !== "ramp_start");

  const dayBoundary = rows.findIndex((r, i) => i > 0 && r.ts.slice(0, 10) !== rows[i - 1].ts.slice(0, 10));

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ left: 0, right: 8, top: 12, bottom: 0 }}
          onClick={(state) => {
            const idx = (state as { activeTooltipIndex?: number | string | null } | undefined)?.activeTooltipIndex;
            if (idx !== undefined && idx !== null) onCursor(Number(idx));
          }}
        >
          <CartesianGrid stroke="#2b251f" vertical={false} />
          <XAxis
            dataKey="i"
            type="number"
            domain={[0, rows.length - 1]}
            tickFormatter={(i) => (rows[i] ? etTime(rows[i].ts).replace(" EDT", "").replace(" EST", "") : "")}
            tick={{ fill: "#948a7d", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis
            yAxisId="price"
            orientation="left"
            domain={["auto", "auto"]}
            tick={{ fill: "#948a7d", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v) => money(Number(v))}
          />
          <YAxis
            yAxisId="lev"
            orientation="right"
            domain={[0, 20]}
            tick={{ fill: "#d4a05a", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v) => `${v}x`}
          />
          <Tooltip
            contentStyle={{ background: "#1d1916", border: "1px solid #2b251f", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#948a7d" }}
            labelFormatter={(i) => (rows[Number(i)] ? etTime(rows[Number(i)].ts) : "")}
            formatter={(v, name) => (name === "price" ? [money(Number(v), true), "Price"] : [lev(Number(v)), "Allowed leverage"])}
          />
          {dayBoundary > 0 && (
            <ReferenceLine
              yAxisId="price"
              x={dayBoundary - 0.5}
              stroke="#8ab4f8"
              strokeDasharray="3 3"
              label={{ value: "overnight", fill: "#8ab4f8", fontSize: 10, position: "insideTopRight" }}
            />
          )}
          <Line yAxisId="price" type="monotone" dataKey="price" stroke="#f3ede6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line yAxisId="lev" type="stepAfter" dataKey="max_leverage" stroke="#d4a05a" strokeWidth={2} dot={false} isAnimationActive={false} />
          {markers.map((m, k) => (
            <ReferenceDot
              key={`${m.kind}-${k}`}
              yAxisId="price"
              x={m.i}
              y={priceOf(m.i)}
              r={5}
              fill={EVENT_COLORS[m.kind]}
              stroke="#0d0b0a"
              strokeWidth={1.5}
            />
          ))}
          <ReferenceLine yAxisId="price" x={cursor} stroke="#f3ede6" strokeWidth={1} strokeDasharray="4 4" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
