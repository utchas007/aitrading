# 🚀 Start System - Quick Reference

Quick commands to start the entire AI Trading System.

---

## ⚡ One-Command Start (Copy & Paste)

```bash
# Start everything in order
systemctl status postgresql --no-pager | head -5 && \
systemctl status ollama --no-pager | head -5 && \
cd ~/Trading\ Project/worldmonitor && nohup npm run dev > /tmp/worldmonitor.log 2>&1 & \
cd ~/Trading\ Project/deepseek-ui && nohup npm run dev:all > /tmp/trading-dashboard.log 2>&1 &
```

---

## 📋 Step-by-Step Commands

### 1️⃣ PostgreSQL (Database)
```bash
# Check if running
systemctl status postgresql --no-pager

# Start if needed
sudo systemctl start postgresql

# Verify connection
pg_isready -h localhost -p 5432
```

### 2️⃣ Ollama LLM (AI Model)
```bash
# Check if running
systemctl status ollama --no-pager

# Start if needed
sudo systemctl start ollama

# Verify model is loaded
curl -s http://localhost:11434/api/ps

# Load DeepSeek model into memory (keeps it warm)
curl -X POST http://localhost:11434/api/generate \
  -d '{"model":"deepseek-r1:14b","keep_alive":-1,"prompt":""}'
```

### 3️⃣ World Monitor (Global Market Data)
```bash
cd ~/Trading\ Project/worldmonitor

# Install dependencies (first time only)
npm install

# Start in background
nohup npm run dev > /tmp/worldmonitor.log 2>&1 &

# Check logs
tail -f /tmp/worldmonitor.log
```

### 4️⃣ AI Trading Dashboard + WebSocket
```bash
cd ~/Trading\ Project/deepseek-ui

# Start both Next.js and WebSocket server
nohup npm run dev:all > /tmp/trading-dashboard.log 2>&1 &

# Check logs
tail -f /tmp/trading-dashboard.log
```

### 5️⃣ Sync Database (if needed)
```bash
cd ~/Trading\ Project/deepseek-ui
npx prisma db push
```

---

## ✅ Verify Everything is Running

```bash
echo "=== SYSTEM STATUS ===" && \
pg_isready -h localhost -p 5432 && echo "✅ PostgreSQL" && \
curl -s http://localhost:11434/api/ps | jq -r '.models[0].name' && echo "✅ Ollama" && \
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001 && echo "✅ Dashboard" && \
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000 && echo "✅ World Monitor" && \
ss -tlnp | grep ":3002" && echo "✅ WebSocket"
```

---

## 🌐 Access URLs

| Service | URL |
|---------|-----|
| 📊 Trading Dashboard | http://localhost:3001 |
| 🌍 World Monitor | http://localhost:3000 |
| 🤖 Ollama API | http://localhost:11434 |
| 🔌 WebSocket | ws://localhost:3002 |
| 🗄️ PostgreSQL | localhost:5432 |

---

## 🛑 Stop All Services

```bash
# Stop app processes
pkill -f "next dev"
pkill -f "vite"
pkill -f "node.*websocket"

# Check what's still running
ss -tlnp | grep -E "3000|3001|3002"
```

---

## 📊 Service Ports Reference

| Port | Service |
|------|---------|
| 3000 | World Monitor (Vite) |
| 3001 | Trading Dashboard (Next.js) |
| 3002 | WebSocket Server |
| 5432 | PostgreSQL |
| 11434 | Ollama LLM |

---

## 🔧 Troubleshooting

### PostgreSQL won't start
```bash
sudo systemctl restart postgresql
journalctl -u postgresql -n 50
```

### Ollama model not loaded
```bash
ollama list
ollama run deepseek-r1:14b
```

### World Monitor dependencies missing
```bash
cd ~/Trading\ Project/worldmonitor
rm -rf node_modules
npm install
```

### Dashboard not starting
```bash
cd ~/Trading\ Project/deepseek-ui
npm install
npx prisma generate
npm run dev:all
```

---

*Last updated: April 2026*
