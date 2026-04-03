# AI Trading Bot

Automated stock & crypto trading bot powered by **DeepSeek R1 AI**, **Interactive Brokers**, **Kraken Exchange**, and **World Monitor** for global market intelligence.

## 🚀 Features

- **AI-Powered Analysis**: Uses DeepSeek R1 (14B) running locally via Ollama
- **Multi-Broker Support**: Interactive Brokers (stocks) + Kraken (crypto)
- **Technical Indicators**: RSI, MACD, Bollinger Bands, Stochastic RSI, ATR, OBV, Ichimoku Cloud
- **Global Market Intelligence**: World Monitor integration for commodities, indices, geopolitical risk
- **Automated Trading**: Auto-executes trades when confidence ≥ 75%
- **Risk Management**: Dynamic position sizing, VIX-based adjustments, SPY trend filtering
- **Persistent State**: Bot status and activity logs survive page refreshes (PostgreSQL)
- **Real-Time News**: Financial news from multiple RSS sources
- **Portfolio Tracking**: Real-time balance and P&L monitoring

## 📊 Trading Strategy

- **60% Technical Analysis** + **40% AI Sentiment** = Combined Decision
- VIX-based position sizing (reduces size in high volatility)
- SPY trend filter (blocks BUY signals in market downtrends)
- Fear & Greed Index integration
- Earnings calendar awareness
- Maximum 4 concurrent positions
- Fee-aware position sizing (only trades when profit > fees)

## 🛠️ Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Ollama with DeepSeek R1 14B model
- Interactive Brokers TWS/Gateway (for stocks)
- Kraken API credentials (for crypto)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/utchas007/aitrading.git
cd aitrading

# 2. Install dependencies
cd deepseek-ui
npm install

# 3. Setup database (see DATABASE_SETUP.md for details)
sudo -u postgres psql -c "CREATE USER tradingbot WITH PASSWORD 'tradingbot123';"
sudo -u postgres psql -c "CREATE DATABASE tradingdb OWNER tradingbot;"
npx prisma db push
npx prisma generate

# 4. Configure environment
cp .env.example .env.local
# Edit .env.local with your API keys

# 5. Start all services
./start-all.sh
```

### Environment Variables

Create `deepseek-ui/.env.local`:

```env
# Database
DATABASE_URL="postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb"

# Ollama (AI)
OLLAMA_API_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:14b

# Interactive Brokers
IB_SERVICE_URL=http://localhost:8765

# Kraken (optional - for crypto)
KRAKEN_API_KEY=your_api_key_here
KRAKEN_PRIVATE_KEY=your_private_key_here

# World Monitor (optional)
WORLDMONITOR_API_URL=http://localhost:3000
```

### Start Services Individually

```bash
# 1. Start PostgreSQL
sudo systemctl start postgresql

# 2. Start Ollama and load model
sudo systemctl start ollama
curl -X POST http://localhost:11434/api/generate -d '{"model":"deepseek-r1:14b","keep_alive":-1,"prompt":""}'

# 3. Start IB Service (requires TWS running)
cd ~/Trading\ Project && python3 ib_service.py &

# 4. Start World Monitor (optional)
cd worldmonitor && npm run dev:finance &

# 5. Start Trading Dashboard
cd deepseek-ui && npm run dev
```

## 📱 Access

| Service | URL | Description |
|---------|-----|-------------|
| Trading Dashboard | http://localhost:3001 | Main trading interface |
| IB Service API | http://localhost:8765 | Interactive Brokers API |
| IB API Docs | http://localhost:8765/docs | Swagger documentation |
| World Monitor | http://localhost:3000 | Global market data |
| Ollama | http://localhost:11434 | AI model API |

## ⚙️ Configuration

### Bot Configuration

The bot can be configured via the API or UI:

```typescript
{
  pairs: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],  // Stocks to monitor
  autoExecute: true,                         // true = LIVE trading, false = paper
  minConfidence: 75,                         // Minimum confidence to trade (0-100)
  maxPositions: 4,                           // Max concurrent positions
  riskPerTrade: 0.05,                        // 5% of capital per trade
  stopLossPercent: 0.05,                     // 5% stop loss
  takeProfitPercent: 0.10,                   // 10% take profit
  checkInterval: 5 * 60 * 1000,              // Check every 5 minutes
  tradeCooldownHours: 4,                     // Hours between trades on same stock
  maxDailyTrades: 20,                        // Max trades per day
}
```

### Start Bot via API

```bash
# Start with live trading
curl -X POST http://localhost:3001/api/trading/engine \
  -H "Content-Type: application/json" \
  -d '{"action":"start","config":{"autoExecute":true,"pairs":["AAPL","MSFT"]}}'

