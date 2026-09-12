"use client";

import React from "react";
import Link from "next/link";
import { NetworkNodes } from "../ui/NetworkNodes";
import { StatusBadge } from "../ui/StatusBadge";
import { ShieldCheck, ExternalLink, CheckCircle2, Lock } from "lucide-react";

export function TrustProof() {
  return (
    <section className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="text-center max-w-3xl mx-auto mb-14">
        <StatusBadge tone="safe">Cryptographic Tamper-Evidence</StatusBadge>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mt-3">
          On-Chain Proof of Fair Liquidation
        </h2>
        <p className="text-sm sm:text-base text-[#94A3B8] mt-3">
          Every risk decision is cryptographically sorted into a Keccak-256 Merkle tree and anchored directly onto Sepolia.
          Traders, brokers, and auditors can independently verify any historical decision against the blockchain.
        </p>
      </div>

      <NetworkNodes />

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div className="p-4 rounded-xl glass-panel border border-[#231F42]">
          <div className="text-xs font-mono uppercase text-[#94A3B8]">Smart Contract</div>
          <div className="text-sm font-bold font-mono text-white mt-1 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-[#A78BFA]" />
            MochaAnchor.sol
          </div>
          <a
            href="https://sepolia.etherscan.io/address/0x59cfFc2096E838EB240A93948B5333A6a211224f"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-[#A78BFA] hover:text-white mt-1 flex items-center justify-center gap-1 transition-colors"
          >
            0x59cf…224f <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>

        <div className="p-4 rounded-xl glass-panel border border-[#231F42]">
          <div className="text-xs font-mono uppercase text-[#94A3B8]">Proof Algorithm</div>
          <div className="text-sm font-bold font-mono text-emerald-400 mt-1 flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Sorted-Pair Keccak-256
          </div>
          <div className="text-[11px] text-[#64748B] mt-1">O(log n) gasless client verification</div>
        </div>

        <div className="p-4 rounded-xl glass-panel border border-[#231F42]">
          <div className="text-xs font-mono uppercase text-[#94A3B8]">Zero PII Leakage</div>
          <div className="text-sm font-bold font-mono text-[#C4B5FD] mt-1 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#C4B5FD]" />
            Pure Hash Commitments
          </div>
          <div className="text-[11px] text-[#64748B] mt-1">No personal or account data touches chain</div>
        </div>
      </div>

      <div className="mt-10 text-center">
        <Link
          href="/verify"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-semibold text-white bg-[#121024] hover:bg-[#181530] border border-[#7C3AED]/50 shadow-[0_0_20px_rgba(124,58,237,0.3)] transition-all"
        >
          Launch Interactive Merkle Verifier <ExternalLink className="w-3.5 h-3.5 text-[#A78BFA]" />
        </Link>
      </div>
    </section>
  );
}
