# Fixes & Changes Log

## 1. Trading Bot Disabled (Kraken Auto-Trading)

**Problem:** The bot was automatically starting on every server boot and placing real buy/sell orders on Kraken, wasting money.

**Root Cause:** `app/api/trading/engine/route.ts` had an auto-start block at module level that ran `engineInstance.start()` every time the Next.js server booted, even with `autoExecute: false`.

**Fixes Applied:**
- Removed the auto-start block entirely from `route.ts`
- Blocked the `start` action — now returns HTTP 403 with a clear error message
- Bot will not run until manually re-enabled in source code

**Files Changed:**
- `deepseek-ui/app/api/trading/engine/route.ts`

---

## 2. Interactive Brokers Integration

**New files created to replace Kraken with IB paper trading:**

| File | Purpose |
|---|---|
| `ib_service.py` | Python FastAPI service wrapping `ib_insync` |
| `deepseek-ui/lib/ib-client.ts` | TypeScript client for Next.js to call the service |
| `deepseek-ui/app/api/ib/balance/route.ts` | GET account balance + open positions |
| `deepseek-ui/app/api/ib/ticker/route.ts` | GET live price snapshot |
| `deepseek-ui/app/api/ib/ohlc/route.ts` | GET historical OHLCV bars |
| `deepseek-ui/app/api/ib/orders/route.ts` | GET/POST/DELETE orders |

**Dependencies installed:**
```
pip install ib_insync fastapi uvicorn
```

**`.env.local` updated:**
```
IB_SERVICE_URL=http://localhost:8765
```

---

## 3. IB Service Bug Fixes

### Bug 1 — asyncio event loop conflict
**Problem:** `ib_insync` and `uvicorn` use separate event loops. Calling `ib.connectAsync()` inside uvicorn's lifespan caused:
```
RuntimeError: Task got Future attached to a different loop
```
**Fix:** Run `ib_insync` in its own background thread with its own dedicated event loop (`asyncio.new_event_loop()`). FastAPI endpoints communicate with it via `asyncio.run_coroutine_threadsafe()`.

### Bug 2 — Wrong client ID
**Problem:** IB client ID `1` is reserved by TWS internally, causing silent connection failure.
**Fix:** Changed default `IB_CLIENT` from `1` → `10`.

### Bug 3 — `nan` values breaking JSON
**Problem:** IB returns `float('nan')` for ticker fields outside market hours, which crashes Python's `json.dumps()`.
**Fix:** Added `_safe()` helper that converts `nan`/`inf` → `None` before serializing.

### Bug 4 — IB operations called on wrong event loop
**Problem:** `ib.reqMktData()`, `ib.cancelMktData()`, `ib.qualifyContractsAsync()`, and `ib.whatIfOrderAsync()` were called on uvicorn's event loop instead of the IB thread's loop, causing unpredictable failures.
**Fix:** Wrapped all IB operations inside `async def _fetch()` / `async def _execute()` closures that run via `_ib()` on the IB thread's loop.

### Bug 5 — Historical data timeout
**Problem:** `reqHistoricalDataAsync` can take up to 60 seconds. The default timeout of 30s caused `TimeoutError`.
**Fix:** Increased OHLC request timeout to `65` seconds.

### Bug 6 — No data outside market hours
**Problem:** `useRTH=True` (Regular Trading Hours only) caused IB to return no data when called after market close.
**Fix:** Changed to `useRTH=False` to include pre/post market data.

---

## How to Start the IB Service

```bash
# TWS must be running on port 7497 (paper) with API enabled
cd ~/Trading\ Project
python ib_service.py
```

**TWS API Settings:**
- `Edit → Global Configuration → API → Settings`
- Enable: ActiveX and Socket Clients
- Port: `7497` (paper) / `7496` (live ⚠️ real money)
- Uncheck: Read-Only API

**Test endpoints:**
```bash
curl http://localhost:8765/health
curl http://localhost:8765/balance
curl "http://localhost:8765/ohlc/AAPL?bar_size=1+day&duration=5+D"
curl "http://localhost:8765/ticker/AAPL"
```

**API Docs (interactive):** http://localhost:8765/docs

---

## Safety Notes

- All orders default to `validate_only: true` (dry-run) — no real orders sent
- To place a real order you must explicitly pass `"validate_only": false`
- The Kraken bot remains **disabled** until manually re-enabled in source code
- Paper trading account: `DUP652572` ($1,000,000 CAD)
