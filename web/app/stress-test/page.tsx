import { Banner, PageHeader, SourceBadge } from "@/components/ui";
import { getAccounts, getTonight } from "@/lib/api";
import type { AccountSummary, AccountView } from "@/lib/types";
import { StressTestSimulator } from "@/components/StressTestSimulator";

export const metadata = {
  title: "Overnight Stress Test & Gap Simulator",
  description: "Simulate catastrophic overnight gaps, margin call thresholds, and 15:45 auto-derisking on live portfolios.",
};

const DEMO_ACCOUNTS: AccountSummary[] = [
  {
    id: "demo-trader-01",
    display_name: "Demo Portfolio (Levered Tech · 4.2x)",
    tz: "Asia/Kolkata",
    equity: 30000,
    status: "action_needed",
  },
  {
    id: "demo-trader-02",
    display_name: "Safe Index Portfolio (Unlevered · 0.8x)",
    tz: "America/New_York",
    equity: 85000,
    status: "safe",
  },
  {
    id: "demo-trader-03",
    display_name: "Aggressive Speculator (Hot Earnings · 5.8x)",
    tz: "Asia/Dubai",
    equity: 24000,
    status: "auto_derisk",
  },
];

const DEMO_PORTFOLIOS: Record<string, AccountView> = {
  "demo-trader-01": {
    account_id: "demo-trader-01",
    display_name: "Demo Portfolio (Levered Tech · 4.2x)",
    tz: "Asia/Kolkata",
    cash: -95665, // Margin loan debt = Equity ($30,000) - Gross ($125,665)
    equity: 30000,
    margin_required: 27184,
    worst_case_loss: 18400,
    gross_exposure: 125665,
    margin_ratio: 1.10,
    leverage_used: 4.19,
    positions: [
      {
        symbol: "NVDA",
        qty: 120,
        price: 174.25,
        notional: 20910,
        max_leverage: 4.5,
        adverse_move: 0.064,
        earnings_tonight: true,
        frozen: false,
      },
      {
        symbol: "TSLA",
        qty: 85,
        price: 242.8,
        notional: 20638,
        max_leverage: 3.7,
        adverse_move: 0.08,
        earnings_tonight: false,
        frozen: false,
      },
      {
        symbol: "AAPL",
        qty: 150,
        price: 228.5,
        notional: 34275,
        max_leverage: 7.1,
        adverse_move: 0.041,
        earnings_tonight: false,
        frozen: false,
      },
      {
        symbol: "MSFT",
        qty: 110,
        price: 448.2,
        notional: 49302,
        max_leverage: 6.9,
        adverse_move: 0.042,
        earnings_tonight: false,
        frozen: false,
      },
    ],
  },
  "demo-trader-02": {
    account_id: "demo-trader-02",
    display_name: "Safe Index Portfolio (Unlevered · 0.8x)",
    tz: "America/New_York",
    cash: 25125, // Cash buffer = Equity ($85,000) - Gross ($59,875)
    equity: 85000,
    margin_required: 4989,
    worst_case_loss: 4200,
    gross_exposure: 59875,
    margin_ratio: 17.0,
    leverage_used: 0.70,
    positions: [
      {
        symbol: "SPY",
        qty: 100,
        price: 598.75,
        notional: 59875,
        max_leverage: 12.0,
        adverse_move: 0.024,
        earnings_tonight: false,
        frozen: false,
      },
    ],
  },
  "demo-trader-03": {
    account_id: "demo-trader-03",
    display_name: "Aggressive Speculator (Hot Earnings · 5.8x)",
    tz: "Asia/Dubai",
    cash: -115000,
    equity: 24000,
    margin_required: 36500,
    worst_case_loss: 19500,
    gross_exposure: 139000,
    margin_ratio: 0.65,
    leverage_used: 5.79,
    positions: [
      {
        symbol: "NVDA",
        qty: 350,
        price: 174.25,
        notional: 60987,
        max_leverage: 1.1, // Drastic cut due to Earnings AMC
        adverse_move: 0.064,
        earnings_tonight: true,
        frozen: false,
      },
      {
        symbol: "TSLA",
        qty: 250,
        price: 242.8,
        notional: 60700,
        max_leverage: 3.7,
        adverse_move: 0.08,
        earnings_tonight: false,
        frozen: false,
      },
      {
        symbol: "AMD",
        qty: 110,
        price: 155.4,
        notional: 17094,
        max_leverage: 4.8,
        adverse_move: 0.058,
        earnings_tonight: false,
        frozen: false,
      },
    ],
  },
};

export default async function StressTestPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { account } = await searchParams;
  const accountsRes = await getAccounts();
  const liveAccounts = accountsRes.data ?? [];

  const requested = typeof account === "string" ? account : undefined;
  const fallback = liveAccounts.find((a) => a.status !== "safe") ?? liveAccounts[0];
  const selectedId = requested ?? fallback?.id;

  const tonightRes = selectedId ? await getTonight(selectedId) : null;
  const liveBriefing = tonightRes?.data ?? null;

  // Use live portfolio if authenticated, otherwise use the interactive demo portfolio
  const isLive = Boolean(liveBriefing);
  const activeAccount: AccountView =
    liveBriefing?.account ??
    (selectedId ? DEMO_PORTFOLIOS[selectedId] : undefined) ??
    DEMO_PORTFOLIOS["demo-trader-01"];
  const accountList: AccountSummary[] = [
    ...liveAccounts,
    ...DEMO_ACCOUNTS.filter((d) => !liveAccounts.some((la) => la.id === d.id)),
  ];

  const allPortfoliosMap: Record<string, AccountView> = {
    ...DEMO_PORTFOLIOS,
  };
  if (liveBriefing?.account) {
    allPortfoliosMap[liveBriefing.account.account_id] = liveBriefing.account;
  }

  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <PageHeader
        title="Overnight Stress Test"
        subtitle="Simulate overnight market gap crashes against portfolios, add custom stocks, and inspect exact 15:45 automated liquidation plans."
        right={
          isLive ? (
            <SourceBadge live={true} />
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-[#7C3AED]/40 bg-[#7C3AED]/15 px-3 py-1 text-xs font-mono text-[#C4B5FD]">
              <span className="h-2 w-2 rounded-full bg-[#A78BFA] animate-pulse" />
              Interactive Sandbox Mode
            </div>
          )
        }
      />

      <StressTestSimulator
        accounts={accountList}
        selectedAccount={activeAccount}
        allPortfolios={allPortfoliosMap}
      />
    </div>
  );
}
