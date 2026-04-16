# QA Improvements Backlog

Generated: 2026-04-15  
Total items: 57  
Scope: Error handling, logging, config, testing, validation, DB, performance, state, code quality, deployment, market data, WebSocket, docs — **excludes security and AI features**.

---

## Error Handling & Resilience
- [x] 1. Standardize error response format across all API routes (no unified schema now)
- [x] 2. Add retry logic with exponential backoff for ib_service.py connections (currently fixed 10s delay)
- [x] 3. Add circuit breaker pattern to prevent cascading failures when IB goes down
- [x] 4. Consistent timeouts — currently 15s, 30s, 65s scattered randomly across different calls
- [x] 5. Stop silent failures in `savePriceCandles()` — fails with just `console.error`, no alerting

## Logging & Observability
- [x] 6. Replace all `console.log()` calls with a structured logger (winston/pino) — 68+ raw console calls in lib/ alone
- [x] 7. Add correlation IDs so you can trace a single trade request across all services
- [x] 8. Log rotation — ib_service.log is 300MB+, nextjs.log is 12MB+ with no rotation configured
- [x] 9. Add log levels (debug/info/warn/error) — currently everything is flat
- [x] 10. Stop logging every GET status poll — only log meaningful events (trades, errors, state changes)

## Configuration Management
- [x] 11. Create a complete `.env.local.example` with all variables, descriptions, and valid ranges
- [x] 12. Add startup validation — app should fail fast if required env vars or services are missing
- [x] 13. Multiple hardcoded `localhost` addresses in websocket server and other places — move to env vars
- [x] 14. Add a `/api/config/schema` debug endpoint (with secrets redacted) to inspect live config

## Testing
- [x] 15. trading-engine.ts is 1000+ lines with zero tests — needs unit tests for position sizing, signal logic, risk validation
- [x] 16. No tests for any API routes
- [x] 17. No integration or end-to-end tests for trading workflows
- [x] 18. No mocks for external services (IB, Ollama, Kraken) — tests would hit real services
- [x] 19. Set up CI pipeline to run tests on every commit

## Input Validation
- [x] 20. Add Zod schema validation to all POST endpoints — currently fields are loosely checked
- [x] 21. Bound all numerical config inputs (confidence must be 0–100, position size 0–10%, etc.)
- [x] 22. Validate stock symbol format before sending to IB
- [x] 23. Sanitize news headline content (max length, no script-like strings)

## Database & Persistence
- [x] 24. ActivityLog has no retention policy — will grow unboundedly, add 90-day cleanup
- [x] 25. Trade records never marked "closed" when stop-loss/take-profit hits — status stays stuck as "open"
- [x] 26. Add `@@index([createdAt, type])` and `@@index([pair, createdAt])` to ActivityLog for range queries
- [x] 27. Wrap trade + activity log writes in a `prisma.$transaction` — currently not atomic
- [x] 28. No backup strategy documented or automated

## Performance
- [x] 29. Fear & Greed Index fetched fresh every cycle — cache it for 1 hour (CNN rate-limits)
- [x] 30. IB balance fetched once per pair per cycle — should batch-fetch once and share
- [x] 31. OHLC bars fetched fresh every signal generation — cache for 5 minutes
- [x] 32. Prisma queries return all fields everywhere — add `select` to limit columns
- [x] 33. No pagination on ActivityLog API — will slow down as table grows
- [x] 34. WebSocket broadcasts full position/balance objects even if nothing changed

## State Management & Consistency
- [x] 35. `activePositions` in-memory Map is not rebuilt from DB on restart — crash = orphaned positions
- [x] 36. No mutex to prevent two engine instances running simultaneously
- [x] 37. Bot status (`isRunning`) in DB can diverge from actual running state after a crash
- [x] 38. No heartbeat to detect when the engine silently dies without throwing

## Code Quality
- [x] 39. Magic numbers scattered everywhere (75% confidence, 5% SL, 10% TP) — needs a `constants.ts`
- [x] 40. trading-engine.ts is too large — split into signal-generator, position-manager, risk-validator
- [x] 41. Duplicate error-handling boilerplate repeated in every API route — extract shared middleware
- [x] 42. No pre-commit hooks (husky) to enforce lint/typecheck before commits

## Deployment & Operations
- [x] 43. No graceful shutdown — `SIGTERM` doesn't cleanly close DB connections or open positions
- [x] 44. No systemd unit files — services aren't auto-restarted on crash (only an example file exists)
- [x] 45. No `/api/health` endpoint to check all dependencies (DB, IB, Ollama) at once
- [x] 46. No Dockerfile or docker-compose — can't reproduce environment reliably
- [x] 47. No alerting if bot crashes or balance drops unexpectedly

## Market Data
- [x] 48. No US market holiday calendar — bot will try to trade on Good Friday, Thanksgiving, etc.
- [x] 49. No fallback data source if IB is down (no Yahoo Finance or similar backup)
- [x] 50. No OHLC data quality validation — doesn't detect gaps, bad bars, or extreme outliers
- [x] 51. Puppeteer for news scraping is heavy and fragile — consider a lightweight news API instead

## WebSocket / Real-time
- [x] 52. No delta updates — broadcasts entire objects even when one field changes
- [x] 53. No client-side reconnection logic with backoff
- [x] 54. No WebSocket compression enabled
- [x] 55. No per-symbol subscriptions — broadcasts all prices to all clients regardless of watchlist

## Documentation
- [x] 56. Three overlapping startup guides (STARTUP_GUIDE.md, STARTUP_README.md, STARTSYSTEM.md) — consolidate into one
- [x] 57. No troubleshooting runbook for common failures (IB disconnect, bot crash, DB recovery)
- [x] 58. No architecture diagram showing how all services connect
- [x] 59. No API documentation for the Next.js routes (ib_service.py has Swagger but Next.js routes are undocumented)

---

## Priority Tiers

### Quick Wins (1–2 hours each)
- #39 — Create `constants.ts` for magic numbers
- #11 — Create `.env.local.example` with all variables
- #48 — Add US market holiday calendar
- #45 — Add `/api/health` endpoint
- #56 — Consolidate startup guides
- #8  — Configure logrotate
- #43 — Add graceful shutdown (`SIGTERM` handler)

### Medium Effort (1–3 days, high impact)
- #1–5   — Standardize error handling + retry logic
- #15–19 — Add test suite for trading-engine.ts and API routes
- #20–23 — Add Zod validation to all POST endpoints
- #35    — Reconstruct `activePositions` from DB on startup
- #36–38 — Add mutex, heartbeat, and state sync
- #29–31 — Add caching layer for market data

### Larger Effort (1+ week)
- #40 — Split trading-engine.ts into focused modules
- #6–10 — Full structured logging overhaul
- #46 — Dockerize the full stack
- #44 — Full systemd service setup with auto-restart
