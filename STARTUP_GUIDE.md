# AI Trading Bot - Startup Guide

A comprehensive AI-powered trading system using DeepSeek R1, Interactive Brokers, Kraken, and World Monitor.

---

## 📋 Prerequisites

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18+ | Next.js frontend |
| Python | 3.10+ | IB service |
| PostgreSQL | 14+ | Database |
| Ollama | Latest | Local AI (DeepSeek R1) |
| TWS/IB Gateway | Latest | Interactive Brokers |

---

## 🚀 Quick Start

### 1. Start PostgreSQL
```bash
sudo systemctl start postgresql
```

### 2. Start Ollama & Load DeepSeek Model
```bash
# Start Ollama (usually auto-starts)
sudo systemctl start ollama

# Keep DeepSeek model loaded in memory
curl -X POST http://localhost:11434/api/generate \
  -d '{"model":"deepseek-r1:14b","keep_alive":-1,"prompt":""}'
```

### 3. Start Interactive Brokers (TWS)
- Open TWS or IB Gateway
- Login with your credentials
- Ensure API is enabled: **Edit → Global Configuration → API → Settings**
  - ✅ Enable ActiveX and Socket Clients
  - ✅ Socket port: `7497` (paper) or `7496` (live)
  - ❌ Uncheck "Read-Only API" for trading

### 4. Start IB Python Service
```bash
cd ~/Trading\ Project
nohup python3 ib_service.py > /tmp/ib_service.log 2>&1 &
```

### 5. Start World Monitor (Optional - for global market data)
```bash
cd ~/worldmonitor
nohup npm run dev:finance > /tmp/worldmonitor.log 2>&1 &
```

### 6. Start Next.js Trading Dashboard
```bash
cd ~/Trading\ Project/deepseek-ui
npm run dev
```

---

## 🌐 Access URLs

| Service | URL | Description |
|---------|-----|-------------|
| Trading Dashboard | http://localhost:3001 | Main UI |
| IB Service API | http://localhost:8765 | IB REST API |
| IB API Docs | http://localhost:8765/docs | Swagger docs |
| World Monitor | http://localhost:3003 | Global market data |
| Ollama | http://localhost:11434 | AI model API |

---

## 📁 Project Structure

```
~/Trading Project/
├── deepseek-ui/           # Next.js frontend
│   ├── app/               # Pages & API routes
│   ├── components/        # React components
│   ├── lib/               # Utilities & trading engine
│   └── prisma/            # Database schema
├── ib_service.py          # Interactive Brokers Python service
└── STARTUP_GUIDE.md       # This file
```

---

## 🔧 Environment Variables

Create `deepseek-ui/.env.local`:

```env
# Database
DATABASE_URL="postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb"

# Kraken API (for crypto trading)
KRAKEN_API_KEY=your_api_key
KRAKEN_API_SECRET=your_api_secret

# IB Service
IB_SERVICE_URL=http://localhost:8765

# Ollama
OLLAMA_MODEL=deepseek-r1:14b

# World Monitor
WORLDMONITOR_URL=http://localhost:3003
```

---

## 🛠️ One-Command Startup Script

Create `start-trading.sh`:

```bash
#!/bin/bash

echo "🚀 Starting AI Trading System..."

# 1. PostgreSQL
echo "📦 Starting PostgreSQL..."
sudo systemctl start postgresql

# 2. Ollama
echo "🤖 Starting Ollama..."
sudo systemctl start ollama
sleep 2
curl -s -X POST http://localhost:11434/api/generate \
  -d '{"model":"deepseek-r1:14b","keep_alive":-1,"prompt":""}' > /dev/null &

# 3. IB Service
echo "📈 Starting IB Service..."
cd ~/Trading\ Project
pkill -f "ib_service.py" 2>/dev/null
nohup python3 ib_service.py > /tmp/ib_service.log 2>&1 &
sleep 3

# 4. World Monitor (optional)
echo "🌍 Starting World Monitor..."
cd ~/worldmonitor 2>/dev/null && nohup npm run dev:finance > /tmp/worldmonitor.log 2>&1 &
sleep 2

# 5. Next.js
echo "💻 Starting Trading Dashboard..."
cd ~/Trading\ Project/deepseek-ui
npm run dev &

echo ""
echo "✅ All services started!"
echo ""
echo "📊 Dashboard: http://localhost:3001"
echo "📈 IB API:    http://localhost:8765/docs"
echo ""
echo "⚠️  Make sure TWS/IB Gateway is running and logged in!"
```

