"use client";

import React from "react";

export function Divider({ className = "" }: { className?: string }) {
  return (
    <div className={`relative w-full py-8 flex items-center justify-center ${className}`}>
      {/* Outer subtle line */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-[#231F42] to-transparent" />

      {/* Center glowing Royal Violet line accent */}
      <div className="absolute w-1/3 h-px bg-gradient-to-r from-transparent via-[#7C3AED] to-transparent shadow-[0_0_12px_#7C3AED]" />

      {/* Center node */}
      <div className="absolute w-2 h-2 rounded-full bg-[#05050A] border border-[#A78BFA] shadow-[0_0_8px_#A78BFA]" />
    </div>
  );
}
