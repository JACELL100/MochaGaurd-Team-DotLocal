// Contract between the Next.js dashboard and the FastAPI service.
// Shapes mirror api/app/state.py (Decision.to_dict, evaluate summary, account_view)
// plus the copilot / anchor responses described in implementation_plan.md.

export type Phase = "pre" | "open" | "closing_ramp" | "closed";
export type Action = "hold" | "reduce" | "margin_call" | "close" | "freeze";

export interface Decision {
  id: number | null;
  ts: string;
  account_id: string | null;
  symbol: string | null;
  action: Action;
  max_leverage: number | null;
  adverse_move: number | null;
  equity: number | null;
  margin_required: number | null;
  qty_to_reduce: number | null;
  /** Terse machine string, kept for audit and logs. Prefer `plain` for anything a person reads. */
  reason: string;
  plain?: PlainReason;
}

export interface Concentration {
  symbol: string;
  notional: number;
  share: number;
}

export interface HealthBucket {
  bucket: string;
  count: number;
}

export interface BookSummary {
  ts: string;
  phase: Phase;
  ramp: number;
  accounts: number;
  positions: number;
  gross_exposure: number;
  net_equity: number;
  worst_case_loss: number;
  broker_loss_at_p99: number;
  accounts_at_risk: number;
  reduce: number;
  margin_call: number;
  close: number;
  frozen_symbols: string[];
  earnings_tonight: string[];
  top_concentration: Concentration[];
  avg_leverage_used: number;
  margin_health_hist: HealthBucket[];
  evaluate_ms: number;
}

export interface BookResponse {
  summary: BookSummary;
  ops_brief: string | null;
  plain?: PlainBook;
  decisions: Decision[];
}

export interface PositionRow {
  symbol: string;
  qty: number;
  price: number;
  notional: number;
  /**
   * Cost basis. Null when the broker did not supply one — P&L is then unavailable, not zero.
   *
   * These enrichment fields are optional because callers that construct a position by hand
   * (the stress-test simulator builds hypothetical books) legitimately have no cost basis or
   * carry to report. Components render "–" for a missing value rather than a misleading zero.
   */
  avg_price?: number | null;
  unrealised_pnl?: number | null;
  unrealised_pct?: number | null;
  /** Move vs the last official daily close. */
  day_change?: number | null;
  /** Equity this leg alone ties up at its own allowed leverage. */
  margin_required?: number | null;
  /** What this leg loses if it gaps to its 99th-percentile adverse move. */
  worst_case_loss?: number;
  max_leverage: number;
  adverse_move: number;
  earnings_tonight: boolean;
  frozen: boolean;
  funding?: FundingRow;
  risk?: PositionRisk;
}

export interface AccountView {
  account_id: string;
  tz: string;
  display_name: string | null;
  cash: number;
  equity: number;
  margin_required: number;
  worst_case_loss: number;
  gross_exposure: number;
  margin_ratio: number | null;
  leverage_used: number | null;
  positions: PositionRow[];
}

export interface AccountSummary {
  id: string;
  display_name: string | null;
  tz: string;
  equity: number;
  status: TonightStatus;
}

export type TonightStatus = "safe" | "action_needed" | "auto_derisk";

export interface Explanation {
  decision_id: number | null;
  symbol: string | null;
  action: Action;
  headline: string;
  body: string;
  action_hint: string | null;
  qty_to_reduce: number | null;
  max_leverage: number | null;
  model: string;
}

export interface TonightBriefing {
  account: AccountView;
  status: TonightStatus;
  as_of: string;
  deadline_et: string;
  deadline_local: string;
  local_time: string;
  headline: string;
  summary: string;
  cards: Explanation[];
  decisions: Decision[];
  model: string;
  funding?: FundingRow[];
  funding_book?: FundingBook;
  closure?: ClosureWindow;
  risk?: PositionRisk[];
}

export interface ReplayPoint {
  ts: string;
  price: number;
  max_leverage: number;
  phase: Phase;
  ramp: number;
  frozen: boolean;
}

export type ReplayEventKind =
  | "freeze"
  | "ramp_start"
  | "reduce"
  | "margin_call"
  | "close"
  | "liquidation"
  | "earnings"
  | "gap"
  | "anchor";

export interface ReplayEvent {
  ts: string;
  kind: ReplayEventKind;
  symbol: string | null;
  account_id: string | null;
  decision_id: number | null;
  qty: number | null;
  fill_price: number | null;
  slippage_bps: number | null;
  note: string;
}

