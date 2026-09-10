"use client";

import React, { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ShieldCheck, Lock, Binary, Cpu } from "lucide-react";

export function NetworkNodes() {
  const [activeNode, setActiveNode] = useState<number | null>(null);

  const nodes = [
    { id: 1, title: "Deterministic Engine", desc: "Pure stateless math. 0 wall-clock or external calls during calculation.", icon: Binary, x: "20%", y: "30%" },
    { id: 2, title: "Keccak-256 Merkle Tree", desc: "Sorted-pair leaves constructed from every account risk decision.", icon: Lock, x: "50%", y: "20%" },
    { id: 3, title: "Sepolia MochaAnchor", desc: "Root anchored on Ethereum testnet at 20:00 ET daily.", icon: ShieldCheck, x: "80%", y: "35%" },
    { id: 4, title: "Fact-Grounded Copilot", desc: "Groq LLM narrates decided facts only. Zero hallucinations.", icon: Cpu, x: "50%", y: "75%" },
  ];

  return (
    <div className="relative w-full rounded-2xl overflow-hidden glass-panel border border-[#231F42] p-8">
      {/* Background Graphic */}
      <div className="absolute inset-0 z-0 opacity-25 mix-blend-screen pointer-events-none">
        <Image
          src="/assets/network.jpg"
          alt="Cryptographic verification network"
          fill
          className="object-cover object-center"
        />
      </div>

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {nodes.map((node) => {
          const Icon = node.icon;
          const isActive = activeNode === node.id;
          return (
            <motion.div
              key={node.id}
              onMouseEnter={() => setActiveNode(node.id)}
              onMouseLeave={() => setActiveNode(null)}
              whileHover={{ y: -4 }}
              className={`p-5 rounded-xl border transition-all duration-300 bg-[#0B0A14]/90 ${
                isActive
                  ? "border-[#7C3AED] shadow-[0_0_20px_rgba(124,58,237,0.35)]"
                  : "border-[#231F42]"
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-[#7C3AED]/15 border border-[#7C3AED]/30 flex items-center justify-center text-[#C4B5FD] mb-3">
                <Icon className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-semibold text-white tracking-wide mb-1">
                {node.title}
              </h4>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                {node.desc}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
