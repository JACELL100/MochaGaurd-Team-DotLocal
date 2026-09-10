import Link from "next/link";

import { Badge, Banner, Mono, PageHeader, SourceBadge, inputClass } from "@/components/ui";
import { getVerify } from "@/lib/api";
import { actionLabel, actionTone, etDateTime, lev, money, pct, shares, shortHash } from "@/lib/format";
import type { VerifyResult } from "@/lib/types";
import { GlowingCard } from "@/components/ui/GlowingCard";
import { ShieldCheck, Lock, CheckCircle2, ArrowRight, ExternalLink } from "lucide-react";

export const metadata = { title: "Verify" };


export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const raw = typeof id === "string" ? id.trim().replace(/^#/, "") : "";
  const decisionId = /^\d+$/.test(raw) ? Number(raw) : null;
  // A verification result is only ever the API's. Inventing a tx hash or Merkle root here
  // would render an unverified decision as cryptographically proven, which is the one thing
  // this page must never do.
  const res = decisionId !== null ? await getVerify(decisionId) : null;

  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <PageHeader
        title="Verify on Sepolia"
        subtitle="Each day's decision log is Merkle-tree'd and the root is written to Sepolia. Only hashes go on-chain, never user data."
        right={res && <SourceBadge live={res.live} error={res.error} />}
      />

      <GlowingCard className="mb-8">
        <form method="get" className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex-1 text-xs font-mono uppercase tracking-wider text-[#94A3B8]">
            Decision ID / Hash Key
            <input
              name="id"
              defaultValue={raw}
              placeholder="Decision ID from the risk log"
              inputMode="numeric"
              autoComplete="off"
              className={`${inputClass} mt-1.5 font-mono text-sm bg-[#05050A] border-[#231F42] focus:border-[#7C3AED]`}
            />
          </label>
          <button
            type="submit"
            className="px-6 py-2.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] shadow-[0_0_20px_rgba(124,58,237,0.4)] hover:brightness-110 transition-all flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            Verify On-Chain
          </button>
        </form>

        <p className="mt-4 text-xs text-[#64748B]">
          Decision IDs come from the risk log. Open any decision on the{" "}
          <Link href="/" className="text-[#C4B5FD] hover:underline">book console</Link> or a
          <Link href="/tonight" className="text-[#C4B5FD] hover:underline"> tonight briefing</Link>{" "}
          and use its Verify link — anchoring runs at 20:00 ET, so decisions from today may not be on-chain yet.
        </p>
      </GlowingCard>

      {res && (res.data ? <Result r={res.data} /> : <Banner tone="danger" icon="!" title="Live verification is unavailable" body={res.error ?? "The API did not return a verification result."} />)}
    </div>
  );
}

