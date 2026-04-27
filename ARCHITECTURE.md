# AI Trading Bot — System Architecture

## Overview

An autonomous AI-driven trading system for US equities via Interactive Brokers. The system combines real-time technical analysis, LLM-based sentiment scoring, and geopolitical context to generate and execute bracket orders with built-in risk management.

---

## Infrastructure Diagram

```
                        ┌─────────────────────────────────────────┐
                        │            Docker Compose Stack          │
                        │                                          │
  TWS / IB Gateway ────►│ ib_service (8765, host network)          │
  (host machine)        │     Python FastAPI → ib_insync           │
                        │           ↓                              │
                        │  trading-bot (3003)                      │
                        │     TradingEngine (Node.js)              │
                        │           ↓                              │
                        │  nextjs / dashboard (3001 external/      │
                        │                      3000 internal)      │
                        │     Next.js API + React UI               │
                        │           ↓                              │
                        │  websocket-server (3002)                 │
                        │     Real-time broadcast                  │
                        │           ↓                              │
                        │  worldmonitor (3000)                     │
                        │     Geopolitical context + news          │
                        │           ↓                              │
                        │  postgres (5432)                         │
                        │     PostgreSQL 16                        │
                        │           ↓                              │
                        │  ollama (11434, optional)                │
                        │     DeepSeek R1:14b LLM                  │
                        └─────────────────────────────────────────┘
```

---

## 1. IB Service (`ib_service.py`)

**Role**: REST API bridge between Interactive Brokers TWS/Gateway and the rest of the system.

**Network**: Host networking — required so the service can reach TWS running on the host machine.

**Connection**:
- IB host: `IB_HOST` (default `127.0.0.1`)
- IB port: `IB_PORT` (default `7497` paper / `7496` live / `4002` gateway paper)
- Auto-reconnect with exponential backoff: 5 → 10 → 20 → 40 → 80 → 120s
- Daily reset handling: 11:45 PM – 12:00 AM ET auto-reconnect

**All REST Endpoints**:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Connection status + market session |
| GET | `/market-status` | Session type + next open time |
| GET | `/balance` | Cash, net liquidation, buying power, P&L |
| GET | `/positions` | All open positions with average cost |
| GET | `/ticker/{symbol}` | Live bid/ask/last/volume snapshot |
| GET | `/ohlc/{symbol}` | Historical OHLC bars |
| GET | `/orders` | All open orders with status and fills |
| POST | `/order` | Place or validate a single order |
| POST | `/bracket-order` | Entry + SL + TP bracket (3 linked orders) |
| POST | `/oca-order` | OCA group: stop + limit (cancel on fill) |
| DELETE | `/order/{order_id}` | Cancel single order by ID |
| DELETE | `/orders/symbol/{symbol}` | Cancel all open orders for a symbol |

**Contract Cache**: Pre-loaded conIds for 20 major US stocks (AAPL, MSFT, NVDA, etc.) to avoid round-trip qualifyContractsAsync calls.

---

## 2. Trading Engine (`deepseek-ui/lib/trading-engine.ts`)

**Role**: Core autonomous trading logic — signal generation, execution, position monitoring, risk management.

### Configuration (`TradingEngineConfig`)

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `checkInterval` | 120,000 ms (2 min) | Market cycle frequency |
| `minConfidence` | 75% | Minimum signal confidence to trade |
| `maxPositions` | 6 | Max concurrent open positions |
| `riskPerTrade` | 5% | Position size as % of available cash |
| `stopLossPercent` | 5% | Default SL distance |
| `takeProfitPercent` | 10% | Default TP distance |
| `tradeCooldownHours` | 1h | Minimum time between trades on same symbol |
| `maxDailyTrades` | 30 | Maximum trades per UTC day |
| `partialProfitPercent` | 5% | Profit level to sell 50% of position |
| `trailingActivationPercent` | 7% | Profit level to activate trailing stop |
| `trailingStopPercent` | 3% | Trail distance below peak price |
| `maxDailyLossPercent` | 5% | Daily drawdown cap — blocks new trades |
| `autoExecute` | true (live) | Paper (false) vs live execution mode |

### Market Cycle (every 2 minutes)

