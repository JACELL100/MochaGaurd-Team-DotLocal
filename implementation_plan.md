# MochaGuard — Implementation Plan
### Sleep-Safe Leverage: a risk engine Mochatrade can actually ship

**One-liner:** The hackathon risk engine, productized — every leverage/margin/liquidation decision is (a) explained to the user in plain language by an AI copilot before they go to sleep, and (b) Merkle-anchored to a Sepolia smart contract so any user can cryptographically verify they were treated fairly.

**Pitch line for judges:** *"Everyone here built the engine that decides. We built the layer that makes a user in Jaipur trust that decision at 2 AM — and lets them prove it was fair. Trust is Mochatrade's actual growth bottleneck, not math."*

---

## 0. Why this scope

The rubric: Broker Loss 50% · Capital Efficiency 30% · User Trust 20% · memo tiebreaker. The engine covers the first two. **User Trust — "positions we closed that would have recovered" — is a product problem, not a math problem.** Real brokers lose customers over liquidations they can't explain or prove were fair. Mochatrade is pre-launch and globally distributed; a verifiable audit trail + human-readable explanations is something they could literally put on their landing page the week after the hackathon.

```
┌─────────────────────────────────────────────────────────────┐
│ Next.js (Vercel)                                            │
│  /            Book risk console (ops view)                  │
│  /tonight     "Tonight" card — AI sleep-safe briefing       │
│  /replay      Timeline scrubber                             │
│  /simulate    Leverage calculator                           │
│  /verify      Paste a decision ID → on-chain proof          │
└──────────────┬──────────────────────────────────────────────┘
               │ fetch (server components / route handlers)
               ▼
┌─────────────────────────────────────────────────────────────┐
│ FastAPI                                                     │
│  engine/     leverage · margin · liquidate · guards         │
│  copilot/    decision → plain-language explanation (LLM)    │
│  anchor/     decision log → Merkle tree → Sepolia (web3.py) │
│  routes/     /leverage /evaluate /replay /tonight /verify   │
└──────┬───────────────────────┬──────────────────────────────┘
       │ asyncpg               │ web3.py (async, background)
       ▼                       ▼
┌──────────────┐      ┌─────────────────────┐
│ Supabase     │      │ Sepolia testnet     │
│ Postgres     │      │ MochaAnchor.sol     │
│ (auth + DB)  │      │ anchor(root, day)   │
└──────────────┘      └─────────────────────┘
```

**Hard rule (unchanged from the base plan):** the engine is judged on speed and correctness. The copilot and the blockchain anchor are **strictly downstream, asynchronous, and can never block or alter a decision.** If the LLM times out or Sepolia is congested, the engine's answer is identical. Say this to the judges — it shows you understand separation of concerns.

---

## 1. Component A — Risk Engine (the assignment, done right)

Keep the architecture from the existing `implementation.md` verbatim. It is correct. Summary of what must exist:

### 1.1 Supabase schema
Run the full SQL from `implementation.md` §2 unchanged: `symbols`, `bars_daily`, `bars_intraday`, `earnings`, `corporate_actions`, `halts`, `symbol_risk` (precomputed), `accounts`, `positions`, `risk_decisions`, `liquidations`, `book_snapshots`.

**Add two tables for the product layer:**

```sql
-- AI copilot output: one row per user-facing explanation
create table decision_explanations (
  id bigserial primary key,
  decision_id bigint references risk_decisions,
  account_id uuid,
  ts timestamptz,
  audience text,               -- 'user' | 'ops'
  headline text,               -- "Your NVDA leverage drops to 4x tonight"
  body text,                   -- 2-3 sentence plain-language explanation
  action_hint text,            -- "Sell 120 shares before 4 PM to keep 20x"
  model text,                  -- llm model id, for audit
  created_at timestamptz default now()
);

-- On-chain anchoring
create table anchor_batches (
  id bigserial primary key,
  batch_date date,
  merkle_root text,            -- 0x-prefixed bytes32 hex
  decision_count int,
  first_decision_id bigint,
  last_decision_id bigint,
  tx_hash text,                -- sepolia tx, null until confirmed
  contract_address text,
  anchored_at timestamptz,
  unique (batch_date)
);

-- per-decision proof material (leaf hash + sibling path)
create table decision_proofs (
  decision_id bigint primary key references risk_decisions,
  batch_id bigint references anchor_batches,
  leaf_hash text,
  merkle_path jsonb            -- ["0xabc...", "0xdef...", ...]
);
```

RLS: ON everywhere; FastAPI uses the service-role key; Next.js never touches the DB directly. Google auth via Supabase Auth is only for the dashboard login — keep it out of the engine path entirely.

### 1.2 Engine modules (build exactly as the base plan specifies)

