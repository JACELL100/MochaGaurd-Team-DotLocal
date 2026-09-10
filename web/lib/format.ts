import type { Action, Phase, TonightStatus } from "./types";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function money(v: number | null | undefined, cents = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return (cents ? usd2 : usd0).format(v);
}

export function compactMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return usd0.format(v);
}

export function int(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return num0.format(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${(v * 100).toFixed(digits)}%`;
}

export function lev(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${v.toFixed(v >= 10 ? 0 : 1)}x`;
}

export function shares(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return num0.format(Math.round(Math.abs(v)));
}

export function timeIn(ts: string | Date, tz: string, withZone = true): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  if (Number.isNaN(d.getTime())) return "–";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      ...(withZone ? { timeZoneName: "short" } : {}),
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function dateTimeIn(ts: string | Date, tz: string): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  if (Number.isNaN(d.getTime())) return "–";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export const etTime = (ts: string | Date) => timeIn(ts, "America/New_York");
export const etDateTime = (ts: string | Date) => dateTimeIn(ts, "America/New_York");

export function phaseLabel(p: Phase): string {
  switch (p) {
    case "pre":
      return "Pre-market";
    case "open":
      return "Open session";
    case "closing_ramp":
      return "Closing ramp";
    case "closed":
      return "Closed";
  }
}

export function actionLabel(a: Action): string {
  switch (a) {
    case "hold":
      return "Hold";
    case "reduce":
      return "Reduce";
    case "margin_call":
      return "Margin call";
    case "close":
      return "Close";
    case "freeze":
      return "Frozen";
  }
}

export type Tone = "neutral" | "safe" | "warn" | "danger" | "accent";

export function actionTone(a: Action): Tone {
  switch (a) {
    case "hold":
      return "safe";
    case "reduce":
      return "warn";
    case "margin_call":
    case "close":
      return "danger";
    case "freeze":
      return "accent";
  }
}

export function statusTone(s: TonightStatus): Tone {
  return s === "safe" ? "safe" : s === "auto_derisk" ? "danger" : "warn";
}

export function shortHash(h: string | null | undefined, n = 6): string {
  if (!h) return "–";
  return h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h;
}

export function tzCity(tz: string): string {
  const city = tz.split("/").pop() ?? tz;
  return city.replace(/_/g, " ");
}
