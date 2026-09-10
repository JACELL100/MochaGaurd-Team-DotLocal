"use client";

import React, { useRef } from "react";
import { motion } from "framer-motion";

interface GlowingCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
  onClick?: () => void;
}

export function GlowingCard({
  children,
  className = "",
  glowColor = "rgba(124, 58, 237, 0.28)",
  onClick,
}: GlowingCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cardRef.current.style.setProperty("--mouse-x", `${x}px`);
    cardRef.current.style.setProperty("--mouse-y", `${y}px`);
  };

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{
        transform: "translate3d(0, 0, 0)",
        willChange: "transform",
      }}
      className={`group relative overflow-hidden rounded-2xl bg-[#0B0A14]/90 border border-[#231F42] p-6 transition-all duration-300 hover:border-[#7C3AED]/45 hover:shadow-[0_12px_35px_-10px_rgba(124,58,237,0.18)] ${className}`}
    >
      {/* Zero-re-render Radial Mouse-Follow Violet Spotlight */}
      <div
        className="pointer-events-none absolute -inset-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: `radial-gradient(350px circle at var(--mouse-x, -999px) var(--mouse-y, -999px), ${glowColor}, transparent 70%)`,
        }}
      />

      {/* Subtle top-edge light highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#A78BFA]/30 to-transparent" />

      {/* Content wrapper */}
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

