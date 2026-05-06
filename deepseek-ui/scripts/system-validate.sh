#!/usr/bin/env bash
set -u

BASE_URL="${BASE_URL:-http://localhost:3001}"
OUT_DIR="${OUT_DIR:-./logs/validation}"
RUN_ID="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="${OUT_DIR}/system-validation-${RUN_ID}.log"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

mkdir -p "${OUT_DIR}"

log() {
  local msg="$1"
  echo "$msg" | tee -a "$LOG_FILE"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  log "PASS  $1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  log "WARN  $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  log "FAIL  $1"
}

section() {
  log ""
  log "=== $1 ==="
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

check_http_json() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local timeout="${4:-45}"
  local tmp_body
  tmp_body="$(mktemp)"
  local status

  if [[ -n "$data" ]]; then
    status="$(curl -sS -m "$timeout" -o "$tmp_body" -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      --data "$data" \
      "${BASE_URL}${path}")"
  else
    status="$(curl -sS -m "$timeout" -o "$tmp_body" -w "%{http_code}" -X "$method" \
      "${BASE_URL}${path}")"
  fi

  if [[ $? -ne 0 ]]; then
    rm -f "$tmp_body"
    echo "__HTTP_ERROR__"
    return
  fi

  if [[ "$status" == "000" ]]; then
    rm -f "$tmp_body"
    echo "__HTTP_ERROR__"
    return
  fi

  echo "${status}|${tmp_body}"
}

eval_success_field() {
  local body_file="$1"
  jq -r 'if type=="object" and has("success") then .success else "MISSING" end' "$body_file" 2>/dev/null
}

section "System Validation Start"
log "Time: $(date -Iseconds)"
log "Base URL: ${BASE_URL}"
log "Log file: ${LOG_FILE}"

require_cmd curl
require_cmd jq

section "Core Health"
res="$(check_http_json GET "/api/health")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/health unreachable (is Next.js running?)"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  if [[ "$status_code" =~ ^2 ]]; then
    pass "/api/health HTTP ${status_code}"
  else
    fail "/api/health HTTP ${status_code}"
  fi

  db_status="$(jq -r '.services.database.status // "missing"' "$body_file" 2>/dev/null)"
  ib_status="$(jq -r '.services.ib.status // "missing"' "$body_file" 2>/dev/null)"
  ollama_status="$(jq -r '.services.ollama.status // "missing"' "$body_file" 2>/dev/null)"
  wm_status="$(jq -r '.services.worldmonitor.status // "missing"' "$body_file" 2>/dev/null)"

  [[ "$db_status" == "ok" ]] && pass "Database status: ${db_status}" || fail "Database status: ${db_status}"
  [[ "$ib_status" == "ok" ]] && pass "IB status: ${ib_status}" || warn "IB status: ${ib_status}"
  [[ "$ollama_status" == "ok" ]] && pass "Ollama status: ${ollama_status}" || warn "Ollama status: ${ollama_status}"
  [[ "$wm_status" == "ok" ]] && pass "World Monitor status: ${wm_status}" || warn "World Monitor status: ${wm_status}"

  rm -f "$body_file"
fi

section "Trading Bot / Engine"
res="$(check_http_json GET "/api/trading/engine")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/trading/engine unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "Trading engine status endpoint OK"
  else
    fail "Trading engine endpoint failed (HTTP ${status_code}, success=${ok_field})"
  fi
  is_running="$(jq -r '.status.isRunning // "unknown"' "$body_file" 2>/dev/null)"
  log "INFO  Engine running: ${is_running}"
  rm -f "$body_file"
fi

section "Activity + Notifications"
res="$(check_http_json GET "/api/trading/activities?limit=20")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/trading/activities unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "Trading activities endpoint OK"
  else
    fail "Trading activities endpoint failed (HTTP ${status_code}, success=${ok_field})"
  fi
  rm -f "$body_file"
fi

res="$(check_http_json GET "/api/notifications")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/notifications unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "Notifications endpoint OK"
  else
    fail "Notifications endpoint failed (HTTP ${status_code}, success=${ok_field})"
  fi
  rm -f "$body_file"
