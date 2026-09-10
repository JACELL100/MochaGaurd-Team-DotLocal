import { Card, Empty, Mono, PageHeader, SourceBadge, buttonClass, inputClass } from "@/components/ui";
import { getMarket } from "@/lib/api";

export const metadata = { title: "Live markets" };

type MarketKind = "stocks" | "crypto" | "forex" | "commodity" | "etf" | "index" | "fundamentals" | "news" | "technical" | "economic";

const PRESETS: Record<MarketKind, { label: string; function: string; symbol?: string; market?: string; from_symbol?: string; to_symbol?: string; interval?: string; time_period?: string; series_type?: string; tickers?: string; limit?: string }> = {
  stocks: { label: "US stock quote", function: "GLOBAL_QUOTE", symbol: "NVDA" },
  crypto: { label: "Crypto daily", function: "DIGITAL_CURRENCY_DAILY", symbol: "BTC", market: "USD" },
  forex: { label: "FX exchange rate", function: "CURRENCY_EXCHANGE_RATE", from_symbol: "EUR", to_symbol: "USD" },
  commodity: { label: "WTI crude oil", function: "WTI" },
  etf: { label: "ETF profile", function: "ETF_PROFILE", symbol: "SPY" },
  index: { label: "Index quote", function: "GLOBAL_QUOTE", symbol: "SPY" },
  fundamentals: { label: "Company overview", function: "OVERVIEW", symbol: "NVDA" },
  news: { label: "Market news & sentiment", function: "NEWS_SENTIMENT", tickers: "NVDA,MSFT", limit: "10" },
  technical: { label: "Relative strength index", function: "RSI", symbol: "NVDA", interval: "daily", time_period: "14", series_type: "close" },
  economic: { label: "US consumer price index", function: "CPI", interval: "monthly" },
};

function kindValue(value: unknown): MarketKind {
  return typeof value === "string" && value in PRESETS ? value as MarketKind : "stocks";
}

export default async function MarketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const kind = kindValue(sp.kind);
  const preset = PRESETS[kind];
  const param = (name: string, fallback = "") => typeof sp[name] === "string" ? sp[name] : fallback;
  const query = {
    function: param("function", preset.function), symbol: param("symbol", preset.symbol ?? ""), market: param("market", preset.market ?? ""),
    from_symbol: param("from_symbol", preset.from_symbol ?? ""), to_symbol: param("to_symbol", preset.to_symbol ?? ""),
    interval: param("interval", preset.interval ?? ""), time_period: param("time_period", preset.time_period ?? ""),
    series_type: param("series_type", preset.series_type ?? ""), tickers: param("tickers", ""), limit: param("limit", ""),
  };
  const submitted = typeof sp.function === "string";
  const result = submitted ? await getMarket(kind, query) : null;
  return (
    <>
      <PageHeader title="Live market data" subtitle="Alpha Vantage is primary; Yahoo Finance provides no-key quote/history fallback when its quota is unavailable." right={result && <SourceBadge live={result.live} error={result.error} />} />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card title="Query Alpha Vantage" subtitle="Choose a real data product and submit it through the authenticated Mochatrade API.">
          <form method="get" className="space-y-3 text-sm">
            <label className="block text-muted">Category
              <select name="kind" defaultValue={kind} className={`${inputClass} mt-1`}>
                {Object.entries(PRESETS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </label>
            <label className="block text-muted">Alpha Vantage function<input name="function" defaultValue={query.function} className={`${inputClass} mt-1 font-mono`} /></label>
            <label className="block text-muted">Symbol / series<input name="symbol" defaultValue={query.symbol} className={`${inputClass} mt-1 font-mono`} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-muted">Market<input name="market" defaultValue={query.market} placeholder="USD" className={`${inputClass} mt-1 font-mono`} /></label>
              <label className="block text-muted">Limit<input name="limit" defaultValue={query.limit} placeholder="10" className={`${inputClass} mt-1 font-mono`} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-muted">From currency<input name="from_symbol" defaultValue={query.from_symbol} className={`${inputClass} mt-1 font-mono`} /></label>
              <label className="block text-muted">To currency<input name="to_symbol" defaultValue={query.to_symbol} className={`${inputClass} mt-1 font-mono`} /></label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-muted">Interval<input name="interval" defaultValue={query.interval} className={`${inputClass} mt-1 font-mono`} /></label>
              <label className="block text-muted">Period<input name="time_period" defaultValue={query.time_period} className={`${inputClass} mt-1 font-mono`} /></label>
              <label className="block text-muted">Series<input name="series_type" defaultValue={query.series_type} className={`${inputClass} mt-1 font-mono`} /></label>
            </div>
            <label className="block text-muted">News tickers<input name="tickers" defaultValue={query.tickers} placeholder="NVDA,MSFT" className={`${inputClass} mt-1 font-mono`} /></label>
            <button type="submit" className={`${buttonClass} w-full`}>Fetch live data</button>
          </form>
        </Card>
        <Card title={result?.data ? "Provider response" : "No request yet"} subtitle={result?.data ? `Retrieved ${result.data.retrieved_at}` : "No demo response is shown. Submit a request to view provider data."}>
          {!result ? <Empty>Select a category and fetch a live response.</Empty> : !result.data ? <Empty>{result.error ?? "The provider did not return data."}</Empty> : <pre className="max-h-[620px] overflow-auto rounded-lg bg-surface-2 p-4 text-xs leading-5 text-foreground/85"><Mono>{JSON.stringify(result.data.data, null, 2)}</Mono></pre>}
        </Card>
      </div>
    </>
  );
}
