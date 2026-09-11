"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { AlertSentinelModal } from "./AlertSentinelModal";

const LINKS = [
  { href: "/", label: "Book" },
  { href: "/tonight", label: "Tonight" },
  { href: "/stress-test", label: "Stress Test" },
  { href: "/replay", label: "Replay" },
  { href: "/score", label: "Score" },
  { href: "/simulate", label: "Simulate" },
  { href: "/verify", label: "Verify" },
  { href: "/markets", label: "Markets" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const [isAlertOpen, setIsAlertOpen] = useState(false);

  return (
    <>
      <nav className="flex items-center gap-1">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setIsAlertOpen(true)}
          className="ml-1 p-1.5 rounded-lg text-[#C4B5FD] bg-[#121024] border border-[#7C3AED]/30 hover:border-[#7C3AED] transition-colors"
          title="2 AM Sentinel Alerts"
        >
          <Bell className="w-4 h-4 text-[#A78BFA]" />
        </button>
      </nav>

      <AlertSentinelModal isOpen={isAlertOpen} onClose={() => setIsAlertOpen(false)} />
    </>
  );
}
