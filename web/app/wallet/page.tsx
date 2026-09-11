import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { WalletConnector } from "@/components/WalletConnector";
import { accessToken } from "@/lib/supabase/server";
import { Wallet } from "lucide-react";

export const metadata = { title: "My Wallet" };

export default async function WalletPage() {
  // Require sign-in — the WalletConnector calls the API which requires a Bearer token
  const token = await accessToken();
  if (!token) redirect("/login?next=/wallet");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-[#A78BFA]" />
            My Crypto Wallet
          </span>
        }
        subtitle="Connect your EVM wallet to sync your real token holdings into the MochaGuard risk engine."
      />
      <div className="mt-6">
        <WalletConnector />
      </div>
    </div>
  );
}
