# AI Trading Bot - Complete Startup Guide

A comprehensive guide to starting the AI-powered trading system with DeepSeek R1, Interactive Brokers, and real-time market monitoring.

---

## 📋 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI Trading Bot System                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │  PostgreSQL  │◄───│   Prisma     │◄───│   Next.js Dashboard  │  │
│  │  Port 5432   │    │   ORM        │    │   Port 3001          │  │
│  └──────────────┘    └──────────────┘    └──────────┬───────────┘  │
│                                                      │              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────▼───────────┐  │
│  │  IB Service  │◄───│   TWS/IB     │    │   WebSocket Server   │  │
│  │  Port 8765   │    │  Gateway     │    │   Port 3002          │  │
│  └──────────────┘    │  Port 7497   │    └──────────────────────┘  │
│                      └──────────────┘                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ World Monitor│    │   Ollama     │    │   Prisma Studio      │  │
│  │  Port 3000   │    │  Port 11434  │    │   Port 5555          │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Prerequisites

| Software | Version | Purpose | Install Command |
|----------|---------|---------|-----------------|
| Node.js | 18+ | Next.js, WebSocket | `nvm install 18` |
| Python | 3.10+ | IB Service | `sudo apt install python3` |
| PostgreSQL | 14+ | Database | `sudo apt install postgresql` |
| Ollama | Latest | Local AI (DeepSeek R1) | See [ollama.ai](https://ollama.ai) |
| TWS/IB Gateway | Latest | Interactive Brokers | Download from IB |

### Python Dependencies
```bash
pip install ib_insync fastapi uvicorn pytz
```

### Node Dependencies
```bash
cd deepseek-ui && npm install
cd worldmonitor && npm install
```

---

## 🚀 Quick Start (One Command)

```bash
./start-all.sh
```

This starts all services in the correct order with health checks.

### Other Commands
```bash
./start-all.sh --status    # Check service status
./start-all.sh --stop      # Stop all services
```

---

## 📝 Manual Startup (Step by Step)

### Step 1: Start PostgreSQL
```bash
sudo systemctl start postgresql
```

Verify:
```bash
nc -z localhost 5432 && echo "PostgreSQL: UP"
```

### Step 2: Start Ollama & Load DeepSeek Model
```bash
# Start Ollama service
sudo systemctl start ollama

# Keep DeepSeek model loaded in memory (optional but recommended)
curl -X POST http://localhost:11434/api/generate \
  -d '{"model":"deepseek-r1:14b","keep_alive":-1,"prompt":""}'
```

Verify:
```bash
curl http://localhost:11434/api/tags
```

### Step 3: Start Interactive Brokers (TWS)
1. Open TWS or IB Gateway application
2. Login with your credentials
3. Configure API settings: **Edit → Global Configuration → API → Settings**
   - ✅ Enable ActiveX and Socket Clients
   - ✅ Socket port: `7497` (paper) or `7496` (live)
   - ❌ Uncheck "Read-Only API" for trading

### Step 4: Start IB Python Service
```bash
cd ~/Trading\ Project
nohup python3 ib_service.py >> ib_service.log 2>&1 &
```

Verify:
```bash
curl http://localhost:8765/health
```

Expected response:
```json
{
  "connected": true,
  "host": "127.0.0.1",
  "port": 7497,
  "accounts": ["YOUR_ACCOUNT_ID"]
}
```

### Step 5: Start World Monitor
```bash
cd ~/Trading\ Project/worldmonitor
nohup npm run dev:finance >> ../worldmonitor.log 2>&1 &
```

Verify:
```bash
nc -z localhost 3000 && echo "World Monitor: UP"
```

### Step 6: Start Next.js Dashboard (Production)
```bash
cd ~/Trading\ Project/deepseek-ui

# Build first
npm run build

# Start production server
PORT=3001 npm start >> ../nextjs.log 2>&1 &
```

Or for development:
```bash
npm run dev
```

Verify:
```bash
nc -z localhost 3001 && echo "Next.js: UP"
```

### Step 7: Start WebSocket Server
```bash
cd ~/Trading\ Project/deepseek-ui
nohup npx tsx websocket-server.ts >> ../websocket-server.log 2>&1 &
```

Verify:
```bash
nc -z localhost 3002 && echo "WebSocket: UP"
```

### Step 8: Start Prisma Studio (Optional - Database GUI)
```bash
cd ~/Trading\ Project/deepseek-ui
nohup npx prisma studio --port 5555 >> ../prisma-studio.log 2>&1 &
```

Verify:
```bash
nc -z localhost 5555 && echo "Prisma Studio: UP"
```

---

## 🌐 Service URLs

| Service | URL | Description |
|---------|-----|-------------|
| Trading Dashboard | http://localhost:3001 | Main UI |
| Prisma Studio | http://localhost:5555 | Database GUI |
| IB Service API | http://localhost:8765 | IB REST API |
| IB API Docs | http://localhost:8765/docs | Swagger documentation |
| World Monitor | http://localhost:3000 | Global market data |
| WebSocket | ws://localhost:3002 | Real-time price updates |
| Ollama | http://localhost:11434 | AI model API |

---

## 🔌 Port Reference

| Port | Service | Protocol |
|------|---------|----------|
| 3000 | World Monitor | HTTP |
| 3001 | Next.js Dashboard | HTTP |
| 3002 | WebSocket Server | WS |
| 5432 | PostgreSQL | TCP |
| 5555 | Prisma Studio | HTTP |
| 7496 | TWS Live Trading | TCP |
| 7497 | TWS Paper Trading | TCP |
| 8765 | IB Python Service | HTTP |
| 11434 | Ollama AI | HTTP |

---

## ✅ Health Check Script

Create and run this to verify all services:

```bash
#!/bin/bash
echo "=== Service Health Check ==="

nc -z localhost 5432 && echo "✅ PostgreSQL (5432)" || echo "❌ PostgreSQL (5432)"
nc -z localhost 11434 && echo "✅ Ollama (11434)" || echo "❌ Ollama (11434)"
nc -z localhost 8765 && echo "✅ IB Service (8765)" || echo "❌ IB Service (8765)"
nc -z localhost 3000 && echo "✅ World Monitor (3000)" || echo "❌ World Monitor (3000)"
nc -z localhost 3001 && echo "✅ Next.js (3001)" || echo "❌ Next.js (3001)"
nc -z localhost 3002 && echo "✅ WebSocket (3002)" || echo "❌ WebSocket (3002)"
nc -z localhost 5555 && echo "✅ Prisma Studio (5555)" || echo "❌ Prisma Studio (5555)"

echo ""
echo "=== IB Connection Status ==="
curl -s http://localhost:8765/health | python3 -m json.tool 2>/dev/null || echo "❌ Cannot reach IB Service"
```

---

## 🛑 Stopping Services

### Stop All (using start-all.sh)
```bash
./start-all.sh --stop
```

### Manual Stop
```bash
# Stop by process name
pkill -f "ib_service.py"
pkill -f "next start"
pkill -f "next dev"
pkill -f "websocket-server"
pkill -f "prisma studio"
pkill -f "vite"  # World Monitor

# Or kill by port
fuser -k 8765/tcp  # IB Service
fuser -k 3001/tcp  # Next.js
fuser -k 3002/tcp  # WebSocket
fuser -k 3000/tcp  # World Monitor
fuser -k 5555/tcp  # Prisma Studio
```

---

## 📋 Log Files

All logs are stored in the project root:

| Log File | Service |
|----------|---------|
| `ib_service.log` | IB Python Service |
| `nextjs.log` | Next.js Dashboard |
| `websocket-server.log` | WebSocket Server |
| `worldmonitor.log` | World Monitor |
| `prisma-studio.log` | Prisma Studio |

### View Logs
```bash
# Real-time log viewing
tail -f ib_service.log
tail -f nextjs.log
tail -f websocket-server.log

# View last 50 lines
tail -50 ib_service.log
```

---

## 🔧 Troubleshooting

### IB Service Won't Connect
```bash
# Check if TWS is running
nc -z localhost 7497 && echo "TWS: UP" || echo "TWS: DOWN"

# Check IB service logs
tail -50 ib_service.log

# Restart IB service
pkill -f "ib_service.py"
python3 ib_service.py >> ib_service.log 2>&1 &
```

### Prisma/Database Issues
```bash
# Check PostgreSQL
sudo systemctl status postgresql

# Regenerate Prisma client
cd deepseek-ui
npx prisma generate

# Push schema changes
npx prisma db push

# Reset database (WARNING: deletes data)
npx prisma migrate reset
```

### WebSocket Server Fails (EADDRINUSE)
```bash
# Port already in use - kill existing process
fuser -k 3002/tcp

# Restart
cd deepseek-ui && npx tsx websocket-server.ts >> ../websocket-server.log 2>&1 &
```

### Next.js Build Errors
```bash
# Clear cache and rebuild
cd deepseek-ui
rm -rf .next
npm run build
```

### World Monitor Missing "start" Script
The World Monitor uses `npm run dev:finance` not `npm start`:
```bash
cd worldmonitor
npm run dev:finance
```

---

## 📁 Project Structure

```
~/Trading Project/
├── deepseek-ui/              # Next.js frontend
│   ├── app/                  # Pages & API routes
│   ├── components/           # React components
│   ├── lib/                  # Utilities & trading engine
│   ├── prisma/               # Database schema
│   └── websocket-server.ts   # Real-time WebSocket server
├── worldmonitor/             # Global market data dashboard
├── ib_service.py             # Interactive Brokers Python API
├── start-all.sh              # Main startup script
├── .pids/                    # Process ID files
├── *.log                     # Service log files
└── STARTUP_README.md         # This file
```

---

## 🔐 Environment Variables

The following environment variables should be set in `deepseek-ui/.env.local`:

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
WORLDMONITOR_URL=http://localhost:3000
```

---

## 🤖 Using the Trading Bot

1. Open http://localhost:3001
2. Navigate to the **Trading** tab
3. Click **▶ START BOT** in the Activity Feed sidebar
4. Bot analyzes stocks every 5 minutes during market hours

### Default Configuration
- **Stocks**: AAPL, MSFT, NVDA, TSLA, GOOGL, AMZN, META, AMD
- **Min Confidence**: 75%
- **Auto Execute**: ON

---

## ⚠️ Important Notes

1. **Paper Trading First**: Default port 7497 is paper trading. Use 7496 for live.
2. **Market Hours**: US markets Mon-Fri 9:30 AM - 4:00 PM ET
3. **API Limits**: IB has rate limits (~6 requests/min per symbol)
4. **TWS Must Be Running**: IB Service requires TWS/Gateway to be open and logged in

---

## 📞 Support

For issues:
1. Check the relevant log file
2. Verify all services are running with `./start-all.sh --status`
3. Ensure TWS/IB Gateway is running and API is enabled

---

Happy Trading! 🚀📈
