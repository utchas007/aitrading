# Trading Bot — Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       User / Browser                        │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP + WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js Dashboard  (port 3001)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  React UI    │  │  API Routes  │  │  Socket.IO       │  │
│  │  Components  │  │  /api/*      │  │  Client          │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                   │                    │ ws://
         │                   │                    ▼
         │           ┌───────┴──────┐  ┌─────────────────────┐
         │           │  PostgreSQL  │  │  WebSocket Server   │
         │           │  (port 5432) │  │  (port 3002)        │
         │           └──────────────┘  │  Polls: prices,     │
         │                             │  balance, positions  │
         │                             └──────────┬──────────┘
         │                                        │
         ▼                                        │
┌─────────────────────────┐                       │
│  IB Service  (port 8765)│◄──────────────────────┘
│  Python + FastAPI        │
│  Interactive Brokers     │
│  Gateway REST API        │
└──────────┬──────────────┘
           │ IB API (TCP)
           ▼
┌─────────────────────────┐
│  TWS / IB Gateway       │
│  (port 7497 paper)      │
│  (port 7496 live)       │
└─────────────────────────┘

┌─────────────────────────┐   ┌─────────────────────────┐
│  Ollama  (port 11434)   │   │  World Monitor           │
│  deepseek-r1:14b        │   │  (port 3000)             │
│  AI sentiment analysis  │   │  Geopolitical context    │
└─────────────────────────┘   └─────────────────────────┘
```

---

## Services

| Service | Technology | Port | Purpose |
|---|---|---|---|
| **Next.js Dashboard** | Next.js 15, React 19 | 3001 | Trading UI, API routes |
| **WebSocket Server** | Node.js, Socket.IO | 3002 | Real-time price/status broadcasts |
| **Standalone Bot** | Node.js, tsx | 3002 | Persistent trading engine (optional) |
| **IB Service** | Python, FastAPI | 8765 | Interactive Brokers REST wrapper |
| **PostgreSQL** | PostgreSQL 16 | 5432 | Trade records, signals, activity log |
| **Ollama** | Go, LLM | 11434 | Local AI sentiment analysis |
| **World Monitor** | Next.js | 3000 | Geopolitical intelligence (optional) |

---

## Key Files

```
Trading Project/
├── ib_service.py               IB service (FastAPI, Python)
├── deepseek-ui/
│   ├── app/api/                API routes (Next.js)
│   │   ├── health/             System health check
│   │   ├── ib/                 IB proxy routes
│   │   ├── trading/            Engine control + analysis
│   │   ├── notifications/      Alert management
│   │   └── config/schema       Debug config inspector
│   ├── lib/
│   │   ├── trading-engine.ts   Core trading logic
│   │   ├── engine/             Modular engine components
│   │   │   ├── signal-generator.ts    AI + technical signal
│   │   │   ├── position-manager.ts    Position tracking
│   │   │   └── risk-validator.ts      Trade gates
│   │   ├── technical-indicators.ts    RSI, MACD, BB, EMA
│   │   ├── market-intelligence.ts     VIX, Fear&Greed, SPY
│   │   ├── ib-client.ts               IB REST client
│   │   ├── risk-management.ts         Position sizing
│   │   ├── activity-logger.ts         Activity feed
│   │   ├── constants.ts               Trading thresholds
│   │   ├── validation.ts              Zod schemas
│   │   ├── cache.ts                   TTL caches
│   │   ├── data-quality.ts            OHLC validation
│   │   ├── alerting.ts                Crash + balance alerts
│   │   ├── api-response.ts            Error format standard
│   │   ├── api-middleware.ts          Route error handler
│   │   ├── correlation.ts             Request tracing
│   │   ├── logger.ts                  Structured logger
│   │   ├── market-hours.ts            NYSE holiday calendar
│   │   └── startup-check.ts           Env var validation
│   ├── prisma/schema.prisma           Database schema
│   ├── websocket-server.ts            WS broadcast server
│   └── scripts/trading-bot.ts        Standalone bot entry
├── scripts/
│   ├── backup-db.sh            Daily pg_dump backup
│   ├── restore-db.sh           DB restore from backup
│   └── install-logrotate.sh    logrotate setup
├── systemd/                    systemd unit files
├── logrotate.conf              Log rotation config
├── GETTING_STARTED.md          Setup guide (start here)
├── TROUBLESHOOTING.md          Common issues + fixes
├── BACKUP_STRATEGY.md          Backup documentation
└── ARCHITECTURE.md             This file
```

---

## Data Flow — Trade Execution

```
1. Trading Engine wakes (every 2 minutes by default)
       │
2. Fetch IB health check → if down, wait or stop
       │
3. Fetch IB account balance (cached 30s)
       │
4. For each pair (AAPL, MSFT, …):
   a. Fetch OHLCV history → validate quality
   b. Calculate technicals (RSI, MACD, BB, EMA, StochRSI, ATR, OBV, Ichimoku)
   c. Fetch market sentiment (VIX, Fear&Greed, SPY trend, earnings) ← cached
   d. Call /api/trading/analyze → Ollama AI sentiment
   e. Combine signals → action (buy / sell / hold)
   f. Apply micro-filters (volume, BB+RSI, VIX+MACD, SPY trend)
   g. Calculate fee-aware position size
   h. Apply risk gates (daily limit, cooldown, profit margin)
   i. If action: place IB bracket order (entry + SL + TP)
   j. Persist trade + activity log atomically (prisma.$transaction)
       │
5. Position monitor (every 30s):
   a. Fetch latest IB positions
   b. If IB position closed → mark trade 'closed' in DB, log P&L
   c. Send notification
       │
6. WebSocket server polls (every 3s):
   → broadcasts price deltas, balance, positions, status
```

---

## Database Schema

Key tables:

| Table | Purpose |
|---|---|
| `Trade` | Open/closed trade records with entry, SL, TP, P&L |
| `TradingSignal` | Every generated signal (executed or not) |
| `PortfolioSnapshot` | Daily portfolio value history |
| `ActivityLog` | Bot activity feed (90-day retention) |
| `BotState` | Single row: is bot running? what config? |
| `Notification` | UI alerts (trades, errors, IB disconnect) |
| `ChatConversation` | AI chat history |
| `PriceCandle` | OHLCV data indexed by pair + interval |

---

## Environment Variables

See `deepseek-ui/env.local.example.txt` for all variables with descriptions.
See `GET /api/config/schema` for live runtime config with secrets redacted.
