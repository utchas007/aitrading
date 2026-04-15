# Startup Issues & How To Fix Them

Every known error you will see when starting this project on a new machine,
what causes it, and exactly how to fix it.

---

## 1. `pip: command not found` / `pip3: command not found`

**When:** Running `start-all.sh` for the first time on a new PC.

**Cause:** Ubuntu 24.04 ships Python without pip. `ensurepip` is also disabled.

**Fix:**
```bash
curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
python3 /tmp/get-pip.py --user --break-system-packages
~/.local/bin/pip install ib_insync fastapi uvicorn pytz --break-system-packages
```

---

## 2. `node not found`

**When:** Running `start-all.sh` on a new PC.

**Cause:** Node.js is not installed system-wide. We install it via nvm (no sudo needed).

**Fix:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
nvm install --lts
```

Then always run `start-all.sh` with:
```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
bash start-all.sh
```

---

## 3. PostgreSQL not installed / `pg_isready: command not found`

**When:** First startup on a new PC. `sudo apt install postgresql` requires a password.

**Cause:** No system PostgreSQL and no sudo access.

**Fix — install PostgreSQL to user directory (no sudo):**
```bash
# 1. Download deb packages
mkdir -p ~/pg-local/debs && cd ~/pg-local/debs
apt-get download postgresql-16 postgresql-client-16 postgresql-common libpq5 libpq-dev

# 2. Extract to local directory
mkdir -p ~/pg-local/root
for deb in *.deb; do dpkg -x "$deb" ~/pg-local/root/; done

# 3. Set env vars (add to ~/.bashrc to make permanent)
export PG_HOME=~/pg-local/root
export PATH="$PG_HOME/usr/lib/postgresql/16/bin:$PATH"
export LD_LIBRARY_PATH="$PG_HOME/usr/lib/x86_64-linux-gnu:$PG_HOME/usr/lib/postgresql/16/lib:${LD_LIBRARY_PATH:-}"

# 4. Initialize cluster
mkdir -p ~/pg-local/run
initdb -D ~/pg-local/data --username=postgres --auth=trust --encoding=UTF8

# 5. Point socket to writable directory
sed -i "s/#unix_socket_directories = '/var/run/postgresql'/unix_socket_directories = '/home/aiserver/pg-local/run'/" ~/pg-local/data/postgresql.conf

# 6. Start
pg_ctl -D ~/pg-local/data -l ~/pg-local/postgres.log start

# 7. Create user and database
psql -U postgres -c "CREATE USER tradingbot WITH PASSWORD 'tradingbot123';"
psql -U postgres -c "CREATE DATABASE tradingdb OWNER tradingbot;"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE tradingdb TO tradingbot;"

