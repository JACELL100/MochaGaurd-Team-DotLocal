from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    # --- database (Supabase pooler, port 6543, transaction mode)
    database_url: str = ''
    supabase_url: str = ''
    supabase_anon_key: str = ''
    supabase_service_role_key: str = ''

    # --- copilot (Groq, OpenAI-compatible)
    groq_api_key: str = ''
    groq_model: str = 'qwen/qwen3.8-27b'
    llm_timeout_s: float = 3.0
    max_llm_explanations_per_run: int = 20

    # --- market data (Alpha Vantage primary; yfinance quote/history fallback)
    alpha_vantage_api_key: str = ''
    alpha_vantage_premium: bool = False
    av_calls_per_minute: int = 5          # free tier: 25/day. premium: 75+/min
    av_daily_budget: int = 25             # stop hitting the API when the day's budget is spent
    quote_poll_seconds: int = 60          # 0 disables the intraday quote poller
    yfinance_enabled: bool = True
    intraday_backfill_on_start: bool = False
    universe: str = ('SPY,QQQ,IWM,AAPL,MSFT,NVDA,TSLA,AMZN,META,GOOGL,AMD,COIN,MSTR,PLTR,'
                     'SMCI,GME,CRM,COST,GLD,SLV,USO,XBI,SOFI,RIVN')

    # --- chain (Sepolia)
    sepolia_rpc_url: str = 'https://ethereum-sepolia-rpc.publicnode.com'
    anchor_private_key: str = ''
    contract_address: str = ''
    anchor_hour_et: int = 20              # anchor the day's decisions at 20:00 ET

    # --- engine tuning: max_leverage = SAFETY / (adverse_move + slippage)
    # SAFETY is the fraction of a customer's equity the broker is willing to see erased by one
    # adverse move before it must already have acted. It is the numerator of the whole engine:
    # 0.30 means "size every position so a p99 move costs at most ~30% of equity", which leaves
    # real headroom for the slippage of actually getting out. Raising it toward 1.0 lets the
    # customer be wiped out completely by a single p99 move and hands the broker the shortfall.
    safety: float = 0.30
    headline_cap: float = 20.0

    # --- perpetual-futures carry
    # Mochatrade's product is perps, where funding ("holding cost") is charged hourly on the
    # full notional. Until a venue feed is wired in, this is the assumed hourly rate used to
    # show users a *deadline* rather than a percentage. mochatrade.com displays ~0.0012%/hr.
    funding_hourly_default: float = 0.000012
    funding_feed_enabled: bool = False

    # --- service
    internal_api_key: str = ''            # server-to-server secret for /internal/accounts/sync only
    scheduler_enabled: bool = True
    run_migrations_on_start: bool = False
    engine_evaluate_seconds: int = 60
    cors_origins: str = 'http://localhost:3000'

    @field_validator('universe', mode='before')
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @property
    def symbols(self) -> list[str]:
        return [s.strip().upper() for s in self.universe.split(',') if s.strip()]

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(',') if origin.strip()]

    @property
    def db_configured(self) -> bool:
        return bool(self.database_url) and '<' not in self.database_url and '`' not in self.database_url

    @property
    def chain_configured(self) -> bool:
        return bool(self.contract_address and self.anchor_private_key and self.sepolia_rpc_url
                    and '<' not in self.contract_address and '<' not in self.anchor_private_key)


settings = Settings()