```
1. Session check → skip if weekend / holiday / 3:50–4:00 AM break
2. IB health check → pause on 3 consecutive failures, auto-resume on reconnect
3. Fetch live tickers (2s stagger per symbol — IB pacing)
4. Update stale price guard (warn if no valid price for >5 min during open hours)
5. Fetch account balance + update daily drawdown
6. For each symbol (12s stagger for OHLC requests):
   a. Fetch daily OHLC bars (50+ bars required)
   b. Compute technical indicators
   c. Fetch 1h bars for multi-timeframe trend confirmation
   d. Fetch World Monitor news + geopolitical context
   e. Call AI sentiment analysis (DeepSeek R1 via Ollama)
   f. Blend: 60% technicals + 40% AI = final confidence
   g. Apply risk guards (VIX, earnings, SPY downtrend, sector cap)
   h. Apply filters (cooldown, daily limit, profit margin)
   i. Execute if confidence ≥ 75%
```

### Trade Execution

```
Valid signal
    ↓
Position size = risk% × cash, capped at 5% of account
ATR-based SL/TP: SL = price − ATR×1.5, TP = price + ATR×2.0
    ↓
POST /bracket-order to IB service
  ├─ Parent: limit buy at signal price + 0.5% slippage
  ├─ Child 1: stop-loss sell (GTC)
  └─ Child 2: take-profit limit sell (GTC)
    ↓
DB record created (Trade table) with slOrderId, tpOrderId
Notification sent: trade_executed
```

### Position Monitoring (every 30 seconds)

- **Partial profit** (+5%): sell 50% at market, replace bracket with half-size OCA pair, move SL to entry +2.5%
- **Trailing stop** (+7% activation): trail 3% below peak price, ratchet up as price climbs (min 5-minute cooldown)
- **Time exit** (5 days, < +1% P&L): cancel all orders for symbol via `cancelOrdersForSymbol()`, then market sell
- **Bracket fill detection**: check IB positions every 30s — if shares gone → SL or TP fired, update DB, log P&L

### Startup Recovery

- Rebuild `dailyTradeCount`, `dailyRealizedPnl` from Trade table for today
- Restore cooldowns for trades in the last cooldown window
- Load `dynamic_pairs` and `price_last_seen` from BotCache table
- For each open DB trade: cross-check IB positions
  - If IB holds shares → restore ActivePosition (with SL/TP order IDs)
  - If BUY order still pending → cancel it, mark trade `entry_never_filled`
  - If no position and no pending order → mark trade `closed_while_offline`

### Risk Guards

| Guard | Condition | Action |
|-------|-----------|--------|
| Daily drawdown | Loss > `maxDailyLossPercent` of account | Block all new trades until midnight |
| VIX level | VIX > threshold (configurable) | Suppress buy signals |
| Earnings proximity | Earnings within N days | Skip that symbol |
| SPY downtrend | SPY trending down | Reduce buy confidence |
| Sector concentration | Same sector > `maxPositionsPerSector` | Skip symbol |
| IB failure count | 3+ consecutive failures | Pause (not stop) — auto-resume on reconnect |

---

## 3. IB Client (`deepseek-ui/lib/ib-client.ts`)

**Role**: TypeScript wrapper for the IB Service REST API with resilience features.

**Circuit Breaker**:
- CLOSED → OPEN after 3 consecutive failures (fail-fast mode)
- OPEN → HALF_OPEN after 30s (probe recovery)
- Resets to CLOSED on successful probe

**Retry Strategy**:
- 3 retries with backoff: 500ms → 1000ms → 2000ms
- 4xx: fail immediately (client/logic error)
- 5xx / network errors: retry with backoff

**Public Methods**:
```
getHealth()                    → { connected, host, port, accounts, market_status }
getBalance()                   → { NetLiquidation_CAD, TotalCashValue_CAD, BuyingPower_CAD, ... }
getPositions()                 → IBPosition[]
getTicker(symbol, ...)         → IBTicker { bid, ask, last, close, volume, halted, timestamp }
getOHLC(symbol, ...)           → IBOHLCBar[]
getOrders()                    → IBOrder[]
placeOrder(req)                → PlaceOrderResult
placeBracketOrder(req)         → PlaceBracketOrderResult (3 linked orders)
placeOcaOrder(req)             → PlaceOcaOrderResult (OCA group)
cancelOrder(orderId)           → { cancelled, order_id }
cancelOrdersForSymbol(symbol)  → { cancelled: orderId[], count }
```

---

## 4. Technical Indicators (`deepseek-ui/lib/technical-indicators.ts`)