fi

section "Analytics + Portfolio"
res="$(check_http_json GET "/api/trading/analytics?period=30d")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/trading/analytics unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "P&L analytics endpoint OK"
  else
    fail "P&L analytics endpoint failed (HTTP ${status_code}, success=${ok_field})"
  fi
  rm -f "$body_file"
fi

res="$(check_http_json GET "/api/portfolio/history?days=30&limit=200&stats=true")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/portfolio/history unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  count="$(jq -r '.summary.count // 0' "$body_file" 2>/dev/null)"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "Portfolio history endpoint OK"
    if [[ "${count:-0}" -gt 0 ]]; then
      pass "Portfolio snapshots found (${count})"
    else
      warn "Portfolio history is empty (count=0)"
    fi
  else
    fail "Portfolio history endpoint failed (HTTP ${status_code}, success=${ok_field})"
  fi
  rm -f "$body_file"
fi

section "Market Intelligence + World Monitor"
res="$(check_http_json GET "/api/market-intelligence?pair=SPY&timeframes=60")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/market-intelligence unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  if [[ "$status_code" =~ ^2 ]]; then
    pass "Market intelligence endpoint reachable"
  else
    fail "Market intelligence endpoint failed (HTTP ${status_code})"
  fi
  rm -f "$body_file"
fi

res="$(check_http_json GET "/api/worldmonitor/health")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/worldmonitor/health unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  connected="$(jq -r '.health.connected // "unknown"' "$body_file" 2>/dev/null)"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "World monitor health endpoint OK"
    [[ "$connected" == "true" ]] && pass "World monitor connected=true" || warn "World monitor connected=${connected}"
  else
    fail "World monitor health failed (HTTP ${status_code}, success=${ok_field})"
  fi
  rm -f "$body_file"
fi

res="$(check_http_json GET "/api/worldmonitor/news?category=markets&limit=5")"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/worldmonitor/news unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "World monitor news endpoint OK"
  else
    warn "World monitor news degraded (HTTP ${status_code}, success=${ok_field})"
  fi
  rm -f "$body_file"
fi

section "AI / LLM Features"
chat_payload='{"messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":32,"temperature":0}'
res="$(check_http_json POST "/api/chat" "$chat_payload" 120)"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/chat unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  if [[ "$status_code" =~ ^2 ]]; then
    has_response="$(jq -r 'has("response")' "$body_file" 2>/dev/null)"
    [[ "$has_response" == "true" ]] && pass "AI chat endpoint OK" || warn "AI chat returned without response field"
  else
    fail "AI chat failed (HTTP ${status_code})"
  fi
  rm -f "$body_file"
fi

analyze_payload='{"pair":"SPY","assetType":"stock","news":[{"title":"Market opens mixed","description":"Validation test item","source":"validator","pubDate":"2026-05-06T00:00:00Z"}],"marketData":{"SPY":{"price":"500","volume":"1000000","change24h":"0.2"}}}'
res="$(check_http_json POST "/api/trading/analyze" "$analyze_payload" 120)"
if [[ "$res" == "__HTTP_ERROR__" ]]; then
  fail "/api/trading/analyze unreachable"
else
  status_code="${res%%|*}"
  body_file="${res#*|}"
  ok_field="$(eval_success_field "$body_file")"
  if [[ "$status_code" =~ ^2 && "$ok_field" == "true" ]]; then
    pass "AI trading analysis endpoint OK"
  else
    fail "AI trading analysis failed (HTTP ${status_code}, success=${ok_field})"
  fi
  rm -f "$body_file"
fi

section "Summary"
TOTAL=$((PASS_COUNT + WARN_COUNT + FAIL_COUNT))
log "Checks run: ${TOTAL}"
log "PASS: ${PASS_COUNT}"
log "WARN: ${WARN_COUNT}"
log "FAIL: ${FAIL_COUNT}"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  log "RESULT: FAIL"
  exit 1
fi

if [[ "$WARN_COUNT" -gt 0 ]]; then
  log "RESULT: WARN (non-critical issues)"
  exit 0
fi

log "RESULT: PASS"
exit 0
