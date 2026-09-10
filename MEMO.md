# MochaGuard — Risk Memo

**We do not predict prices. We price the risk of being unable to sell for 17.5 hours.**

Leverage is not a setting. It is the answer to one question, asked continuously: *how far can
this price move before we can act, and can the customer's equity absorb that move?*

---

## The one rule

```
max_leverage = concentration_haircut × SAFETY / (adverse_move + slippage)
```

Four inputs, each doing one job:

| Term | Meaning | Why it is there |
|---|---|---|
| `SAFETY` = **0.30** | Share of equity a 99th-percentile move may cost | The broker eats any shortfall below zero, so we size for the customer to survive the move, not to be wiped out by it |
| `adverse_move` | p99 move over the window we *cannot act in* | This is the entire thesis. It is small when the market is open and large when it is shut |
| `slippage` | `10bps + 0.10 × √participation` | Getting out moves the price against us. Without this the engine believes exits are free |
| `concentration_haircut` | Cuts above 1% of reachable volume | Past a point the quoted price is not a price we can actually trade |

`SAFETY = 0.30` is the single most consequential number here. It was **0.8** — meaning
"tolerate erasing 80% of a customer's equity before acting" — which is not a risk limit, it is
a bankruptcy schedule. At 0.30 the deck's target curve falls out of the formula rather than
being tuned toward it.

## What the engine actually answers

Real Alpha Vantage / Yahoo history, $50k ticket, measured — not illustrative:

| Symbol | Open | 15:45 ramp | Overnight | Earnings night | gap p99 |
|---|---|---|---|---|---|
| SPY | 20.0x | 15.2x | 12.0x | 5.0x | 2.4% |
| AAPL | 20.0x | 9.0x | 7.1x | 3.4x | 4.1% |
| MSFT | 20.0x | 8.7x | 6.9x | 2.4x | 4.2% |
| NVDA | 20.0x | 5.8x | 4.5x | **1.1x** | 6.4% |
| TSLA | 20.0x | 4.7x | 3.7x | 2.0x | 8.0% |

Market open, everything gets the headline 20x — we can exit in minutes, so only the
exit-window move is at risk. Overnight, the same customer in the same stock gets 4.5x, because
the position is frozen in place. On an earnings night NVDA gets 1.1x. A halted or
split-affected symbol gets **0x**: no new exposure, and no liquidation either.

**Why the intraday number is small.** Intraday risk is the p99 move over the ~5 minutes it
takes to get out, measured from real 5-minute bars — not a full session's high-to-low range.
Comparing a session range against a single overnight gap is a units error, and it silently
flattened the entire leverage curve until it was fixed: open, ramp and overnight all returned
the same limit, which made the product's core claim untrue in code while looking correct.

## No cliff at 3:59:59

Cutting 20x to 3x in the last second force-sells the whole book into the closing print. Instead
the limit walks down continuously from 15:30 on a front-loaded curve (75% of overnight risk is
priced by 15:45), reaching the full overnight limit exactly at 16:00. Measured over a real
session, de-risking spreads across the half hour:

```
15:30  ramp 0.00    0 accounts acting
15:35  ramp 0.31    5
15:40  ramp 0.56   37
15:45  ramp 0.75   55
15:50  ramp 0.89   74
15:55  ramp 0.97   76
16:00  ramp 1.00   66
```

Customers get a window to reduce themselves, and we still have a liquid market to sell into.

## The customer is asleep

A margin call at 2:30 AM India time reaches nobody. The engine therefore **never waits for a
reply**: it assumes zero human response and de-risks automatically, sized so that a p99 gap
cannot take the account below zero. Notifications explain what already happened; they are not
a control.

## The morning after

The gap has happened; the only decisions left are order and speed. Accounts are queued
**worst margin ratio first**, healthy accounts are not touched at all, and our own selling is
capped at 10% of expected minute volume — with slippage a function of that participation and
of how many minutes we are in the market. That cap is what breaks the doom loop: dumping the
book into the first minute pushes the price down, which pushes more accounts underwater, which
forces more selling.

## The five traps

| Trap | How it is handled |
|---|---|
| **Stock splits** (hard gate) | All statistics come from split-adjusted prices. A split date freezes the symbol: 0x new exposure, **never liquidated**. A 4-for-1 looks exactly like a −75% crash and selling into it would be our error |
| **Earnings** | Real reported dates with AMC/BMO timing. Sized against the symbol's own earnings-night gap history, and the date is known in advance so the limit drops early |
| **Trading halts** | A halt is a *stopped* tape, not a calm one. Inferred from consecutive unchanged zero-volume prints in regular hours, then frozen. A flat tape must never read as "safe" |
| **Crowding** | Measured book-wide, not per account. The seeded book runs 61% of gross exposure in two names — those are one position, not two |
| **Thin pre-market** | Participation is measured against the volume *reachable in that phase* (~2% of ADV pre-market), not daily ADV. The same $5M exit costs 60bps at midday and 364bps at 4 AM; an $80M pre-market order collapses to 1x |

## Replayed result

One session stepped end to end on recorded bars, held through the gap, unwound at the open —
401 accounts, 1,209 positions, $105M gross:

| | |
|---|---|
| **Broker loss** | **$0** |
| Accounts negative | 0 |
| **Capital efficiency** (avg allowed leverage) | **18.0x** |
| Book sold to de-risk | 14.0% ($14.7M) |
| Of which unnecessary | $5.4M |
| **User trust** | **0.63** |
| De-risk slippage | 10–15 bps |

Zero broker loss at 18x average leverage is the combination the product needs. The honest weak
number is **user trust at 0.63**: we sold $5.4M that, with hindsight, recovered by the next
open. That is the real cost of assuming nobody answers a 2 AM margin call, and it is the number
we would attack next — most of it is NVDA and TSLA trimmed into an intraday dip during the
ramp. Trust is weighted by notional, so a 1% trim that recovers is scored as a 1% trim, not as
a lost customer.

## Engineering guarantees

- **No look-ahead, structurally.** Wall-clock access is banned in engine code; every entry
  point takes an explicit `ts` and prices are only ever read through a cutoff. A test replays
  the same session against a calm next open and a −40% next open and asserts every in-session
  decision is byte-identical.
- **Speed.** Whole-book evaluation is vectorized numpy with zero database calls in the hot
  path: **~2.5ms** for 401 accounts, **~9ms** for 2,000 — against a 100ms budget.
- **Explainability.** Every leverage answer ships the factors that moved it and the literal
  arithmetic, computed alongside the decision with no model call. It is always present and can
  never contradict the number it explains. The LLM narrates margin decisions only, and is
  constrained to numbers that appear in a fact pack.
- **Auditability.** Each day's decisions are Merkle-committed and the root is anchored to
  Sepolia; any single decision can be verified against the on-chain root.
- **No invented data.** If market data, the API, or auth is unavailable, the UI says so. There
  are no sample portfolios, no placeholder proofs, and no second copy of the risk formula in
  the browser.

## What we would do next

1. **Attack the 0.63 trust score.** Distinguish a *volatility* dip from a *deterioration* in
   the name, and prefer collateral calls over trims for accounts with a history of responding.
2. **Correlation, not just concentration.** NVDA and TSLA at 30% each is not two positions; a
   factor model would price them as one.
3. **A real halt feed.** Inference from the tape is sound but retrospective; LULD messages are
   live.
4. **Widen the universe.** The engine is universe-agnostic; five symbols is an API-quota limit,
   not a design one.
