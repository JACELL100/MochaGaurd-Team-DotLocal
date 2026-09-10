"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield } from "lucide-react";
import { StatusBadge } from "../ui/StatusBadge";
import type { Viewer } from "@/lib/supabase/server";
import { UserMenu } from "./UserMenu";

export function Header({ viewer = null }: { viewer?: Viewer | null }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const isScrolled = window.scrollY > 20;
          setScrolled((prev) => (prev !== isScrolled ? isScrolled : prev));
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navLinks = [
    { name: "Live Book", href: "/#console" },
    { name: "Tonight (2 AM)", href: "/tonight" },
    { name: "Replay", href: "/replay" },
    { name: "Score", href: "/score" },
    { name: "Verify (Sepolia)", href: "/verify" },
    { name: "Simulate", href: "/simulate" },
  ];

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#05050A]/85 backdrop-blur-xl border-b border-[#231F42] shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo with Royal Violet Pulsing Core */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-8 h-8 rounded-lg bg-[#121024] border border-[#7C3AED]/40 flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.4)] group-hover:border-[#A78BFA] transition-all">
            <Shield className="w-4 h-4 text-[#A78BFA]" />
            <div className="absolute inset-0 rounded-lg bg-[#7C3AED]/20 blur-sm group-hover:bg-[#7C3AED]/40 transition-all" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              MochaGuard
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#7C3AED]/20 text-[#C4B5FD] border border-[#7C3AED]/30">
                v2.0
              </span>
            </span>
          </div>
        </Link>

        {/* Center Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.name}
                href={link.href}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[#7C3AED]/20 text-[#C4B5FD] border border-[#7C3AED]/40 shadow-[0_0_10px_rgba(124,58,237,0.2)]"
                    : "text-[#94A3B8] hover:text-white hover:bg-[#121024]/60"
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </nav>

        {/* Right Status Indicator & Action CTA */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex">
            <StatusBadge tone="safe" pulsing={true}>
              Sepolia Testnet Active
            </StatusBadge>
          </div>
          {/* Resolves the live Supabase session: avatar when signed in, Sign In when not. */}
          <UserMenu initialViewer={viewer} resolved />
        </div>
      </div>
    </header>
  );
}