export interface ReplaySummary {
  date: string;
  bars: number;
  open_price: number;
  close_price: number;
  price_change: number;
  min_allowed_leverage: number;
  close_allowed_leverage: number;
}

export interface ReplayResult {
  date: string;
  symbol: string;
  symbols: string[];
  points: ReplayPoint[];
  events: ReplayEvent[];
  summary: ReplaySummary;
}

export interface SymbolRisk {
  symbol: string;
  gap_p99: number;
  intraday_p99: number;
  earnings_gap_p99: number;
  adv_dollar: number;
}

export interface LeverageResult {
  symbol: string;
  max_leverage: number;
  adverse_move: number;
  slippage: number;
  concentration_haircut: number;
  phase: Phase;
  ramp: number;
  earnings_tonight: boolean;
  reason: string;
  frozen: boolean;
  sector_mult?: number;
  sector_note?: string;
  /** How this symbol's sector traded in the markets open while the US was shut. */
  sector?: SectorSignal | null;
  explanation: LeverageExplanation | null;
  risk: SymbolRisk | null;
}

export interface SectorPeer {
  ticker: string;
  label: string;
  region: string;
  move: number;
  weight: number;
  session: string;
  /** True once that market's own session had finished at the decision time. */
  counted: boolean;
}

export interface SectorSignal {
  sector: string | null;
  multiplier: number;
  note: string;
  peers: SectorPeer[];
}

/** Why the engine returned this limit. Computed alongside the decision, never generated. */
export interface LeverageExplanation {
  headline: string;
  driver: "frozen" | "earnings" | "size" | "overnight_gap" | "closing" | "volatility" | "none";
  factors: Array<{
    label: string;
    value: string;
    detail: string;
    impact: "raises" | "lowers" | "blocks";
  }>;
  formula: {
    expression: string;
    safety: number;
    adverse_move: number;
    slippage: number;
    concentration_haircut: number;
    denominator: number;
    uncapped: number | null;
    headline_cap: number;
    result: number;
    note: string;
  };
  /** Waterfall from the advertised cap down to the limit granted. Steps always reconcile. */
  attribution: LeverageAttribution;
  safety_budget: {
    label: string;
    notional: number;
    loss_at_p99: number;
    equity_required: number | null;
  };
  deadline: { derisk_et: string; close_et: string; next_close: string };
  model: string;
}

export interface VerifyResult {
  decision_id: number;
  found: boolean;
  valid: boolean;
  anchored: boolean;
  leaf_hash: string | null;
  merkle_root: string | null;
  merkle_path: string[];
  tx_hash: string | null;
  contract_address: string | null;
  etherscan_url: string | null;
  batch_date: string | null;
  anchored_at: string | null;
  decision: Decision | null;
  error: string | null;
  plain?: PlainReason;
  plain_proof?: PlainProof;
}

export interface ApiResult<T> {
  data: T | null;
  live: boolean;
  error: string | null;
}


/** One replayed session: the rubric scores plus the timeline that produced them. */
export interface SessionReplay {
  run_id: string;
  session_date: string;
  next_session: string;
  steps: number;
  decisions: number;
  fills: number;
  auto_derisk_fills: number;
  unwind_fills: number;
  symbols_missing_next_open: string[];
  scores: {
    broker_loss: number;
    accounts_negative: number;
    capital_efficiency: number;
    positions_reduced: number;
    reduced_that_would_have_recovered: number;
    notional_sold: number;
    notional_sold_unnecessarily: number;
    share_of_book_sold: number | null;
    user_trust: number;
    equity_start: number;
    equity_end: number;
    gaps: Record<string, number>;
  };
  timeline: Array<{
    ts: string;
    phase: Phase;
    ramp: number;
    accounts_at_risk: number;
    reduce: number;
    margin_call: number;
    close: number;
    gross_exposure: number;
    net_equity: number;
    avg_leverage_used: number;
    worst_case_loss: number;
  }>;
  plain?: PlainScores;
  events: Array<{ ts: string; kind: string; note: string; slippage_bps: number | null }>;
  fill_sample: Array<{
    ts: string;
    account_id: string;
    symbol: string;
    action: string;
    qty: number;
    ref_price: number;
    fill_price: number;
    slippage_bps: number;
    minutes?: number;
    kind: string;
  }>;
}