All indicators computed from daily OHLCV bars (1440-min IB bars, 50+ bars required).

| Indicator | Parameters | Signal |
|-----------|-----------|--------|
| RSI | 14-period, Wilder smoothing | >70 overbought, <30 oversold |
| MACD | 12/26/9 EMA | Histogram >0 bullish, <0 bearish |
| Bollinger Bands | 20-period, 2σ | Position above/below/inside bands |
| EMA | 12 & 26 periods | EMA12 > EMA26 = bullish trend |
| Volume Spike | 20-period average | Spike if current > avg × 1.5 |
| Stochastic RSI | K & D lines | K > 80 overbought, K < 20 oversold |
| ATR | Average True Range | Expressed as % of price (volatility) |
| OBV | On-Balance Volume | Trend confirms price moves |
| Ichimoku Cloud | Full 5-line | Price vs cloud + trend confirmation |

**Confidence Scoring** (0–100):

| Indicator | Weight |
|-----------|--------|
| RSI signal | ±25% |
| MACD trend | ±25% |
| Bollinger Bands position | ±20% |
| EMA trend | ±20% |
| Volume spike | ±10% |

**Final Blend**: `confidence = technicals × 0.60 + AI × 0.40`
Boost of +15 when both signals agree direction.

---

## 5. WebSocket Server (`deepseek-ui/websocket-server.ts`)

**Port**: 3002 | **Poll interval**: 3 seconds

**Data Sources per Cycle**:

| Source | Endpoint | Broadcast Event |
|--------|----------|-----------------|
| Next.js API | `/api/stocks/ticker` | `prices` / `pricesDelta` |
| IB Service | `/balance` | `balance` |
| IB Service | `/positions` | `positions` |
| IB Service | `/orders` | `orders` (open only) |
| Next.js API | `/api/trading/engine` | `botStatus`, `activities` |
| IB Service | `/health` | `ibHealth` |

**Client Lifecycle**:
1. Connect → receive full cached snapshot immediately
2. Emit `subscribe { symbols: ['AAPL', ...] }` to filter price updates
3. Receive delta updates only for subscribed symbols + all other broadcasts
4. Disconnect → subscriptions cleaned up

**Optimizations**:
- Price deltas: only broadcast symbols that changed (reduces bandwidth ~80%)
- Per-client symbol subscriptions
- permessage-deflate compression
- Ping/pong every 15s (timeout 20s) for dead-connection detection

---

## 6. Next.js API Routes (`deepseek-ui/app/api/`)

### Trading
| Route | Methods | Purpose |
|-------|---------|---------|
| `/trading/engine` | GET, POST | Bot status + start/stop control |
| `/trading/analyze` | POST | AI sentiment analysis for a pair |
| `/trading/activities` | GET | Activity log stream |
| `/trading/analytics` | GET | Backtest stats, Sharpe ratio, Calmar ratio |
| `/trading/watchlist-suggest` | POST | AI suggests new symbols from headlines |

### Interactive Brokers
| Route | Methods | Purpose |
|-------|---------|---------|
| `/ib/health` | GET | IB + TWS connection status |
| `/ib/ticker` | GET | Live price for a symbol |
| `/ib/ohlc` | GET | Historical OHLC bars (Yahoo fallback) |
| `/ib/balance` | GET | Account values |
| `/ib/market-status` | GET | Current market session |
| `/ib/orders` | GET | All open orders |

### Market Intelligence
| Route | Methods | Purpose |
|-------|---------|---------|
| `/market-intelligence` | GET | Fear & Greed, VIX, SPY trend, earnings risk |
| `/stocks/ticker` | GET | Batch live prices for watchlist |

### World Monitor
| Route | Methods | Purpose |
|-------|---------|---------|
| `/worldmonitor/data` | GET | Raw data from World Monitor service |
| `/worldmonitor/news` | GET | Geopolitical headlines |
| `/worldmonitor/summary` | GET | Commodities, risk score, sentiment |
| `/worldmonitor/health` | GET | World Monitor service status |

### Portfolio & System
| Route | Methods | Purpose |
|-------|---------|---------|
| `/portfolio/snapshot` | POST | Save account snapshot |
| `/portfolio/history` | GET | Historical portfolio snapshots |
| `/health` | GET | All services: DB, IB, Ollama, World Monitor |
| `/notifications` | GET, POST | User alert bell |
| `/cron/cleanup` | POST | Cleanup old logs and notifications |

