"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/browser";

/**
 * Email/password sign-in for local development.
 *
 * Google OAuth needs the callback URL to be in Supabase's redirect allow-list. When it is not,
 * Supabase silently falls back to the project's Site URL — which is why signing in from
 * localhost lands on the deployed site. Password auth carries no redirect at all, so it works
 * on any origin without touching project settings.
 *
 * Rendered only when the page is served from localhost, so it cannot appear in production.
 */
export function DevPasswordSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { error: failure } = await createClient().auth.signInWithPassword({ email, password });
      if (failure) throw failure;
      router.replace("/tonight");
      router.refresh(); // server components read the session from cookies
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-xs font-mono uppercase tracking-wider text-[#94A3B8]">
        Email
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#231F42] bg-[#05050A] px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#7C3AED]"
        />
      </label>
      <label className="block text-xs font-mono uppercase tracking-wider text-[#94A3B8]">
        Password
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#231F42] bg-[#05050A] px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#7C3AED]"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] py-2.5 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in with email"}
      </button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <p className="text-[11px] leading-4 text-[#64748B]">
        Local development only. Create or reset this account with{" "}
        <code className="text-[#94A3B8]">python scripts/dev_user.py &lt;email&gt; &lt;password&gt;</code>{" "}
        in the api directory.
      </p>
    </form>
  );
}