function Result({ r }: { r: VerifyResult }) {
  if (!r.found) {
    return <Banner tone="danger" icon="✕" title={`Decision #${r.decision_id} not found`} body={r.error ?? "The decision log has no entry with this ID."} />;
  }
  if (!r.anchored) {
    return (
      <Banner
        tone="warn"
        icon="◔"
        title={`Decision #${r.decision_id} is logged but not yet anchored`}
        body="The Merkle root for this day has not been written to Sepolia yet. Anchoring runs at end of day (20:00 ET), asynchronously, and never blocks a decision."
      />
    );
  }

  const d = r.decision;
  return (
    <div className="space-y-6 relative z-20">

      <Banner
        tone={r.valid ? "safe" : "danger"}
        icon={r.valid ? "✓" : "✕"}
        title={r.valid ? `Decision #${r.decision_id} Verified On-Chain` : `Decision #${r.decision_id} Failed Verification`}
        body={
          r.valid
            ? "The leaf hash and Merkle inclusion proof mathematically reconstruct a root present on Sepolia. This decision was committed as shown and is cryptographically immutable."
            : r.error ?? "The proof does not reproduce an anchored root."
        }
        aside={
          r.etherscan_url && (
            <a
              href={r.etherscan_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#121024] border border-[#7C3AED]/50 hover:bg-[#181530] flex items-center gap-1.5 shadow-[0_0_15px_rgba(124,58,237,0.3)] transition-all"
            >
              Sepolia Etherscan <ExternalLink className="w-3.5 h-3.5 text-[#A78BFA]" />
            </a>
          )
        }
      />

      {r.plain_proof && (
        <GlowingCard>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] mb-2">
            What this proof actually means
          </div>
          <p className="text-sm font-semibold text-white">{r.plain_proof.headline}</p>
          <p className="mt-2 text-xs leading-relaxed text-[#CBD5E1]">{r.plain_proof.why}</p>
        </GlowingCard>
      )}

      {r.plain && (
        <GlowingCard>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] mb-2">
            Why this decision was made
          </div>
          <p className="text-sm font-semibold text-white">{r.plain.headline}</p>
          <p className="mt-2 text-xs leading-relaxed text-[#CBD5E1]">{r.plain.why}</p>
          {r.plain.next && <p className="mt-2 text-xs leading-relaxed text-[#A78BFA]">{r.plain.next}</p>}
        </GlowingCard>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {d && (
          <GlowingCard>
            <h3 className="text-sm font-semibold text-white mb-1">What Was Decided (Hashed Leaf Facts)</h3>
            <p className="text-xs text-[#94A3B8] mb-4">The deterministic assertions committed to the Merkle tree.</p>

            <dl className="tabular grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-xs font-mono">
              <dt className="text-[#94A3B8]">Timestamp</dt>
              <dd className="text-white">{etDateTime(d.ts)}</dd>
              <dt className="text-[#94A3B8]">Account</dt>
              <dd className="text-[#C4B5FD]">{d.account_id ?? "book-level"}</dd>
              <dt className="text-[#94A3B8]">Symbol</dt>
              <dd className="font-bold text-white">{d.symbol ?? "–"}</dd>
              <dt className="text-[#94A3B8]">Action</dt>
              <dd>
                <Badge tone={actionTone(d.action)}>{actionLabel(d.action)}</Badge>
              </dd>
              <dt className="text-[#94A3B8]">Max Leverage</dt>
              <dd className="text-white">{lev(d.max_leverage)}</dd>
              <dt className="text-[#94A3B8]">Adverse Move</dt>
              <dd className="text-white">{pct(d.adverse_move)}</dd>
              <dt className="text-[#94A3B8]">Qty to Reduce</dt>
              <dd className="text-[#A78BFA]">{d.qty_to_reduce ? `${shares(d.qty_to_reduce)} sh` : "–"}</dd>
              <dt className="text-[#94A3B8]">Engine detail</dt>
              <dd className="font-sans text-xs text-[#CBD5E1]">
                <Mono>{d.reason}</Mono>
              </dd>
            </dl>
          </GlowingCard>
        )}

        <GlowingCard>
          <h3 className="text-sm font-semibold text-white mb-1">Cryptographic Proof Material</h3>
          <p className="text-xs text-[#94A3B8] mb-4">Batch {r.batch_date ?? "–"} · Anchored {r.anchored_at ? etDateTime(r.anchored_at) : "–"}</p>

          <dl className="grid gap-3 text-xs font-mono">
            <Row label="Leaf Hash" value={r.leaf_hash} />
            <Row label="Merkle Root" value={r.merkle_root} />
            <Row label="Anchor Tx" value={r.tx_hash} href={r.etherscan_url ?? undefined} />
            <Row
              label="Contract"
              value={r.contract_address}
              href={r.contract_address ? `https://sepolia.etherscan.io/address/${r.contract_address}` : undefined}
            />
          </dl>

          <details className="mt-4 pt-4 border-t border-[#1C1836]">
            <summary className="cursor-pointer text-xs text-[#A78BFA] hover:text-white font-mono">
              Merkle Inclusion Path ({r.merkle_path.length} sibling hashes)
            </summary>
            <ol className="mt-3 space-y-1.5 font-mono text-[11px]">
              {r.merkle_path.map((h, i) => (
                <li key={h} className="flex items-center gap-2 p-1.5 rounded bg-[#05050A] text-[#CBD5E1]">
                  <span className="w-5 text-[#64748B] text-center">{i}</span>
                  <span className="truncate">{h}</span>
                </li>
              ))}
            </ol>
          </details>
        </GlowingCard>
      </div>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-4">
      <dt className="text-[#94A3B8]">{label}</dt>
      <dd className="truncate text-right font-mono text-xs" title={value ?? undefined}>
        {href && value ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#C4B5FD] hover:underline">
            {shortHash(value, 12)} ↗
          </a>
        ) : (
          <span className="text-white">{shortHash(value, 12)}</span>
        )}
      </dd>
    </div>
  );
}
