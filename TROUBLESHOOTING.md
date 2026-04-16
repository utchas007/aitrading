# Trading Bot — Troubleshooting Runbook

Common failures and how to resolve them.

---

## IB Service Issues

### "IB service circuit breaker is OPEN"

The trading bot has detected 3+ consecutive IB connection failures.

**Check IB status:**
```bash
curl http://localhost:8765/health | jq
```

**Common causes:**
1. **TWS/Gateway not running** — Open TWS, log in with your paper account
2. **Wrong port** — Check `IB_PORT` in env (7497 = paper TWS, 7496 = live TWS)
3. **API not enabled in TWS** — Go to Configure → API → Settings → Enable ActiveX
4. **Wrong clientId** — Another app is using the same `IB_CLIENT` value

**Restart IB service after fixing:**
```bash
sudo systemctl restart ib-service
# or
python3 ib_service.py
```

---

### "No price data / IB returning empty ticker"

Paper accounts need a live data subscription for real-time quotes.

**Workaround:** The system automatically falls back to Yahoo Finance for prices.
Check if Yahoo fallback is working:
```bash
curl "http://localhost:3001/api/stocks/ticker?symbols=AAPL" | jq '.data.AAPL'
```

---

## Bot Issues

### "Bot shows as running but no trades are happening"

1. **Check confidence threshold** — Default is 75%. Most signals during sideways markets won't cross this.
2. **Check VIX** — If VIX > 35, trading is blocked (`vix.tradingAllowed = false`)
3. **Check SPY trend** — BUY signals are blocked during SPY downtrend
4. **Check earnings** — Stocks with earnings within 2 days are blocked
5. **Check volume** — Signals are rejected if volume < 1.3× average
6. **Insufficient data** — Pair needs 50+ historical bars

**Inspect the Activity Feed** on the dashboard for specific rejection reasons.

---

### "Bot crashed / status shows stopped unexpectedly"

```bash
# Check logs
tail -100 /home/aiserver/Trading\ Project/trading-bot.log

# Restart
sudo systemctl restart trading-bot
```

**If IB bracket orders are still open (they should be!):**
```bash
curl http://localhost:8765/positions | jq
```
All native IB SL/TP orders survive bot restarts — IB manages them independently.

---

### "Engine shows isRunning=true but no logs"

The heartbeat monitor will log a warning after 2× the check interval with no activity.
Check if the interval timer fired:
```bash
tail -50 /home/aiserver/Trading\ Project/trading-bot.log | grep "heartbeat"
```

---

## Database Issues

### "DATABASE_URL connection refused"

```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Start if stopped
sudo systemctl start postgresql

# Verify access
psql -h localhost -U tradingbot -d tradingdb -c "SELECT 1"
```

---

### "Prisma migration errors on startup"

```bash
cd deepseek-ui
npx prisma migrate deploy
npx prisma generate
```

---

### "ActivityLog table is huge / slow"

The retention cleanup runs daily (default: delete rows older than 90 days).
To run manually:
```sql
DELETE FROM "ActivityLog" WHERE "createdAt" < NOW() - INTERVAL '90 days';
```

Or lower the retention period:
```bash
# In .env.local
ACTIVITY_LOG_RETENTION_DAYS=30
```

---

## AI / Ollama Issues

### "AI analysis not available / falling back to technicals only"

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags | jq '.models[].name'

# Pull model if missing
ollama pull deepseek-r1:14b

# Check if model is loaded in memory
curl http://localhost:11434/api/ps | jq
```

---

### "AI analysis times out"

The model is too slow for the hardware or isn't loaded into VRAM.

```bash
# Warm the model (keeps it in RAM between calls)
curl -X POST http://localhost:11434/api/generate \
  -d '{"model":"deepseek-r1:14b","keep_alive":-1,"prompt":""}'
```

---

## Performance Issues

### "Dashboard loads slowly"

1. **Check log volume** — If `ib_service.log` is > 100MB, rotate it:
   ```bash
   sudo logrotate -f /etc/logrotate.d/trading-bot
   ```

2. **Check DB query time** — Large ActivityLog table:
   ```bash
   cd deepseek-ui && npx prisma studio
   # Check ActivityLog row count
   ```

3. **Enable LOG_LEVEL=warn** — Reduces logging overhead:
   ```bash
   # In .env.local
   LOG_LEVEL=warn
   ```

---

### "WebSocket connection drops frequently"

```bash
# Check WS server status
sudo systemctl status websocket-server

# Check logs
tail -50 /home/aiserver/Trading\ Project/websocket-server.log
```

Socket.IO has automatic client-side reconnection with exponential backoff built in.
If the server is restarting frequently, check for crashes:
```bash
journalctl -u websocket-server --since "1 hour ago"
```

---

## Recovery Procedure

### Full recovery from backup

```bash
# 1. Restore DB
./scripts/restore-db.sh backups/tradingdb_YYYYMMDD_HHMMSS.sql.gz

# 2. Apply any pending migrations
cd deepseek-ui && npx prisma migrate deploy

# 3. Restart all services
sudo systemctl restart ib-service nextjs websocket-server trading-bot

# 4. Verify
curl http://localhost:3001/api/health | jq
```

---

## Useful Diagnostic Commands

```bash
# All-services health check
curl http://localhost:3001/api/health | jq

# Config validation (secrets redacted)
curl http://localhost:3001/api/config/schema | jq

# Bot engine status
curl http://localhost:3001/api/trading/engine | jq '.status'

# IB positions
curl http://localhost:8765/positions | jq

# Recent activity log
curl "http://localhost:3001/api/trading/activities?limit=20" | jq '.activities[].message'

# DB connection check
cd deepseek-ui && node -e "const {prisma}=require('./lib/db');prisma.\$queryRaw\`SELECT 1\`.then(()=>console.log('DB OK'))"
```