Make it executable:
```bash
chmod +x start-trading.sh
./start-trading.sh
```

---

## 🤖 Using the Trading Bot

### Start the Bot
1. Open http://localhost:3001
2. Look at the **Activity Feed** sidebar on the right
3. Click **▶ START BOT** button
4. Bot will analyze stocks every 5 minutes

### Bot Configuration
- **Stocks**: AAPL, MSFT, NVDA, TSLA, GOOGL, AMZN, META, AMD
- **Min Confidence**: 75%
- **Auto Execute**: ON (live trading enabled)

### Manual Analysis
1. Go to **📈 Trading** tab
2. Select a stock (AAPL, NVDA, etc.)
3. View charts, technicals, and AI analysis

---

## 📊 Features

### Data Sources
- ✅ **Interactive Brokers** - Stock prices, OHLC, orders
- ✅ **Kraken** - Crypto prices (BTC, ETH, SOL)
- ✅ **World Monitor** - Global indices, commodities, geopolitics
- ✅ **Yahoo Finance** - Fallback price data
- ✅ **News RSS** - Financial news feeds

### AI Analysis Includes
- Technical indicators (RSI, MACD, Bollinger Bands, EMA)
- Global market context (S&P 500, NASDAQ, DAX, Nikkei)
- Commodity prices (Oil, Gold, Silver)
- Geopolitical risk assessment
- Breaking news sentiment

---

## 🛑 Stopping Services

```bash
# Stop all services
pkill -f "ib_service.py"
pkill -f "next dev"
pkill -f "worldmonitor"

# Or just the bot (keeps UI running)
# Click "⏹ STOP BOT" in the Activity Feed
```

---

## 🔍 Troubleshooting

### IB Service Won't Connect
```bash
# Check if TWS is running on port 7497
lsof -i :7497

# Check IB service logs
tail -50 /tmp/ib_service.log
```

### Empty Portfolio Balance
- Normal when market is closed
- IB doesn't stream account data off-hours
- Will populate when market opens (9:30 AM ET)

### AI Not Responding
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Check if model is loaded
curl http://localhost:11434/api/ps
```

### Database Connection Failed
```bash
# Check PostgreSQL
sudo systemctl status postgresql

# Test connection
psql -h localhost -U tradingbot -d tradingdb -c "SELECT 1"
```

---

## 📱 UI Navigation

| Tab | Description |
|-----|-------------|
| 💬 AI Chat | Chat with DeepSeek about markets |
| 📈 Trading | Dashboard with charts & analysis |
| 🪙 Crypto | Kraken crypto trading |
| 🏦 Stocks | Stock selector & analysis |

---

## ⚠️ Important Notes

1. **Paper Trading First**: Default is paper trading (port 7497). Use 7496 for live trading.
2. **Market Hours**: US markets open Mon-Fri 9:30 AM - 4:00 PM ET
3. **API Limits**: IB has rate limits (~6 requests/min per symbol)
4. **Confidence Threshold**: Bot only executes trades with 75%+ confidence

---

## 📞 Ports Reference

| Port | Service |
|------|---------|
| 3001 | Next.js Dashboard |
| 3003 | World Monitor |
| 7497 | TWS Paper Trading |
| 7496 | TWS Live Trading |
| 8765 | IB Python Service |
| 11434 | Ollama AI |
| 5432 | PostgreSQL |

---

Happy Trading! 🚀📈
