"use client";

import React, { useState } from "react";
import { Bell, Radio, Zap, ShieldAlert } from "lucide-react";
import { AlertSentinelModal } from "@/components/AlertSentinelModal";

interface AlertLauncherProps {
  accountId?: string;
  accountName?: string;
  symbol?: string;
}

export function AlertLauncher({
  accountId = "demo-trader-01",
  accountName = "Sample Trader",
  symbol = "NVDA",
}: AlertLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-[#3B82F6]/30 bg-gradient-to-r from-[#0C152B] via-[#101F42] to-[#0B0A14] p-5 shadow-[0_0_30px_rgba(59,130,246,0.12)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6]/20 border border-[#3B82F6]/40 text-[#60A5FA]">
            <Bell className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              Telegram & Siren Sentinel
              <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-full bg-[#3B82F6]/20 border border-[#3B82F6]/40 text-[#93C5FD]">
                Push Alerts
              </span>
            </div>
            <div className="text-xs text-[#94A3B8]">
              Wake up before auto-derisking at 15:45 ET. High-volume alarm, desktop notification, and phone Telegram push.
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:brightness-110 shadow-[0_0_20px_rgba(37,99,235,0.35)] flex items-center gap-2 shrink-0 transition-all"
        >
          <Radio className="w-3.5 h-3.5 text-[#93C5FD]" />
          Configure 2 AM Alerts
        </button>
      </div>

      <AlertSentinelModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        accountId={accountId}
        accountName={accountName}
        symbol={symbol}
      />
    </>
  );
}
