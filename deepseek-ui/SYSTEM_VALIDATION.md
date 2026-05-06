# System Readiness Validation

Run this after restarting the app to verify all major features.

## Command

```bash
cd /home/aiserver/Trading\ Project/deepseek-ui
npm run validate:system
```

## What it checks

- Core health: database, IB, Ollama, World Monitor
- Trading engine status
- Activity feed endpoint
- Notifications endpoint
- Analytics endpoint
- Portfolio history endpoint + snapshot count
- Market intelligence endpoint
- World Monitor health + news endpoints
- AI chat endpoint
- AI trading analysis endpoint

## Logs

Each run writes a timestamped log:

```text
logs/validation/system-validation-YYYYMMDD-HHMMSS.log
```

## Result codes

- `RESULT: PASS` => all checks passed
- `RESULT: WARN` => non-critical warnings only
- `RESULT: FAIL` => one or more critical checks failed

## Optional base URL override

```bash
BASE_URL=http://localhost:3001 npm run validate:system
```

