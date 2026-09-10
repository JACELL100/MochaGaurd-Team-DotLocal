"use client";

import React from "react";

export type StatusTone = "safe" | "warn" | "danger" | "accent" | "neutral";

interface StatusBadgeProps {
  tone?: StatusTone;
  children: React.ReactNode;
  pulsing?: boolean;
  className?: string;
}

export function StatusBadge({
  tone = "accent",
  children,
  pulsing = true,
  className = "",
}: StatusBadgeProps) {
  const styles = {
    safe: {
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      text: "text-emerald-400",
      dot: "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]",
    },
    warn: {
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      text: "text-amber-300",
      dot: "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
    },
    danger: {
      bg: "bg-rose-500/10",
      border: "border-rose-500/30",
      text: "text-rose-400",
      dot: "bg-rose-400 shadow-[0_0_8px_rgba(239,68,68,0.8)]",
    },
    accent: {
      bg: "bg-[#7C3AED]/15",
      border: "border-[#7C3AED]/35",
      text: "text-[#C4B5FD]",
      dot: "bg-[#A78BFA] shadow-[0_0_8px_rgba(124,58,237,0.8)]",
    },
    neutral: {
      bg: "bg-slate-800/40",
      border: "border-slate-700/50",
      text: "text-slate-300",
      dot: "bg-slate-400 shadow-[0_0_6px_rgba(148,163,184,0.5)]",
    },
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md transition-all ${styles.bg} ${styles.border} ${styles.text} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${styles.dot} ${
          pulsing ? "animate-pulse" : ""
        }`}
      />
      {children}
    </span>
  );
}
