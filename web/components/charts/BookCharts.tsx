"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { compactMoney, pct } from "@/lib/format";
import type { Concentration, HealthBucket } from "@/lib/types";

const tooltipStyle = {
  contentStyle: { background: "#1d1916", border: "1px solid #2b251f", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#948a7d" },
  itemStyle: { color: "#f3ede6" },
  cursor: { fill: "#ffffff0a" },
};

export function ConcentrationBars({ data }: { data: Concentration[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <XAxis type="number" hide domain={[0, (max: number) => Math.max(max * 1.15, 0.05)]} />
          <YAxis type="category" dataKey="symbol" width={56} tick={{ fill: "#948a7d", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            {...tooltipStyle}
            formatter={(value, _name, item) => [
              `${pct(Number(value), 1)} · ${compactMoney((item.payload as Concentration).notional)}`,
              "Share of gross",
            ]}
          />
          <Bar dataKey="share" radius={[0, 6, 6, 0]} label={{ position: "right", fill: "#f3ede6", fontSize: 12, formatter: (v: unknown) => pct(Number(v), 0) }}>
            {data.map((d, i) => (
              <Cell key={d.symbol} fill={i === 0 ? "#d4a05a" : "#8a6a3c"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const bucketColor = (bucket: string) =>
  bucket === "<1.0" ? "#f26d6d" : bucket.startsWith("1.0") ? "#f5b942" : bucket.startsWith("1.25") ? "#d4a05a" : "#3ecf8e";

export function HealthHistogram({ data }: { data: HealthBucket[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -16, right: 8, top: 12, bottom: 0 }}>
          <XAxis dataKey="bucket" tick={{ fill: "#948a7d", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#948a7d", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipStyle} formatter={(v) => [String(v), "Accounts"]} labelFormatter={(l) => `Equity / margin required: ${l}`} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} label={{ position: "top", fill: "#948a7d", fontSize: 11 }}>
            {data.map((d) => (
              <Cell key={d.bucket} fill={bucketColor(d.bucket)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
