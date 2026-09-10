import Link from "next/link";
import { redirect } from "next/navigation";

import { headers } from "next/headers";

import { DevPasswordSignIn } from "@/components/DevPasswordSignIn";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { Card, PageHeader } from "@/components/ui";
import { accessToken } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <LoginContent searchParams={searchParams} />;
}

async function LoginContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // Already signed in: showing a sign-in form to a signed-in user is a dead end.
  if (!error && (await accessToken())) redirect("/tonight");

  // Decide on the server from the request's own Host header. A client-side check cannot work
  // here: the gated subtree is excluded from the server render, so its code never reaches the
  // browser to un-hide itself. Deployed hosts are never local, so this cannot leak.
  const host = (await headers()).get("host") ?? "";
  const hostname = host.split(":")[0].toLowerCase();
  const isLocal =
    ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname) || hostname.endsWith(".local");
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Sign in to Mochatrade" subtitle="Use the Google account enabled in Supabase Auth." />
      <Card title="Secure risk access" subtitle="Your session stays in Supabase; the dashboard sends its token only to the Mochatrade risk API.">
        <GoogleSignInButton />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {/* Google OAuth returns to whatever Supabase's redirect allow-list permits, which is why
            signing in from localhost can land on the deployed site. Password auth uses no
            redirect, so it always stays on this origin. Shown only on a local host. */}
        {isLocal && (
          <div className="mt-6 border-t border-[#231F42] pt-5">
            <p className="mb-3 text-[11px] font-mono uppercase tracking-wider text-[#A78BFA]">
              Local development sign-in
            </p>
            <DevPasswordSignIn />
          </div>
        )}
        <p className="mt-5 text-xs leading-5 text-muted">
          By continuing, you access only your linked Mochatrade account. Staff access is granted by the server-side allowlist.
          <Link href="/tonight" className="ml-1 text-accent hover:underline">Back to Tonight</Link>
        </p>
      </Card>
    </div>
  );
}