export interface AttributionStep {
  label: string;
  /** Leverage removed by this factor alone, with every earlier factor already applied. */
  lost: number;
  /** Leverage still available after this factor. */
  remaining: number;
  kind: "volatility" | "phase" | "earnings" | "sector" | "slippage" | "concentration" | "freeze";
  detail: string;
}

export interface LeverageAttribution {
  cap: number;
  granted: number;
  /** granted / cap — the share of the advertised maximum this request earns. */
  utilisation: number;
  steps: AttributionStep[];
}

/** Plain-language reason attached to a decision. Computed, never generated. */
export interface PlainReason {
  headline: string;
  why: string;
  next: string;
  severity: "ok" | "info" | "warning" | "critical";
}

/** Plain-language read on the whole book. */
export interface PlainBook {
  headline: string;
  why: string;
  exposure: string;
  drivers: string[];
  severity: "ok" | "info" | "warning" | "critical";
}

/** What a replay's three scores mean in ordinary language. */
export interface PlainScores {
  headline: string;
  broker_loss: string;
  capital_efficiency: string;
  user_trust: string;
  severity: "ok" | "info" | "warning" | "critical";
}

/** What an on-chain verification result means without the cryptography vocabulary. */
export interface PlainProof {
  headline: string;
  why: string;
  severity: "ok" | "info" | "warning" | "critical";
}


/** One bar on the desk chart: a real print plus the limit the engine allowed at that moment. */
export interface DeskPoint {
  ts: string;
  price: number;
  max_leverage: number;
  phase: Phase;
  frozen: boolean;
}

export interface DeskSeries {
  symbol: string;
  points: DeskPoint[];
  qty: number;
  notional: number;
  price: number;
  avg_price: number | null;
  unrealised_pnl: number | null;
  unrealised_pct: number | null;
  max_leverage: number;
  adverse_move: number;
  earnings_tonight: boolean;
  frozen: boolean;
  window_change: number;
  window_low: number;
  window_high: number;
  leverage_low: number;
  leverage_high: number;
}

export interface DeskResponse {
  account_id: string;
  as_of: string;
  phase: Phase;
  headline_cap: number;
  hours: number;
  series: DeskSeries[];
}


/** Perp carry for one position: what it costs to hold, and when carry alone becomes fatal. */
export interface FundingRow {
  symbol: string;
  side: "long" | "short";
  hourly_rate: number;
  hourly_cost: number;
  daily_cost: number;
  cost_to_next_open: number;
  hours_to_next_open: number;
  /** Null when carry is neutral or being earned — there is no deadline to warn about. */
  hours_to_liquidation: number | null;
  liquidation_at: string | null;
  /** "in 10 hours" / "in 2.1 days" / "not at this rate". */
  when: string;
  daily_share_of_buffer: number | null;
  /** True when the trader pays funding, false when they receive it. */
  pays: boolean;
  plain: PlainProof;
}

export interface FundingBook {
  daily_paid: number;
  daily_earned: number;
  daily_net: number;
  positions_paying: number;
  positions_earning: number;
  soonest_symbol: string | null;
  soonest_hours: number | null;
}

/** How long the US market stays shut from now — 17.5 hours overnight, ~65 over a weekend. */
export interface ClosureWindow {
  hours: number;
  label: string;
  multiplier: number;
}


/** One thing making a position risky, with its share of that position's risk. */
export interface RiskFactor {
  kind: string;
  label: string;
  /** Share of this position's risk, 0-1. Factors on a position sum to 1. */
  weight: number;
  band: "high" | "medium" | "low";
  value: string;
  detail: string;
  /** What the trader can actually do about it. */
  what_helps: string;
}

export interface PositionRisk {
  symbol: string;
  level: "severe" | "high" | "moderate" | "low" | "unknown";
  worst_case_loss: number;
  share_of_equity: number | null;
  max_leverage: number;
  biggest_driver: string | null;
  headline: string;
  summary: string;
  factors: RiskFactor[];
}

export interface AnchorBatch {
  id: number;
  batch_date: string;
  run_id: string;
  merkle_root: string;
  decision_count: number;
  tx_hash: string | null;
  contract_address: string | null;
  anchored_at: string | null;
  error: string | null;
  created_at: string;
  etherscan_url?: string | null;
}

export interface AnchorStatus {
  batches: AnchorBatch[];
  chain_configured: boolean;
  contract_address: string | null;
  contract_url: string | null;
}