| Module | Contents | Non-negotiables |
|---|---|---|
| `engine/guards.py` | split/halt/stale-price/implausible-move freeze | Liquidating on a split = day disqualified. Write this **first**, with tests. |
| `engine/leverage.py` | `max_leverage = SAFETY / (adverse_move + slippage)`, session-phase aware, closing ramp 15:30→16:00, concentration haircut, 20x headline cap | Use `adj_close`-derived prices for ALL returns. No look-ahead: stats as-of date only. |
| `engine/margin.py` | overnight survival check at 15:45 ET: hold / reduce / margin_call / close | Assume zero user response (sleeping user). Auto de-risk. |
| `engine/liquidate.py` | open-bell unwind: worst margin-ratio first, participation capped at ~10% of expected minute volume, slippage = f(own participation) | No free liquidations. Model your own market impact. |
| `engine/calendar.py` | session phases, earnings lookup, halts, holidays | Single source of truth for "what time is it in market terms". |
| `state.py` | in-memory book + `symbol_risk` as numpy arrays, loaded at startup | `/evaluate` = vectorized whole-book math, **<100 ms for 2,000 accounts**, zero DB calls in the loop. Decision logging is fire-and-forget. |
| replay harness | simulated clock threaded through everything | Ban `datetime.now()` in engine code; enforce no-look-ahead at the data layer (`state.prices_at(ts)` filters `ts <= given_ts`). |

### 1.3 Engine tests (from base plan — all must pass)
split-freeze, mega-cap gets 20x intraday, earnings-night tightening ≥3x, crowding reduces leverage, evaluate <100 ms, grep test proving no `datetime.now()` in engine source.

---

## 2. Component B — AI Risk Copilot ("Tonight" briefing)

This is the differentiator that maps directly to the User Trust 20%.

### 2.1 What it does
For every decision the engine emits (`reduce`, `close`, `margin_call`, leverage cap change), generate a short, accurate, plain-language explanation **in the user's timezone and context**:

> **"Your NVDA position is capped at 4x tonight."**
> NVDA reports earnings after the close. On earnings nights it has moved ±18% historically, and at 20x a 5% move wipes out your account. Sell 120 shares before 4:00 PM ET (1:30 AM your time) to keep your position, or we'll reduce it for you at 3:45 PM.

The engine already produces a structured `reason` string (`phase=closed adverse=0.183 conc=0.22`) — the copilot turns structured facts into language. **The LLM never decides anything; it only narrates decided facts.** This kills hallucination risk by construction.

### 2.2 Implementation — `copilot/`

```python
# copilot/explain.py
TEMPLATE_FACTS = {
    "symbol", "action", "max_leverage", "adverse_move",
    "earnings_tonight", "user_tz_local_time", "qty_to_reduce",
    "deadline_local", "gap_stat_used", "concentration",
}

async def explain(decision: Decision, account: Account) -> Explanation:
    facts = build_fact_pack(decision, account)   # pure python, no LLM
    prompt = render("copilot/prompts/user_explain.j2", facts=facts)
    try:
        text = await llm.complete(prompt, timeout=3.0, max_tokens=180)
    except Exception:
        text = fallback_template(facts)          # deterministic template
    return Explanation(decision_id=decision.id, **parse(text))
```

- **Fallback template is mandatory** — if the LLM is down, a Jinja2 template renders the same facts. Demo never breaks.
- Validate the LLM output: it may only reference numbers present in the fact pack (regex-check that every number in the output appears in the facts). On violation → fallback template. This is a 15-line guard that you should *show* judges.
- Batch generation: after each `/evaluate`, enqueue explanations only for accounts whose decision **changed** (reduce/close/call). Hold decisions get nothing — no noise.
- One "Tonight" digest per account per day at 15:30 ET: aggregate all that account's pending reductions into one briefing (this is the dashboard's `/tonight` page and the demo's emotional hook).

### 2.3 Ops audience
Same pipeline, `audience='ops'`: a daily one-paragraph book summary for Mochatrade's team ("Tonight 41 accounts hold earnings names; worst-case broker loss $86k, concentrated in NVDA/TSLA; 3 halts expected"). This is the thing a real risk desk reads at 3 PM. Free to generate, very impressive on screen.

---

## 3. Component C — Provably Fair Audit Trail (Sepolia)

### 3.1 The idea
A pre-launch broker's scariest sentence is "trust us, the liquidation was fair." Instead: every day's full decision log is Merkle-tree'd; the root is written to a tiny Sepolia contract; any user can later fetch a Merkle proof for *their* decision and verify it against the on-chain root — Mochatrade cannot retroactively alter a decision without breaking the root.

This is honest blockchain use: not a token, not DeFi theater — **tamper-evidence for a trust-sensitive product.** It also maps to their "fully compliant" marketing claim.

