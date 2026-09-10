# Mochatrade Risk

Mochatrade Risk is a live risk service for linked brokerage accounts. It calculates leverage and overnight margin from persisted, split-adjusted Alpha Vantage data; stores decisions in Supabase; generates bounded, fact-grounded Groq explanations downstream; and anchors daily decision commitments on Sepolia.

The copilot narrates only completed engine decisions. Changed actionable decisions receive per-position explanations, each account receives one persisted Tonight digest at 15:30 ET, and the risk desk receives one daily book brief at 15:00 ET. Every Groq response is JSON-validated and rejected if it introduces a number outside the fact pack; deterministic Jinja templates keep `/tonight/{account_id}` and `/ops/daily-brief` available during provider failures.

It deliberately has no demo fallback. If authentication, market data, or the API is unavailable, the UI says so instead of rendering invented values.

## Configuration

Copy [`api/.env.example`](api/.env.example) to `api/.env` and [`web/.env.local.example`](web/.env.local.example) to `web/.env.local`. Keep both real files out of Git.

Required values not included in the provided connection string:

- Supabase URL and browser-safe anon/publishable key for Google sign-in.
- A long random `INTERNAL_API_KEY` for the server-to-server account/position sync integration only.
- A funded **Sepolia-only** private key before contract deployment. Never use a mainnet key.

In Supabase Auth, configure Google and add these redirect URLs:

- `http://localhost:3000/auth/callback`
- Your deployed web origin followed by `/auth/callback`

## Start locally

```powershell
cd api
python -m pip install -r requirements.txt
python scripts/migrate.py
python scripts/seed_market.py NVDA MSFT SPY
uvicorn app.main:app --reload --port 8000
```

Then, in another terminal:

```powershell
cd web
npm install
npm run dev
```

Alpha Vantage is the preferred source for earnings, corporate actions, and its market explorer. yfinance requires no key and automatically falls back for daily history and live quote polling if the Alpha Vantage quota is exhausted. On a free Alpha Vantage key, seed a deliberately small universe; configure premium rate and daily-budget settings for broad live coverage. The quote poller writes actual intraday prints during market hours, and historical review only displays those persisted prints.

The dashboard identifies each market-explorer response as `alpha_vantage` or `yfinance`. Yahoo Finance is a convenient no-key fallback for this hackathon deployment, not a contractual real-time data feed.

## Brokerage account integration

This project cannot invent user positions or submit trades. Mochatrade's existing server-side brokerage service must call the protected sync endpoint whenever an account, cash balance, or position changes:

```http
POST /internal/accounts/sync
X-Internal-Key: <INTERNAL_API_KEY>
Content-Type: application/json

{
  "auth_user_id": "<Supabase user UUID>",
  "email": "trader@example.com",
  "display_name": "Trader",
  "tz": "Asia/Kolkata",
  "cash": 25000,
  "positions": [{"symbol": "NVDA", "qty": 100, "avg_price": 174.25}]
}
```

The risk API evaluates this real portfolio and logs actionable decisions. Actual order routing remains the responsibility of Mochatrade's regulated execution service; do not wire automatic orders to this app without the broker's approval, compliance review, and idempotent execution workflow.

## Sepolia anchoring

With a funded testnet wallet in `ANCHOR_PRIVATE_KEY`, deploy the contract:

```powershell
cd api
python scripts/deploy_contract.py
```

Copy the returned `CONTRACT_ADDRESS` into `api/.env`, restart the API, then a signed-in user can call `POST /anchor/{YYYY-MM-DD}`. The endpoint builds sorted-pair Keccak Merkle proofs from that day's stored decisions and submits exactly one Sepolia transaction. `GET /verify/{decision_id}` checks the stored proof against `MochaAnchor.verify` on-chain.

## Deploy: Render API + Vercel web

The repository now includes a Docker image at [`api/Dockerfile`](api/Dockerfile), a Render Blueprint at [`render.yaml`](render.yaml), and the Vercel build configuration at [`web/vercel.json`](web/vercel.json). Neither deployment receives a local `.env` file.

1. Push this repository and create a Render **Blueprint** from it. The Blueprint deploys the `api` directory as a Docker web service and uses `GET /health` for health checks. Enter every `sync: false` environment variable in Render from `api/.env`; set `CORS_ORIGINS` to the Vercel production URL and add preview URLs if browser-to-API access is ever enabled. Keep the generated `INTERNAL_API_KEY` private and set the same value in Mochatrade's server-side broker integration.
2. `RUN_MIGRATIONS_ON_START=true` in the Blueprint applies the idempotent Supabase schema at every Render container start. This is intentional and means a successful Render deployment completes the pending migration automatically. The current local migration could not reach the Supabase pooler from this network; see the verification note below.
3. In Vercel, import the same repository with **Root Directory** set to `web`. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), `FASTAPI_URL=https://<your-render-service>.onrender.com`, and optionally `FASTAPI_TIMEOUT_MS=8000` for Production, Preview, and Development as appropriate. `FASTAPI_URL` is server-only; do not prefix it with `NEXT_PUBLIC_`.
4. In Supabase Auth, add `https://<your-vercel-domain>/auth/callback` and any required Vercel preview callback URL to the Google redirect allow-list. Add the deployed web URL to `CORS_ORIGINS` in Render.

Render's free web services spin down while idle. The Blueprint disables the in-process scheduler because it is not a dependable continuous worker on that tier; request-driven API evaluation still works. Use an always-on worker or paid service before depending on unattended polling, timed evaluations, or automatic daily anchoring.

### Release checks

```powershell
# API checks
cd api
pytest -q
python scripts/migrate.py

# Frontend checks
cd ../web
npm ci
npm run lint
npm run build
```

The migration command is safe to run repeatedly. The configured Supabase host currently resolves but its port 6543 connection times out from this computer, so it could not be applied locally. Confirm it through a successful Render deploy or run the command from a network that permits outbound PostgreSQL connections to that Supabase pooler.

## Security boundaries

- Browser code has only the Supabase anon/publishable key; database and Groq keys never leave the server.
- FastAPI verifies each Supabase bearer token with Supabase Auth. This hackathon deployment makes the dashboard, replay, market refresh, evaluation, anchoring, and verification features available to every Google-authenticated user.
- The account/position sync endpoint remains server-to-server only because it changes another service's source-of-truth portfolio data.
- The risk engine makes no database, Groq, or web3 calls while deciding. Persistence, explanations, and anchoring are downstream.
- RLS is enabled on every database table; the Next.js app never queries Supabase tables directly.
