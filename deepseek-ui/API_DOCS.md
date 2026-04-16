# Trading Bot — Next.js API Documentation

Base URL: `http://localhost:3001`

All responses are JSON. Errors follow `{ success: false, error: string, code: string }`.

---

## System

### `GET /api/health`
Returns health status of all critical dependencies.

**Response `200` (all ok):**
```json
{
  "status": "ok",
  "services": {
    "database":    { "status": "ok", "latencyMs": 3 },
    "ib":          { "status": "ok", "latencyMs": 45, "connected": true, "accounts": ["DU12345"] },
    "ollama":      { "status": "ok", "latencyMs": 120, "modelCount": 2 },
    "worldmonitor":{ "status": "unavailable", "latencyMs": 5000 }
  },
  "timestamp": "2026-04-15T14:23:00.000Z",
  "uptime": 12345.6
}
```
**Response `503`** if any critical service (DB or IB) is down.

---

### `GET /api/config/schema`
Returns current runtime config with secrets redacted. Non-production only (unless `ENABLE_CONFIG_SCHEMA=1`).

```json
{
  "success": true,
  "environment": "development",
  "effectiveLogLevel": "info",
  "config": [
    { "key": "DATABASE_URL", "value": "postgresql://***@localhost:5432/*** (redacted)", "isSet": true, "default": "...", "description": "..." }
  ]
}
```

---

## Trading Engine

### `GET /api/trading/engine`
Returns bot running status and recent activities.

```json
{
  "success": true,
  "status": {
    "isRunning": true,
    "config": { "pairs": ["AAPL","MSFT"], "minConfidence": 75, "autoExecute": true },
    "activePositions": 2,
    "lastHeartbeatAt": 1713186180000,
    "secondsSinceHeartbeat": 45
  },
  "activities": [
    { "id": "1713186180-0.123", "timestamp": 1713186180000, "type": "info", "message": "..." }
  ]
}
```

### `POST /api/trading/engine`
Start or stop the trading engine.

**Body:**
```json
{ "action": "start", "config": { "pairs": ["AAPL","MSFT"], "minConfidence": 75, "autoExecute": false } }
{ "action": "stop" }
```

**`action`**: `"start"` | `"stop"` | `"restart"`

**Config fields (all optional):**
| Field | Type | Range | Default |
|---|---|---|---|
| `pairs` | `string[]` | 1–20 symbols | `["AAPL","MSFT","NVDA","TSLA","GOOGL","AMZN","META","AMD"]` |
| `minConfidence` | `number` | 0–100 | 75 |
| `maxPositions` | `number` | 1–50 | 6 |
| `riskPerTrade` | `number` | 0.001–0.5 | 0.10 |
| `stopLossPercent` | `number` | 0.001–0.5 | 0.05 |
| `takeProfitPercent` | `number` | 0.001–2.0 | 0.10 |
| `checkInterval` | `number` | 30000–3600000 (ms) | 120000 |
| `autoExecute` | `boolean` | — | `false` |
| `tradeCooldownHours` | `number` | 0–168 | 1 |
| `maxDailyTrades` | `number` | 0–200 | 30 |

---

### `GET /api/trading/activities`
Paginated activity log.

**Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Rows per page (max 200) |
| `type` | string | — | Filter by type: `info|error|warning|completed|analyzing|...` |
| `pair` | string | — | Filter by trading pair |
| `since` | ISO date | — | Only return rows after this date |

**Response:**
```json
{
  "success": true,
  "activities": [{ "id": 1, "createdAt": "2026-04-15T14:00:00Z", "type": "completed", "message": "...", "pair": "AAPL" }],
  "pagination": { "page": 1, "limit": 50, "total": 423, "totalPages": 9, "hasNextPage": true }
}
```

---

### `POST /api/trading/analyze`
Run AI sentiment analysis on a trading pair.

**Body:**
```json
{
  "pair": "AAPL",
  "news": [{ "title": "Apple reports earnings...", "description": "...", "source": "Reuters", "pubDate": "..." }],
  "marketData": { "AAPL": { "price": "175.50", "volume": "52000000", "change24h": "1.23" } },
  "assetType": "stock",
  "technicals": { "rsi": 45, "rsiSignal": "neutral", "macd": "bullish" }
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "sentiment": "Bullish",
    "confidence": 78,
    "signal": "BUY",
    "keyFactors": ["RSI oversold", "Positive earnings momentum"],
    "risks": ["Market uncertainty"],
    "recommendation": "Consider buying at current levels with tight stop..."
  }
}
```

---

## Interactive Brokers

### `GET /api/ib/health`
Check IB service connectivity.

### `GET /api/ib/balance`
Get account balance and positions.

### `GET /api/ib/ohlc?symbol=AAPL&barSize=1+day&duration=3+M`
Get OHLCV data (IB → Yahoo Finance fallback).

### `GET /api/ib/market-status`
Current US equity market session.

---

## Stocks

### `GET /api/stocks/ticker?symbols=AAPL,MSFT,NVDA`
Fetch stock prices (IB → Yahoo Finance fallback). 10-second client-side cache.

**Query params:**
- `symbols` (required): comma-separated list of 1–10 character ticker symbols

**Response:**
```json
{
  "success": true,
  "data": {
    "AAPL": { "symbol": "AAPL", "price": 175.50, "bid": 175.49, "ask": 175.51, "volume": 52000000, "source": "ib" }
  },
  "count": 1,
  "cached": false
}
```

---

## Notifications

### `GET /api/notifications`
Fetch recent notifications (last 50).

### `POST /api/notifications`
Create or update notifications.

**Create:**
```json
{ "type": "trade_executed", "title": "BUY AAPL", "message": "10 shares at $175.50", "pair": "AAPL" }
```

**Mark all read:**
```json
{ "action": "markAllRead" }
```

**Mark one read:**
```json
{ "action": "markRead", "id": 42 }
```

---

## Portfolio

### `GET /api/portfolio/history?days=30&limit=100`
Fetch portfolio value history.

### `POST /api/portfolio/snapshot`
Manually trigger a portfolio snapshot.

---

## Chat

### `POST /api/chat`
Send a message to the AI assistant with full market context.

**Body:**
```json
{
  "messages": [{ "role": "user", "content": "What do you think about AAPL right now?" }],
  "model": "deepseek-r1:14b",
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**Query param:** `?stream=true` for SSE streaming response.

---

## World Monitor

### `GET /api/worldmonitor/health`
Check World Monitor service connectivity.

### `GET /api/worldmonitor/data?category=markets`
Fetch geopolitical and market data from World Monitor.

### `GET /api/worldmonitor/news?category=markets&limit=10`
Fetch news headlines from World Monitor.