---

## 7. World Monitor (`worldmonitor/`)

**Role**: Real-time geopolitical risk assessment, commodity price tracking, and news aggregation. Provides context to the trading engine to avoid entering positions during high-risk macro events.

**Feeds**:
- Geopolitical news (parsed from RSS + custom sources)
- Global indices (Yahoo Finance)
- Commodity prices: oil, gas, gold, metals (Yahoo Finance)
- Fear & Greed Index

**API Endpoints** (consumed by Next.js):
- `/api/indices` — Major indices (SPY, VIX, QQQ, etc.)
- `/api/news` — Geopolitical headlines
- `/api/summary` — Aggregated risk score + commodities + sentiment

**Integration with Trading Engine**:
- High geopolitical risk → logged as warning, suppresses buy signals
- Oil spike > 2% → noted for energy sector signals
- Earnings risk alerts → symbol skipped during earnings window

---

## 8. Database Schema (PostgreSQL)

| Table | Purpose |
|-------|---------|
| `TradingSignal` | Every generated signal with full technicals + sentiment |
| `Trade` | Open and closed positions (includes slOrderId, tpOrderId for restart recovery) |
| `PortfolioSnapshot` | Periodic account snapshots (net liquidation, cash, unrealized P&L) |
| `ActivityLog` | Real-time bot activity stream (type, message, pair, data) |
| `PriceCandle` | Cached OHLCV bars (pair, interval, time) |
| `MarketIntelligence` | Fear & Greed, Reddit sentiment, consensus signals |
| `ChatConversation` / `ChatMessage` | AI analysis conversation history |
| `Notification` | User alerts (trade_executed, trade_closed, ib_disconnected, etc.) |
| `BotState` | Bot running/stopped state + last config |
| `BotCache` | Key-value runtime state (dynamic_pairs, price_last_seen, etc.) |

**Key Indexes**:
- `Trade`: `[status]`, `[pair, createdAt]`
- `ActivityLog`: `[createdAt, type]`, `[pair, createdAt]`
- `Notification`: `[read]`, `[pair, createdAt]`
- `PriceCandle`: unique `[pair, interval, time]`

**Retention**:
- ActivityLog: 90 days
- Notifications: 30 days

---

## 9. Frontend Components (`deepseek-ui/components/`)

| Component | Purpose |
|-----------|---------|
| `trading-dashboard.tsx` | Main layout: price chart, positions, activity |
| `trading-chart.tsx` | Candlestick chart with indicator overlays |
| `portfolio-chart.tsx` | Portfolio value over time |
| `analysis-panel.tsx` | Signal details: technicals, AI reasoning |
| `market-intelligence-panel.tsx` | Fear & Greed, VIX, SPY trend, news |
| `notification-bell.tsx` | Alert bell (polls every 10s, unread count badge) |

**Real-Time Updates**:
- WebSocket connection to port 3002
- `prices` / `pricesDelta` → live ticker updates
- `positions`, `orders`, `balance` → live position tracking
- `activities`, `newActivity` → live bot activity log
- `botStatus` → start/stop state, active positions count

---

## 10. Key Constants

| Constant | Value |
|----------|-------|
| `TECHNICAL_WEIGHT` | 0.60 |
| `AI_WEIGHT` | 0.40 |
| `AGREEMENT_CONFIDENCE_BOOST` | +15 |
| `MAX_IB_FAILURE_COUNT` | 3 |
| `RATCHET_MIN_INTERVAL_MS` | 300,000 (5 min) |
| `STALE_PRICE_THRESHOLD_MS` | 300,000 (5 min) |
| `AI_WATCHLIST_INTERVAL_H` | 6 hours |
| `MAX_DYNAMIC_PAIRS` | 5 |
| `DYNAMIC_PAIR_TTL_H` | 24 hours |
| `IB_TICKER_STAGGER_MS` | 2,000 |
| `IB_OHLC_STAGGER_MS` | 12,000 |
| `POSITION_MONITOR_INTERVAL_MS` | 30,000 |

---

## 11. Environment Variables

