# AI Trading Bot — Full System Flow

## Infrastructure

```
PostgreSQL (DB) → Next.js (API + UI) → Trading Bot → IB Service → TWS/IB Gateway
                                      ↑
                              World Monitor (news feeds)
                                      ↑
                              Ollama / DeepSeek R1 (AI)
                              WebSocket Server (live UI)
```

---

## 1. Startup
- Bot recovers any open positions from DB and cross-checks with IB
- If IB has shares but bot restarted → restores position with SL/TP order IDs intact
- If entry order never filled → cancels orphaned bracket orders, clean slate
- Heartbeat monitor starts — alerts if bot goes silent for 2× the check interval

---

## 2. Every 2 Minutes — Market Cycle

**Step 1 — Session check**
- Is market open? (regular, pre-market, after-hours, overnight)
- Weekend / holiday / 3:50–4AM break → skip entirely
- Extended hours → uses OVERNIGHT exchange routing, limit orders only

**Step 2 — IB health check**
- Ping IB service — if down, pause (don't stop)
- Auto-resumes the moment IB reconnects, no manual restart needed

**Step 3 — Fetch live prices**
- Pulls ticker price for every symbol in the watchlist (26 static + up to 5 AI-suggested)
- 2 second gap between each ticker to respect IB pacing limits
- Stale guard: if a symbol had a valid price before but returns nothing for 5+ minutes during market hours → logged as warning, skipped

**Step 4 — Account balance**
- Fetches available cash + net liquidation value from IB
- Updates daily drawdown tracker
- If today's losses exceed 2% of account → no new trades until tomorrow

**Step 5 — Signal generation (per symbol, 12s apart)**

For each symbol:
1. Pull 1-day historical OHLC bars from IB (50+ bars needed)
2. Calculate technicals: RSI, MACD, EMA, Bollinger Bands, ATR, StochRSI, OBV, Ichimoku
3. Pull 1-hour bars for multi-timeframe trend confirmation (+1 bullish, -1 bearish)
4. Fetch World Monitor context: news headlines, global indices, commodities, geopolitical risk
5. Send everything to DeepSeek R1 → get sentiment, signal, confidence %
6. Blend: 60% technicals + 40% AI = final confidence score
7. Run filters: VIX level, SPY trend, earnings proximity, volume confirmation, sector cap

**Step 6 — Trade decision**
- Confidence ≥ 75% + all filters pass → proceed to execute
- Cooldown check: same symbol can't be traded again within 1 hour
- Daily trade limit: max 30 trades per day
- Sector cap: max 2 open positions in the same sector

---

## 3. Trade Execution

1. Calculate position size: risk 10% of available cash, max 5% of account per position
2. ATR-based SL/TP: stop = price − ATR×1.5, target = price + ATR×2.0 (roughly 2:1 R/R)
3. Place IB bracket order:
   - Parent: limit buy at signal price + 0.5% slippage buffer
   - Child 1: stop-loss sell
   - Child 2: take-profit limit sell
   - Outside RTH flag set if extended hours
4. DB record created with entry price, SL, TP, order IDs
5. Notification sent to bell → `trade_executed`

---

## 4. Every 30 Seconds — Position Monitoring

For each open position:

**P&L update**
- Fetch live price from IB
- If no price (after hours) → fall back to last hourly historical close

**Partial profit lock (+5%)**
- Sells half the position at market
- Cancels full-size bracket, replaces with half-size OCA pair
- Stop on remaining half moves to entry +2.5% (guaranteed no loss after partial)

**Trailing stop (+7% activation)**
- Once price reaches +7%, trailing stop follows 3% below peak
- Ratchets up as price climbs (min 1 minute between ratchets)

**Time-based exit (5 days)**
- If position open 5+ days and P&L still under +1%
- Cancels ALL open orders for that symbol (by symbol name, not just stored IDs)
- Market sell → capital recycled for fresh opportunities

**Native bracket close detection**
- Checks IB positions every 30s
- If IB no longer holds shares → SL or TP fired
- Updates DB, sends `trade_closed` notification, logs P&L

---

## 5. Daily Maintenance

- Pre-market prep (30 min before open): gathers off-hours data for all symbols
- Activity log cleaned up after 90 days
- Notification log cleaned up after 30 days
- Daily trade counter and P&L reset at midnight

---

## 6. AI Watchlist Expansion (every 6 hours)

- Fetches latest World Monitor news headlines
- Sends to DeepSeek: "which US tickers are trending from these headlines?"
- Up to 5 new symbols added to watchlist for 24 hours
- Logged in activity panel as `🔭 AI watchlist update: added TICKER1, TICKER2`

---

## 7. Notifications & UI

- Every trade, disconnect, stop, or alert → saved to DB
- Notification bell polls every 10 seconds
- Dashboard updates live via WebSocket (prices, P&L, positions)
- Bot activity panel shows every decision with reasoning in real time