### 3.2 Smart contract — `contracts/MochaAnchor.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MochaAnchor {
    mapping(bytes32 => bool) public roots;          // merkleRoot => exists
    event Anchored(bytes32 indexed root, uint256 indexed day, uint256 count);
    address public immutable owner;

    constructor() { owner = msg.sender; }

    function anchor(bytes32 root, uint256 day, uint256 count) external {
        require(msg.sender == owner, "only owner");
        require(!roots[root], "already anchored");
        roots[root] = true;
        emit Anchored(root, day, count);
    }

    function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof)
        external view returns (bool)
    {
        if (!roots[root]) return false;
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            h = h < proof[i]
                ? keccak256(abi.encodePacked(h, proof[i]))
                : keccak256(abi.encodePacked(proof[i], h));
        }
        return h == root;
    }
}
```

~40 lines. Deploy once from a script with web3.py. **Verification is a `view` call — free, no gas, works from the demo laptop.**

### 3.3 Anchoring pipeline — `anchor/`

```python
# anchor/merkle.py
def leaf_hash(decision) -> bytes:
    payload = f"{decision.id}|{decision.ts}|{decision.account_id}|" \
              f"{decision.symbol}|{decision.action}|{decision.max_leverage}|" \
              f"{decision.equity}|{decision.margin_required}"
    return keccak(payload.encode())

def build_tree(leaves: list[bytes]) -> tuple[bytes, list[list[bytes]]]:
    """returns (root, per-leaf proof paths); standard sorted-pair Merkle tree"""

# anchor/publisher.py  — runs as a background task, NEVER in request path
async def anchor_day(batch_date):
    decisions = await db.decisions_for(batch_date)
    leaves = [leaf_hash(d) for d in decisions]
    root, proofs = build_tree(leaves)
    batch_id = await db.store_batch(batch_date, root, decisions, proofs)
    tx = await w3_contract.functions.anchor(root, day_int, len(leaves)) \
             .build_transaction({...})
    signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    tx_hash = await w3.eth.send_raw_transaction(signed.rawTransaction)
    await db.mark_anchored(batch_id, tx_hash.hex())
