"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Moon, User } from "lucide-react";

import { createClient } from "@/lib/supabase/browser";
import type { Viewer } from "@/lib/supabase/server";

/** Two initials from a display name, else the email's first letter. */
function initials(viewer: Viewer): string {
  const source = viewer.name?.trim() || viewer.email;
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * Signed-in identity in the header.
 *
 * The header is a client component with no server session, so the viewer is read from Supabase
 * in the browser and kept in sync with `onAuthStateChange` — otherwise the bar keeps saying
 * "Sign In" to somebody who is already signed in until a hard reload.
 */
export function UserMenu({
  initialViewer = null,
  resolved = false,
}: {
  initialViewer?: Viewer | null;
  /** True when the server already determined the session either way, signed in or out. */
  resolved?: boolean;
}) {
  const router = useRouter();
  // Seeded from the server so the first paint is already correct, then kept live below.
  const [viewer, setViewer] = useState<Viewer | null>(initialViewer);
  const [ready, setReady] = useState(resolved);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      // Supabase is not configured in the browser. The server already decided what to show,
      // so there is nothing to synchronise and no state to set here.
      return;
    }

    const read = (user: { email?: string | null; user_metadata?: Record<string, unknown> } | null) => {
      if (!user?.email) return setViewer(null);
      const meta = user.user_metadata ?? {};
      setViewer({
        email: user.email,
        name: (meta.full_name as string) ?? (meta.name as string) ?? null,
        avatar: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
      });
    };

    supabase.auth.getUser().then(({ data }) => {
      read(data.user);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      read(session?.user ?? null);
      setBrokenAvatar(false);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      setOpen(false);
      router.replace("/");
      router.refresh(); // server components hold the session in a cookie; force a re-render
    } finally {
      setSigningOut(false);
    }
  }

  // Only a genuinely unresolved session reserves a blank slot. A signed-out viewer gets the
  // real Sign In button on the server, so it is never hidden behind hydration.
  if (!ready && !viewer) {
    return <div className="h-8 w-8 rounded-full bg-[#121024] border border-[#231F42]" />;
  }

  if (!viewer) {
    return (
      <Link
        href="/login"
        className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:from-[#8B5CF6] hover:to-[#7C3AED] shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all transform hover:-translate-y-0.5 active:translate-y-0"
      >
        Sign In
      </Link>
    );
  }

  const label = viewer.name ?? viewer.email;
  const showPhoto = viewer.avatar && !brokenAvatar;

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition-all hover:bg-[#121024]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"
      >
        {showPhoto ? (
          // Supabase avatars are remote Google URLs; a plain <img> avoids next/image host config.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={viewer.avatar!}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBrokenAvatar(true)}
            className="h-8 w-8 rounded-full border border-[#7C3AED]/50 object-cover shadow-[0_0_12px_rgba(124,58,237,0.35)]"
          />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full border border-[#7C3AED]/50 bg-gradient-to-br from-[#7C3AED] to-[#6D28D9] text-[11px] font-bold text-white shadow-[0_0_12px_rgba(124,58,237,0.35)]">
            {initials(viewer)}
          </span>
        )}
        <span className="hidden max-w-[9rem] truncate text-xs font-medium text-[#CBD5E1] lg:block">
          {label}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-[#231F42] bg-[#0B0A14]/95 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
          <div className="border-b border-[#1C1836] px-4 py-3">
            <p className="truncate text-sm font-semibold text-white">{viewer.name ?? "Signed in"}</p>
            <p className="truncate text-xs text-[#94A3B8]">{viewer.email}</p>
          </div>
          <Link
            href="/tonight"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#CBD5E1] transition-colors hover:bg-[#121024]"
          >
            <Moon className="h-3.5 w-3.5 text-[#A78BFA]" />
            My overnight briefing
          </Link>
          <Link
            href="/simulate"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#CBD5E1] transition-colors hover:bg-[#121024]"
          >
            <User className="h-3.5 w-3.5 text-[#A78BFA]" />
            Leverage simulator
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 border-t border-[#1C1836] px-4 py-2.5 text-left text-xs text-[#FDA4AF] transition-colors hover:bg-[#121024] disabled:opacity-60"
          >
            <LogOut className="h-3.5 w-3.5" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
