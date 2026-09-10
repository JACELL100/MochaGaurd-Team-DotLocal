"use client";

import { useState } from "react";

import { buttonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

export function GoogleSignInButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/tonight` },
      });
      if (signInError) throw signInError;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google sign-in could not start.");
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" className={buttonClass} disabled={pending} onClick={signIn}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