```

- Trigger: automatically at simulated end-of-day in the replay, and via `POST /anchor/{date}` for the live demo.
- Sepolia ETH: get from a faucet before the hackathon (do this at hour 0, faucets are flaky).
- Cost: one tx per day, ~60k gas — effectively free on testnet.
- **Verify endpoint:** `GET /verify/{decision_id}` → loads leaf + path from `decision_proofs`, calls `contract.verify(...)` on-chain, returns `{valid: true, tx_hash, etherscan_url}`. The dashboard's `/verify` page links to Sepolia Etherscan so judges can click and see the anchor tx themselves.

### 3.4 Why judges buy it
- It answers "why blockchain?" with a real answer (tamper-evidence for user trust), not a buzzword.
- It's verifiable live in 10 seconds.
- It's honest about limits: the chain stores a *commitment*, not data — privacy-preserving by design (no user PII on-chain, only hashes).

---

## 4. API surface (FastAPI)

| Endpoint | Purpose | Component |
|---|---|---|
| `POST /leverage` | max leverage for (symbol, notional, ts) | Engine |
| `POST /evaluate` | whole-book decisions at ts, <100 ms | Engine |
| `POST /replay` | run simulated session, return summary | Engine |
| `GET /tonight/{account_id}` | tonight's sleep-safe briefing + explanations | Copilot |
| `GET /ops/daily-brief` | ops-paragraph for the book | Copilot |
| `POST /anchor/{date}` | Merkle-anchor a day's decisions | Chain |
| `GET /verify/{decision_id}` | on-chain proof check | Chain |
| `GET /dashboard/book` | aggregates for the console | Engine |

---

## 5. Next.js dashboard (App Router)

Build in this order; stop when time runs out.

1. **`/tonight` — build this FIRST, not last.** It's the product. User picks an account → sees the sleep-safe briefing: local-time deadline, per-position action cards (AI explanation + "sell X shares" hint), and a big "You are safe tonight ✅ / Action needed ⚠️" banner. This is what makes judges feel the 2 AM problem.
2. **`/` book console** — gross exposure, worst-case loss if everything gaps to p99, top-5 concentration bars, margin-health histogram, ops daily brief paragraph at the top.
3. **`/replay`** — timeline slider: price line, allowed-leverage line ramping down into the close, freeze/liquidation markers. Proof the engine understands time.
4. **`/verify`** — paste decision ID → green check + Etherscan link. After the replay demo, click a real liquidation from the timeline and verify it live. **This is the closer.**
5. `/simulate` — leverage calculator with human-readable reason.

Stack notes: `recharts` for charts; server components / route handlers call FastAPI via `FASTAPI_URL` (no browser→FastAPI CORS pain); Supabase Google auth guards the dashboard (one `middleware.ts`, don't overthink); Supabase Realtime on `book_snapshots` for live replay updates if time allows.

---

## 6. Build order (36 hours)

| Hours | Work | Done when |
|---|---|---|
| 0–1 | Repo scaffold (3 folders: `web/`, `api/`, `contracts/`), Supabase project, **Sepolia faucet request**, contract deployed to Sepolia | Contract address in `.env` |
| 1–4 | Schema + seed daily bars/earnings/actions (`COPY`, not inserts) | `select count(*)` sane |
| 4–7 | `precompute.py` → `symbol_risk`. Eyeball: SPY gap_p99 ≈ 2%, biotech ≥ 15% | No mega-cap 40% p99 (adj-price bug) |
| 7–10 | `guards.py` + split/halt/stale tests | Split test freezes |
| 10–15 | `/leverage` with session phases + closing ramp | Earnings-night test passes |
| 15–20 | `/evaluate` vectorized + margin decisions | <100 ms test passes |
| 20–24 | Replay harness end-to-end on one ugly day; first broker-loss number | Replay summary exists |
| 24–28 | Copilot: fact packs, prompt, validation guard, fallback template, Tonight digest | `/tonight` returns real text |
| 28–31 | Anchor pipeline: merkle.py, publisher, `/verify` | A decision verifies on-chain |
| 31–34 | Dashboard: /tonight, /, /replay, /verify | Demo flows end-to-end |
| 34–35 | Tune `SAFETY` against replay score; write the one-page memo | Numbers + memo done |
| 35–36 | Freeze code. Rehearse demo twice. Charge laptops. | — |

**Do not** start with the frontend. Do not let the LLM or web3 code touch the engine's request path.

---

## 7. Demo script (3 minutes)

1. **The problem, felt:** open `/tonight` for an account in `Asia/Kolkata`. "It's 10 PM in Jaipur. This user is about to sleep. Here's what our engine — and our copilot — just told them." Read the briefing aloud.
2. **The engine:** scrub `/replay` through an earnings gap day. Leverage ramps down from 15:30, freezes on a halt, and — show the split date — *does nothing* on the 4-for-1 split. "A naive engine liquidates here and is disqualified."
3. **The score:** replay summary — broker loss, average leverage, false liquidations.
4. **The closer:** click one liquidation from the timeline → `/verify` → green check → Etherscan tab. "This user can prove, without trusting us, that this decision was made by the published rules and never altered. That's how a pre-launch broker earns global trust."

---

## 8. Where teams lose (base plan + new)

- Unadjusted prices → every stat poisoned. Fix first.
- `datetime.now()` in the engine → silent look-ahead. Banned; grep-tested.
- DB calls in the account loop → 100 ms requirement dead.
- Free liquidations (no slippage model) → judges don't believe your zero loss.
- Safe-and-useless: avg leverage 3x = product nobody buys. Tune `SAFETY` up until broker loss appears, back off one notch.
- **New:** letting the LLM influence decisions (hallucination in a risk engine = instant credibility loss). Narration only.
- **New:** putting user data on-chain. Hashes only.
- **New:** no LLM fallback. The demo gods are cruel; templates save you.
- No memo. 20 minutes, it's the tiebreaker.

---

## 9. Environment

```bash
# api/.env
DATABASE_URL=postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_SERVICE_ROLE_KEY=...
LLM_API_KEY=...                  # whatever provider your team has
SEPOLIA_RPC_URL=https://rpc.sepolia.org        # or Alchemy/Infura
ANCHOR_PRIVATE_KEY=0x...         # faucet-funded throwaway key, testnet only
CONTRACT_ADDRESS=0x...           # from hour-0 deploy

# web/.env.local
FASTAPI_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Use the Supabase **pooler** string (port 6543). The anchor key is a dedicated testnet key with ~0.1 Sepolia ETH — never a real wallet.

---

## 10. Repo layout

```
mochaguard/
  api/
    app/main.py  db.py  state.py
    app/engine/   leverage.py margin.py liquidate.py guards.py calendar.py
    app/copilot/  explain.py facts.py prompts/
    app/anchor/   merkle.py publisher.py
    app/routes/   risk.py replay.py tonight.py verify.py dashboard.py
    scripts/      seed.py precompute.py deploy_contract.py
    tests/        test_guards.py test_leverage.py test_speed.py test_merkle.py
  contracts/
    MochaAnchor.sol
  web/
    app/  page.tsx  tonight/  replay/  simulate/  verify/  accounts/[id]/
    lib/  api.ts  supabase.ts
```