```
# Interactive Brokers
IB_HOST=127.0.0.1
IB_PORT=7497              # 7497 paper | 7496 live | 4002 gateway paper | 4001 gateway live
IB_CLIENT=10
IB_SERVICE_URL=http://host.docker.internal:8765
IB_API_KEY=<optional>

# Database
DATABASE_URL=postgresql://tradingbot:tradingbot123@postgres:5432/tradingdb

# AI
OLLAMA_API_URL=http://host.docker.internal:11434
OLLAMA_MODEL=deepseek-r1:14b

# Services (internal Docker DNS names)
NEXTJS_URL=http://nextjs:3000
WORLDMONITOR_URL=http://worldmonitor:3000
WS_PORT=3002
BOT_PORT=3003

# World Monitor data feeds
FINNHUB_API_KEY=<optional>
EIA_API_KEY=<optional>
FRED_API_KEY=<optional>

# General
NODE_ENV=production
LOG_LEVEL=info
```

---

## 12. Deployment & Auto-Start

**Docker**: Snap Docker (`snap.docker.dockerd`). All services use `restart: unless-stopped`.

**Auto-start on PC boot**: Docker daemon starts automatically via snap. All containers restart unless manually stopped.

**Service files** (`etc/`):
- `trading-dashboard.service`
- `trading-ib.service`
- `trading-websocket.service`

**Port Mapping** (external:internal):
- `3001:3000` — Next.js dashboard (external 3001, internal 3000)
- `3002:3002` — WebSocket server
- `3003:3003` — Trading bot
- `3000:3000` — World Monitor
- `5432:5432` — PostgreSQL
- `11434:11434` — Ollama
- `8765` — IB Service (host network — no port mapping needed)

> **Important**: Next.js listens on port 3000 inside the container. Inter-service calls must use `http://nextjs:3000` (internal Docker DNS), not `localhost:3001` (external only).

---

## 13. Full End-to-End Signal Flow

```
Every 2 minutes:
  checkMarkets()
    │
    ├─ Session check (skip if closed/break)
    ├─ IB health (pause on 3 failures, auto-resume)
    ├─ Fetch all tickers (2s stagger) → update priceLastSeenAt
    ├─ Fetch account balance → check daily drawdown limit
    │
    └─ Per symbol (12s stagger):
         ├─ Fetch 1440-min OHLC (50+ bars)
         ├─ Compute: RSI, MACD, BB, EMA, ATR, StochRSI, OBV, Ichimoku
         ├─ Fetch 60-min bars → multi-timeframe trend (+1/-1)
         ├─ Fetch World Monitor: headlines, geopolitical risk, commodities
         ├─ POST /api/trading/analyze → DeepSeek R1 sentiment score
         ├─ GET /api/market-intelligence → Fear&Greed, VIX, SPY, earnings
         ├─ Blend: technicals (60%) + AI (40%) → confidence
         ├─ Apply guards: VIX, earnings, SPY, sector cap, daily limit, cooldown
         │
         ├─ confidence < 75% → log and skip
         └─ confidence ≥ 75%:
              ├─ Calculate position size (risk% × cash, max 5% account)
              ├─ ATR-based SL (−1.5×ATR) and TP (+2.0×ATR)
              ├─ POST /bracket-order to IB Service
              │    ├─ Entry: limit buy + 0.5% slippage
              │    ├─ Stop-loss: GTC stop sell
              │    └─ Take-profit: GTC limit sell
              ├─ Save Trade to DB (with slOrderId, tpOrderId)
              └─ Send notification: trade_executed

Every 30 seconds:
  updatePositions()
    ├─ For each open trade: fetch live price from IB
    ├─ If +5% P&L: sell 50%, replace bracket, move SL to break-even+
    ├─ If +7% P&L: activate trailing stop (trail 3% below peak)
    ├─ If 5 days old + < +1% P&L: cancel all orders, market sell
    └─ If shares gone in IB: SL or TP fired → close trade, log P&L

Every 6 hours:
  suggestWatchlistAdditions()
    ├─ Fetch World Monitor headlines
    ├─ Ask DeepSeek: "which US tickers are trending?"
    └─ Add up to 5 symbols to dynamic watchlist (24h TTL, persisted to BotCache)

On bot start / restart:
  recoverPositions()
    ├─ Rebuild daily P&L, trade count, cooldowns from DB
    ├─ Load dynamic_pairs + price_last_seen from BotCache
    └─ For each open Trade in DB:
         ├─ IB has shares → restore ActivePosition in memory
         ├─ BUY order pending → cancel it, mark entry_never_filled
         └─ No position, no order → mark closed_while_offline
```
