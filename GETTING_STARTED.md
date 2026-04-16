# Trading Bot — Getting Started Guide

This document is the **single source of truth** for setting up and running the Trading Bot stack. Previous startup guides (STARTUP_GUIDE.md, STARTUP_README.md, STARTSYSTEM.md) are superseded by this one.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Ubuntu 22.04+ / Debian 12+ | Or WSL2 on Windows |
| Node.js 20+ | Install via [nvm](https://github.com/nvm-sh/nvm) |
| Python 3.10+ | `sudo apt install python3 python3-pip` |
| PostgreSQL 15+ | `sudo apt install postgresql` |
| Ollama | Install from [ollama.com/download](https://ollama.com/download) |
| IB TWS or Gateway | Required for live/paper trading |

---

## 1. Clone & Install

```bash
git clone <repo-url> "Trading Project"
cd "Trading Project"
cd deepseek-ui
npm install
```

---

## 2. Configure Environment

```bash
# Copy the example env file
cp env.local.example.txt .env.local
nano .env.local  # Edit to match your setup
```

**Required variable:**
```
DATABASE_URL=postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb
```

---

## 3. Set Up PostgreSQL

```bash
sudo -u postgres psql -c "CREATE USER tradingbot WITH PASSWORD 'tradingbot123';"
sudo -u postgres psql -c "CREATE DATABASE tradingdb OWNER tradingbot;"
cd deepseek-ui
npx prisma migrate deploy
```

---

## 4. Load AI Model (Ollama)

```bash
sudo systemctl start ollama
ollama pull deepseek-r1:14b

# Warm the model (optional but recommended — keeps it in RAM)
ollama run deepseek-r1:14b "" --no-stream
```

---

## 5. Start IB TWS or Gateway

1. Download and install [TWS](https://www.interactivebrokers.com/en/trading/tws.php) or [IB Gateway](https://www.interactivebrokers.com/en/trading/ibgateway.php)
2. Log in with your paper account credentials
3. In **Configuration → API → Settings**:
   - ✅ Enable ActiveX and Socket Clients
   - Port: `7497` (paper TWS) or `7496` (live TWS)
   - ✅ Allow connections from localhost

---

## 6. Start All Services

### Option A — Manual (development)

Open 4 terminals:

```bash
# Terminal 1: IB Service
cd "Trading Project"
python3 ib_service.py

# Terminal 2: Next.js Dashboard
cd "Trading Project/deepseek-ui"
npm run dev

# Terminal 3: WebSocket Server
cd "Trading Project/deepseek-ui"
npm run ws

# Terminal 4: Trading Bot (optional standalone)
cd "Trading Project/deepseek-ui"
npm run bot
```

### Option B — Systemd (production)

```bash
# Install service units
sudo bash systemd/install.sh

# Start everything
sudo systemctl start ib-service nextjs websocket-server

# Check status
sudo systemctl status nextjs ib-service websocket-server
```

---

## 7. Open Dashboard

Navigate to **http://localhost:3001**

---

## Service URLs

| Service | URL | Description |
|---|---|---|
| Trading Dashboard | http://localhost:3001 | Main UI |
| IB Service API | http://localhost:8765/docs | Swagger UI |
| WebSocket | ws://localhost:3002 | Real-time prices |
| Ollama | http://localhost:11434 | AI API |
| PostgreSQL | localhost:5432 | Database |

---

## Verify Everything is Working

```bash
# Quick health check (all services)
curl http://localhost:3001/api/health | jq

# IB connection
curl http://localhost:8765/health | jq

# Balance (requires IB connected)
curl http://localhost:8765/balance | jq

# Ollama
curl http://localhost:11434/api/tags | jq '.models[].name'
```

---

## Start Trading

1. Open http://localhost:3001
2. Navigate to the **Trading** tab
3. Click **▶ START BOT** in the Activity Feed sidebar
4. Monitor signals in real-time

---

## Log Files

| Service | Log |
|---|---|
| Next.js | `Trading Project/nextjs.log` |
| IB Service | `Trading Project/ib_service.log` |
| Trading Bot | `Trading Project/trading-bot.log` |
| WebSocket | `Trading Project/websocket-server.log` |

Logs rotate automatically after installing log rotation:
```bash
sudo bash scripts/install-logrotate.sh
```

---

## Automated Backups

```bash
# Install daily backup cron job
crontab -e
# Add: 0 2 * * * /home/aiserver/Trading\ Project/scripts/backup-db.sh
```

See [BACKUP_STRATEGY.md](BACKUP_STRATEGY.md) for full details.

---

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.
