# Trading Project — Improvement Tracker

Work through these one by one. Check off each item as it is completed.

---

## Critical Bugs (Money at Risk)

- [x] **#1 — SL/TP as native IB bracket orders**  
  SL/TP are tracked in JavaScript memory only. Submit real IB bracket/attached orders via `ib_service.py` so exits survive process restarts.  
  _Files: `ib_service.py`, `deepseek-ui/lib/trading-engine.ts`, `deepseek-ui/lib/ib-client.ts`_

- [x] **#2 — Position recovery on restart**  
  `activePositions` Map is never re-populated from the DB on startup. Open trades with `status: open` are orphaned after any restart.  
  _Files: `deepseek-ui/lib/trading-engine.ts`, `deepseek-ui/app/api/trading/engine/route.ts`_

- [x] **#3 — `autoExecute` defaults to `true` on restart**  
  Bot restarts with live trading enabled after any Next.js HMR/restart without user action.  
  _Files: `deepseek-ui/app/api/trading/engine/route.ts`_

- [x] **#4 — Unrealized P&L always shows 0** _(not a real bug)_  
  Investigated: the ticker API route maps IB's `last` → `price` before WebSocket broadcast. `PriceData.price` is correct. No fix needed.  
  _Files: `deepseek-ui/components/trading-dashboard.tsx`_

---

## High Priority (Correctness)

- [x] **#5 — Hardcoded World Monitor IP**  
  `192.168.2.232:3000` hardcoded in trading engine. Move to `WORLDMONITOR_URL` env var.  
  _Files: `deepseek-ui/lib/trading-engine.ts`_

- [x] **#6 — MACD O(n²) bug**  
  Signal line recalculates full EMAs from scratch on every iteration — slow and slightly inaccurate. Rewrite with incremental EMA state.  
  _Files: `deepseek-ui/lib/technical-indicators.ts`_

- [x] **#7 — Short position trailing stop bug**  
  `highestPrice` used for short-side trailing stop; should be `lowestPrice`. Trailing stops on shorts won't trigger correctly.  
  _Files: `deepseek-ui/lib/risk-management.ts`_

- [x] **#8 — `savePortfolioSnapshot()` calls Kraken**  
  Portfolio snapshot calls a leftover Kraken route. Portfolio history chart is broken for IB-only users.  
  _Files: `deepseek-ui/lib/trading-engine.ts`, `deepseek-ui/app/api/portfolio/snapshot/route.ts`_

- [x] **#9 — DeepSeek `<think>` block corrupts JSON extraction**  
  Regex `/{[\s\S]*}/` can match inside `<think>...</think>` reasoning blocks. Strip think blocks before JSON parsing.  
  _Files: `deepseek-ui/app/api/trading/analyze/route.ts`_

- [x] **#10 — No US market holiday calendar**  
  Bot only checks weekends; will attempt to trade on Good Friday, Thanksgiving, Christmas, etc.  
  _Files: `deepseek-ui/lib/market-hours.ts`_

---

## Medium Priority (Reliability)

- [x] **#11 — IB balance fetched once per pair per cycle**  
  `generateSignal()` refetches balance on every pair. Should fetch once at top of `checkMarkets()`.  
  _Files: `deepseek-ui/lib/trading-engine.ts`_

- [x] **#12 — `stock-selector.tsx` overwrites risk params**  
  `applyChanges()` hardcodes `riskPerTrade: 0.10`, silently resetting your risk config on every stock selection change.  
  _Files: `deepseek-ui/components/stock-selector.tsx`_

- [x] **#13 — Ollama URL hardcoded**  
  `http://localhost:11434` hardcoded in analyze route. Should use `process.env.OLLAMA_API_URL`.  
  _Files: `deepseek-ui/app/api/trading/analyze/route.ts`_

- [x] **#14 — No IB auth on Python service**  
  `ib_service.py` has no authentication — anyone on the LAN can place real orders via HTTP. Add shared API key header.  
  _Files: `ib_service.py`, `deepseek-ui/lib/ib-client.ts`_

- [x] **#15 — Prisma schema still has Kraken fields**  
  `PortfolioSnapshot` model has crypto balance fields; no USD equity field for IB.  
  _Files: `deepseek-ui/prisma/schema.prisma`_

- [x] **#16 — Two bot instances can run simultaneously**  
  In-process engine and standalone bot can both run at once with no mutex, causing duplicate orders.  
  _Files: `deepseek-ui/app/api/trading/engine/route.ts`_

- [x] **#17 — `updatePositions()` skips after-hours** _(fixed as part of #2)_  
  The `isOpen` guard was removed from the 30s position update interval in #2. Loop now runs 24/7.  
  _Files: `deepseek-ui/lib/trading-engine.ts`_

- [x] **#18 — No retry logic in `ib-client.ts`**  
  Transient network failures between Next.js and `ib_service.py` silently fail with no retry.  
  _Files: `deepseek-ui/lib/ib-client.ts`_

---

## Low Priority / UX

- [x] **#19 — Dead state/code in trading dashboard**  
  `openOrders`, `tradeAmount`, `executing`, `analyzeSignal` are unused state/code. Clean up.  
  _Files: `deepseek-ui/components/trading-dashboard.tsx`_

- [x] **#20 — Order management UI missing**  
  No UI to view or cancel open IB orders. `openOrders` state exists but is never wired.  
  _Files: `deepseek-ui/components/trading-dashboard.tsx`_

- [x] **#21 — WebSocket watchlist not dynamic**  
  8-symbol watchlist hardcoded in `websocket-server.ts`; adding a stock to the bot won't add it to live price feeds.  
  _Files: `deepseek-ui/websocket-server.ts`_

- [x] **#22 — `alert()` in stock selector**  
  Browser `alert()` used for validation errors. Replace with inline UI feedback.  
  _Files: `deepseek-ui/components/stock-selector.tsx`_

- [x] **#23 — No loading skeletons in dashboard**  
  Layout shifts when data first arrives. Add skeleton loaders.  
  _Files: `deepseek-ui/components/trading-dashboard.tsx`_

- [x] **#24 — No unified toast/notification system**  
  Multiple components use `alert()` or `console.error`. Implement a toast/notification system.  
  _Files: `deepseek-ui/contexts/ToastContext.tsx`, `deepseek-ui/components/crypto-selector.tsx`, `deepseek-ui/app/layout.tsx`_

---

## Infrastructure / DevOps

- [x] **#25 — `npm run dev` used as production daemon**  
  `trading-bot.service` runs the dev server. Should build first and run `npm start`.  
  _Files: `trading-bot.service`_

- [x] **#26 — No `.env.example` file**  
  README references `cp .env.example .env.local` but the file doesn't exist.  
  _Files: Create `deepseek-ui/.env.example`_

- [x] **#27 — No test suite**  
  Zero test files. Add unit tests for `technical-indicators.ts`, `risk-management.ts`, and signal logic.  
  _Files: `deepseek-ui/__tests__/technical-indicators.test.ts`, `deepseek-ui/__tests__/risk-management.test.ts`, `deepseek-ui/vitest.config.ts`_

- [x] **#28 — No CI/CD pipeline**  
  No GitHub Actions, no linting on commit, no automated tests. Easy to introduce regressions.  
  _Files: `.github/workflows/ci.yml`_

- [x] **#29 — `start-all.sh` missing**  
  README references it but it doesn't exist. Create a proper startup script for all services.  
  _Files: Create `start-all.sh`_

---

## Progress

| Status | Count |
|--------|-------|
| Done | 29 / 29 |
| In Progress | 0 |
| Remaining | 0 |

_Last updated: 2026-04-07_