# 8. Allow TCP connections
echo "host tradingdb tradingbot 127.0.0.1/32 md5" >> ~/pg-local/data/pg_hba.conf
echo "local tradingdb tradingbot md5" >> ~/pg-local/data/pg_hba.conf
pg_ctl -D ~/pg-local/data reload
```

**Always start PostgreSQL before running start-all.sh:**
```bash
export PG_HOME=~/pg-local/root
export PATH="$PG_HOME/usr/lib/postgresql/16/bin:$PATH"
export LD_LIBRARY_PATH="$PG_HOME/usr/lib/x86_64-linux-gnu:$PG_HOME/usr/lib/postgresql/16/lib:${LD_LIBRARY_PATH:-}"
pg_ctl -D ~/pg-local/data -l ~/pg-local/postgres.log start
```

---

## 4. PostgreSQL `could not create lock file "/var/run/postgresql/.s.PGSQL.5432.lock"`

**When:** Starting PostgreSQL after extraction.

**Cause:** Default socket directory `/var/run/postgresql` doesn't exist and needs root to create.

**Fix:** Already handled in step 5 above — set `unix_socket_directories` to `~/pg-local/run`.

---

## 5. `prisma migrate status` shows migration not applied

**When:** After setting up DB with `prisma db push` instead of `prisma migrate deploy`.

**Cause:** `db push` syncs schema without recording migration history.

**Fix (one time only):**
```bash
cd ~/Trading\ Project/deepseek-ui
npx prisma migrate resolve --applied 20260317185555_init
```

Expected output: `Migration 20260317185555_init marked as applied.`

---

## 6. Ollama not installed

**When:** First startup on a new PC. System install script requires sudo.

**Fix — install binary to user directory:**
```bash
# Get latest release tag
TAG=$(curl -s https://api.github.com/repos/ollama/ollama/releases/latest | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")

# Download and extract
mkdir -p ~/.local/bin/ollama-install
curl -fsSL https://github.com/ollama/ollama/releases/download/$TAG/ollama-linux-amd64.tar.zst \
  -o /tmp/ollama.tar.zst
tar --use-compress-program=unzstd -xf /tmp/ollama.tar.zst -C ~/.local/bin/ollama-install/
cp ~/.local/bin/ollama-install/bin/ollama ~/.local/bin/ollama

# Start Ollama
mkdir -p ~/.ollama
OLLAMA_HOST=127.0.0.1:11434 ollama serve >> ~/ollama.log 2>&1 &
echo $! > ~/.ollama/ollama.pid

# Pull DeepSeek model (~8GB, takes several minutes)
ollama pull deepseek-r1:14b
```

---

## 7. `Error: listen EADDRINUSE: address already in use :::3002`

**When:** Starting WebSocket server when it's already running or port is stuck.

**Cause:** Previous process didn't terminate cleanly.

**Fix:**
```bash
fuser -k 3002/tcp
# Then restart via start-all.sh
```

---

## 8. `TypeError: Unknown file extension ".ts"` (WebSocket server)

**When:** WebSocket server fails to start on some machines.

**Cause:** `ts-node` not installed or wrong tsx version.

**Fix:**
```bash
cd ~/Trading\ Project/deepseek-ui
npm install tsx --save-dev
```
The `start-all.sh` script uses `npx tsx` which will use the local install.

---

## 9. `Failed to fetch historical prices for AAPL: TimeoutError`

**When:** Bot is running but market is closed.

**Cause:** IB doesn't stream real-time data outside market hours. Normal behaviour.

**This is NOT a bug.** The bot also logs:
```
[Engine] Market closed, next open in Xh. Skipping.
```
Data will flow once the US market opens Mon–Fri 9:30 AM ET.

---

## 10. `Error 10089: Requested market data requires additional subscription`

**When:** IB service log shows this for some symbols (e.g. AMD).

**Cause:** Paper trading account doesn't have live market data subscriptions for all symbols.
IB falls back to delayed data automatically.

**Impact:** Delayed prices (15 min delay). No action needed — the bot still works.
To fix properly: subscribe to market data in TWS → Account → Market Data Subscriptions.

---

## 11. `Error 300: Can't find EId with tickerId`

**When:** Seen in `ib_service.log` regularly.

**Cause:** IB internally cleans up ticker subscriptions between requests. Harmless race condition.

**Impact:** None — requests still succeed (HTTP 200 returned).

---

## 12. `[Yahoo] HTTP 429` (World Monitor)

**When:** World Monitor log shows 429 errors for some symbols (TASI, DFMGI, etc.).

**Cause:** Yahoo Finance rate limiting on Middle East/Gulf market symbols.
`WS_RELAY_URL` is not set so relay fallback is skipped.

**Impact:** Those specific global market indices won't update. Core US stocks unaffected.

**Fix (optional):** Set a relay URL in `worldmonitor/.env.local`:
```
WS_RELAY_URL=your_relay_url
```

---

## 13. `Trading analysis error: HeadersTimeoutError`

**When:** Seen in `nextjs.log` when bot is running.

**Cause:** A downstream fetch (IB, Yahoo, or World Monitor) timed out during analysis.
Usually happens when market is closed or a service is briefly slow.

**Impact:** That analysis cycle is skipped. Bot retries on next cycle automatically.

---

## 14. `unrealizedPnl` and `realizedPnl` saving as NULL in PortfolioSnapshot

**When:** Portfolio history shows no P&L values.

**Cause:** IB returns `UnrealizedPnL_CAD: "0.00"` which exists as a key so `??` fallback
never reaches USD/BASE, and `parseFloat("0.00") || null` converts zero to null.

**Status: FIXED** in `app/api/portfolio/snapshot/route.ts` — now uses `UnrealizedPnL_BASE` first.

---

## 15. `maxPositions` resets to old value after restart

**When:** Bot recovers from database BotState with a different maxPositions.

**Cause:** Saved config in BotState DB overrides code defaults on recovery.

**Fix:** Always restart the bot with an explicit config:
```bash
curl -s -X POST http://localhost:3001/api/trading/engine \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}'
sleep 2
curl -s -X POST http://localhost:3001/api/trading/engine \
  -H "Content-Type: application/json" \
  -d '{"action":"start","config":{"maxPositions":6}}'
```

---

## Full Clean Start (New PC Checklist)

```bash
# 1. Load nvm and local bin
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

# 2. Load PostgreSQL binaries
export PG_HOME=~/pg-local/root
export PATH="$PG_HOME/usr/lib/postgresql/16/bin:$PATH"
export LD_LIBRARY_PATH="$PG_HOME/usr/lib/x86_64-linux-gnu:$PG_HOME/usr/lib/postgresql/16/lib:${LD_LIBRARY_PATH:-}"

# 3. Start PostgreSQL
pg_ctl -D ~/pg-local/data -l ~/pg-local/postgres.log start

# 4. Start Ollama
OLLAMA_HOST=127.0.0.1:11434 ollama serve >> ~/ollama.log 2>&1 &

# 5. Start all trading services
cd ~/Trading\ Project && bash start-all.sh

# 6. Verify everything
bash start-all.sh --status
nc -z localhost 5432 && echo "PostgreSQL OK"
curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; print('Ollama OK:', [m['name'] for m in json.load(sys.stdin)['models']])"
```

---

## Port Reference

| Port | Service |
|------|---------|
| 3001 | Next.js Dashboard |
| 3002 | WebSocket Server |
| 3000 | World Monitor |
| 5432 | PostgreSQL |
| 8765 | IB Service |
| 11434 | Ollama |
| 7497 | TWS Paper Trading |
| 7496 | TWS Live Trading |

---

*Last updated: 2026-04-15*
