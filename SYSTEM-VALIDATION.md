# System Validation Checklist

Run these checks in order to confirm all services are healthy before trading.

---

## 1. Docker Containers

All four containers must be running.

```bash
sudo docker compose ps
```

**Expected output — all should show `running` or `Up`:**

```
NAME                STATUS
trading-postgres    Up (healthy)
trading-nextjs      Up (healthy)
trading-bot         Up
websocket           Up
```

**If a container is down:**
```bash
sudo docker compose up -d
```

**If containers need a full rebuild (after code changes):**
```bash
sudo docker compose up -d --build nextjs
```

---

## 2. Database (PostgreSQL)

```bash
curl -s http://localhost:3001/api/health | python3 -m json.tool | grep -A3 '"database"'
```

**Healthy:**
```json
"database": {
  "status": "ok",
  "latencyMs": 5
}
```

**If down:** Database container is not running. Run `sudo docker compose up -d postgres` and wait 10 seconds.

---

## 3. Interactive Brokers (IB Service)

```bash
curl -s http://localhost:8765/health | python3 -m json.tool
```

**Healthy:**
```json
{
  "connected": true,
  "accounts": ["DUP652572"]
}
```

**If disconnected:**
- Open TWS or IB Gateway on this machine and log in
- Make sure API is enabled: Configure → API → Settings → Enable ActiveX and Socket Clients
- Port 7497 = Paper trading, 7496 = Live trading

---

## 4. DeepSeek AI (Ollama)

```bash
curl -s http://172.17.0.1:11500/api/tags | python3 -m json.tool
```

**Healthy:**
```json
{
  "models": [
    { "name": "deepseek-r1:14b" }
  ]
}
```

**Check Ollama process:**
```bash
ps aux | grep ollama | grep -v grep
```

**If Ollama is not running:**
```bash
/home/aiserver/.local/bin/ollama serve &
```

**If model is missing:**
```bash
/home/aiserver/.local/bin/ollama pull deepseek-r1:14b
```

---

## 5. Trading Bot

**Check bot process is running:**
```bash
ps aux | grep "trading-bot" | grep -v grep
```

**Check bot is actively running (look for recent market checks):**
```bash
cd ~/Trading\ Project/deepseek-ui && node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb' });
pool.query('SELECT message, \"createdAt\" FROM \"ActivityLog\" ORDER BY \"createdAt\" DESC LIMIT 5')
  .then(r => { r.rows.forEach(row => console.log(row.createdAt.toISOString(), row.message)); pool.end(); });
"
```

**Healthy:** Logs from within the last 2–3 minutes showing `Checking markets for X pairs...`

**If bot is not running:**
```bash
sudo docker compose up -d trading-bot
```

---

## 6. WebSocket Server

```bash
curl -s http://localhost:3002/ 2>/dev/null && echo "WebSocket up" || echo "WebSocket down"
```

Or check the dashboard — top left shows **Live** with a green dot when connected.

**If down:**
```bash
sudo docker compose up -d websocket
```

---

## 7. World Monitor

```bash
curl -s http://localhost:3001/api/worldmonitor/health | python3 -m json.tool | grep -A3 '"connected"'
```

**Healthy:**
```json
{
  "connected": true
}
```

**Note:** World Monitor is optional — the bot trades without it. It just adds global news context to AI analysis.

---

## 8. Dashboard (Full Health Endpoint)

One command to check all services at once:

```bash
curl -s http://localhost:3001/api/health | python3 -m json.tool
```

**Healthy response:**
```json
{
  "status": "ok",
  "services": {
    "database":    { "status": "ok" },
    "ib":          { "status": "ok", "connected": true },
    "ollama":      { "status": "ok", "models": ["deepseek-r1:14b"] },
    "worldmonitor":{ "status": "ok" }
  }
}
```

**Status meanings:**
| Value | Meaning |
|-------|---------|
| `ok` | Service is healthy |
| `error` | Service is reachable but returning errors |
| `unavailable` | Service cannot be reached |
| `degraded` | One or more non-critical services are down |

---

## 9. Open Positions

Check that any open trades are correctly tracked:

```bash
cd ~/Trading\ Project/deepseek-ui && node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb' });
pool.query('SELECT id, pair, type, \"entryPrice\", \"stopLoss\", \"takeProfit\", status, \"createdAt\" FROM \"Trade\" WHERE status = \$1', ['open'])
  .then(r => { console.log('Open trades:', r.rows.length); r.rows.forEach(row => console.log(JSON.stringify(row, null, 2))); pool.end(); });
"
```

---

## 10. Dashboard UI

Open in browser: **http://localhost:3001**

Check the Trading tab for:
- **Live** green dot (WebSocket connected)
- **Interactive Brokers Connected** (green)
- **World Monitor Connected** (blue)
- **AI Connected** (purple) with `deepseek-r1:14b` model shown

---

## Quick All-in-One Check

```bash
echo "=== Containers ===" && sudo docker compose ps --format "table {{.Name}}\t{{.Status}}" && \
echo "" && echo "=== Health API ===" && \
curl -s http://localhost:3001/api/health | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('Overall:', d['status'])
for name, svc in d['services'].items():
    icon = '✓' if svc['status'] == 'ok' else '✗'
    print(f'  {icon} {name}: {svc[\"status\"]} ({svc.get(\"latencyMs\",\"?\") }ms)')
" && \
echo "" && echo "=== Bot Activity ===" && \
cd ~/Trading\ Project/deepseek-ui && node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb' });
pool.query('SELECT \"createdAt\", message FROM \"ActivityLog\" ORDER BY \"createdAt\" DESC LIMIT 3')
  .then(r => { r.rows.forEach(row => console.log(' ', row.createdAt.toISOString(), row.message.substring(0,80))); pool.end(); });
"
```

---

## What Each Indicator Means on the Dashboard

| Indicator | Color | Means |
|-----------|-------|-------|
| Live | Green | WebSocket real-time feed is connected |
| Interactive Brokers Connected | Green | IB TWS/Gateway is online and authenticated |
| World Monitor Connected | Blue | Global news and market data feed is active |
| AI Connected | Purple | DeepSeek R1 model is loaded and responding |
| AI Offline | Red pulsing | Ollama is down — bot uses technicals only |

---

## After Code Changes — Rebuild Commands

| What changed | Command |
|---|---|
| Dashboard / UI components | `sudo docker compose up -d --build nextjs` |
| Trading bot logic | `sudo docker compose up -d --build trading-bot` |
| Both | `sudo docker compose up -d --build nextjs trading-bot` |
| Everything from scratch | `sudo docker compose up -d --build` |
