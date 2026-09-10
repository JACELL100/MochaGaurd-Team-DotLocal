"use client";

import React from "react";
import Link from "next/link";
import { Shield, ExternalLink, CheckCircle2 } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative border-t border-[#231F42] bg-[#05050A] text-[#94A3B8] py-12 px-4 sm:px-6 lg:px-8 mt-24">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#121024] border border-[#7C3AED]/30 flex items-center justify-center">
            <Shield className="w-3.5 h-3.5 text-[#A78BFA]" />
          </div>
          <span className="text-sm font-semibold text-white">MochaGuard Risk</span>
          <span className="text-xs text-[#64748B]">· Deterministic Portfolio & Margin Intelligence</span>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs">
          <Link href="/verify" className="hover:text-[#C4B5FD] transition-colors flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            MochaAnchor On-Chain Verifier
          </Link>
          <Link href="/replay" className="hover:text-white transition-colors">
            Timeline Replay
          </Link>
          <Link href="/tonight" className="hover:text-white transition-colors">
            Overnight Margin
          </Link>
          <a
            href="https://sepolia.etherscan.io"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors flex items-center gap-1"
          >
            Sepolia Etherscan <ExternalLink className="w-3 h-3 text-[#64748B]" />
          </a>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-[#1C1836] text-[11px] text-[#64748B] text-center flex flex-col sm:flex-row justify-between items-center gap-2">
        <p>© 2026 Mochatrade Risk Systems. All rights reserved.</p>
        <p className="font-mono">Merkle Trees: Keccak-256 · Smart Contract: MochaAnchor.sol</p>
      </div>
    </footer>
  );
}