# Stop bot
curl -X POST http://localhost:3001/api/trading/engine \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}'

# Check status
curl http://localhost:3001/api/trading/engine
```

## 🗂️ Project Structure

```
aitrading/
├── deepseek-ui/           # Next.js trading dashboard
│   ├── app/              # App router pages & API routes
│   ├── components/       # React components
│   ├── lib/              # Core trading logic
│   │   ├── trading-engine.ts    # Main trading engine
│   │   ├── technical-indicators.ts
│   │   ├── market-intelligence.ts
│   │   ├── bot-state.ts         # Persistent bot state
│   │   ├── activity-logger.ts   # Activity feed
│   │   └── db.ts                # Prisma client
│   └── prisma/           # Database schema
├── worldmonitor/          # Global market data server
├── ib_service.py          # Interactive Brokers Python API
├── DATABASE_SETUP.md      # Database setup guide
├── STARTUP_GUIDE.md       # Startup instructions
└── README.md
```

## 💾 Database

The bot uses PostgreSQL for persistence. See [DATABASE_SETUP.md](DATABASE_SETUP.md) for full setup instructions.

### Key Tables

| Table | Purpose |
|-------|---------|
| `BotState` | Persists bot running state across restarts |
| `ActivityLog` | Bot activity feed (survives page refresh) |
| `TradingSignal` | AI-generated trading signals |
| `Trade` | Executed trade records |
| `PortfolioSnapshot` | Portfolio value history |

### Quick Database Setup

```bash
# Create database
sudo -u postgres psql -c "CREATE USER tradingbot WITH PASSWORD 'tradingbot123';"
sudo -u postgres psql -c "CREATE DATABASE tradingdb OWNER tradingbot;"

# Apply schema
cd deepseek-ui
npx prisma db push
npx prisma generate
```

## 🔒 Security

- API keys stored in `.env.local` (gitignored)
- Paper trading mode available (port 7497)
- Live trading requires explicit `autoExecute: true`
- All orders logged to database

## 📈 Monitoring

```bash
# View activity logs
PGPASSWORD=tradingbot123 psql -U tradingbot -h localhost -d tradingdb \
  -c "SELECT * FROM \"ActivityLog\" ORDER BY \"createdAt\" DESC LIMIT 20;"

# Check bot state
curl http://localhost:3001/api/trading/engine | jq '.status'

# View IB positions
curl http://localhost:8765/positions

# Check IB balance
curl http://localhost:8765/balance
```

## 🛑 Stopping Services

```bash
# Stop trading bot
curl -X POST http://localhost:3001/api/trading/engine \
  -H "Content-Type: application/json" -d '{"action":"stop"}'

# Stop all services
pkill -f 'next dev'
pkill -f 'ib_service.py'
pkill -f 'vite'
```

## 📅 Market Hours

US Stock Market (NYSE/NASDAQ):
- **Regular**: 9:30 AM - 4:00 PM ET (Mon-Fri)
- **Pre-market**: 4:00 AM - 9:30 AM ET
- **After-hours**: 4:00 PM - 8:00 PM ET
- **Closed**: Weekends & holidays (Good Friday, etc.)

## ⚠️ Disclaimer

This bot trades with real money when `autoExecute: true`. Use at your own risk. Always start with paper trading to test your strategy.

## 📝 License

MIT License

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.
