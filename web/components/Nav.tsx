"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Book" },
  { href: "/tonight", label: "Tonight" },
  { href: "/replay", label: "Replay" },
  { href: "/score", label: "Score" },
  { href: "/simulate", label: "Simulate" },
  { href: "/verify", label: "Verify" },
  { href: "/markets", label: "Markets" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
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
    </nav>
  );
}
