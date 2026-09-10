// Server-only client for the FastAPI service. It never substitutes synthetic values: a failed
// request is surfaced to the user so a trading/risk view can never look live when it is not.

import "server-only";

import { accessToken } from "./supabase/server";
import type {
  AccountSummary,
  ApiResult,
  BookResponse,
  LeverageResult,
  OpsBrief,
  ReplayResult,
  SessionReplay,
  TonightBriefing,
  VerifyResult,
} from "./types";

const BASE = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.FASTAPI_TIMEOUT_MS ?? 4000);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  if (!token) throw new ApiError("Sign in with Mochatrade to access live risk data.", 401);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(text || `${res.status} ${res.statusText}`, res.status);
  }
  return (await res.json()) as T;
}

async function withAvailability<T>(live: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { data: await live(), live: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, live: false, error: message };
  }
}

export function getBook(): Promise<ApiResult<BookResponse>> {
  return withAvailability(() => call<BookResponse>("/dashboard/book"));
}

export function getAccounts(): Promise<ApiResult<AccountSummary[]>> {
  return withAvailability(() => call<AccountSummary[]>("/dashboard/accounts"));
}

export function getDailyOpsBrief(): Promise<ApiResult<OpsBrief>> {
  return withAvailability(() => call<OpsBrief>("/ops/daily-brief"));
}

export function getTonight(accountId: string): Promise<ApiResult<TonightBriefing | null>> {
  return withAvailability(
    async () => {
      try {
        return await call<TonightBriefing>(`/tonight/${encodeURIComponent(accountId)}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  );
}

export function getReplay(params: { symbol: string; date?: string }): Promise<ApiResult<ReplayResult>> {
  return withAvailability(() => call<ReplayResult>("/replay", { method: "POST", body: JSON.stringify(params) }));
}

export function getLeverage(params: {
  symbol: string;
  notional: number;
  ts: Date;
  earnings_tonight?: boolean;
}): Promise<ApiResult<LeverageResult | null>> {
  return withAvailability(
    async () => {
      try {
        return await call<LeverageResult>("/leverage", {
          method: "POST",
          body: JSON.stringify({ ...params, ts: params.ts.toISOString() }),
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  );
}

/** Job 3 end to end: replay a whole session over the book and score the outcome. */
export function runSessionReplay(params: { date?: string; step_minutes?: number } = {}): Promise<ApiResult<SessionReplay>> {
  return withAvailability(() =>
    call<SessionReplay>("/replay/session", { method: "POST", body: JSON.stringify(params) }),
  );
}

export function getVerify(decisionId: number): Promise<ApiResult<VerifyResult>> {
  return withAvailability(() => call<VerifyResult>(`/verify/${decisionId}`));
}

export function getMarket(kind: string, params: Record<string, string>): Promise<ApiResult<{ source: string; retrieved_at: string; data: unknown }>> {
  const query = new URLSearchParams(params).toString();
  return withAvailability(() => call(`/market/${encodeURIComponent(kind)}?${query}`));
}
