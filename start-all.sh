#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-all.sh — Start all Trading Bot services in the correct order
#
# Services started:
#   1. ib_service.py       (Python FastAPI, port 8765) — IB gateway
#   2. worldmonitor        (Node, port 3000)           — global market data
#   3. websocket-server.ts (Node, port 3002)           — real-time WS feed
#   4. Next.js app         (Node, port 3001)           — dashboard + bot
#
# Usage:
#   ./start-all.sh            # start all services
#   ./start-all.sh --stop     # stop all services launched by this script
#   ./start-all.sh --status   # show running status
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Load nvm / local bin ────────────────────────────────────────────────────
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

# ─── PostgreSQL (user-space install) ─────────────────────────────────────────
export PG_HOME="$HOME/pg-local/root"
export PATH="$PG_HOME/usr/lib/postgresql/16/bin:$PATH"
export LD_LIBRARY_PATH="$PG_HOME/usr/lib/x86_64-linux-gnu:$PG_HOME/usr/lib/postgresql/16/lib:${LD_LIBRARY_PATH:-}"
export PGDATA="$HOME/pg-local/data"
export PGHOST="$HOME/pg-local/run"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR"
PID_DIR="$SCRIPT_DIR/.pids"

mkdir -p "$PID_DIR"

IB_LOG="$LOG_DIR/ib_service.log"
WM_LOG="$LOG_DIR/worldmonitor.log"
WS_LOG="$LOG_DIR/websocket-server.log"
NEXT_LOG="$LOG_DIR/nextjs.log"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }

# ─── Stop ────────────────────────────────────────────────────────────────────
stop_all() {
  echo "Stopping all services..."
  for svc in ib_service worldmonitor websocket nextjs; do
    PID_FILE="$PID_DIR/$svc.pid"
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        kill "$PID" && log "Stopped $svc (PID $PID)"
      else
        warn "$svc (PID $PID) was not running"
      fi
      rm -f "$PID_FILE"
    fi
  done
  echo "Done."
}

# ─── Status ──────────────────────────────────────────────────────────────────
status_all() {
  echo "Service status:"
  for svc in ib_service worldmonitor websocket nextjs; do
    PID_FILE="$PID_DIR/$svc.pid"
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo -e "  ${GREEN}●${NC} $svc  (PID $PID)"
      else
        echo -e "  ${RED}●${NC} $svc  (dead, stale PID $PID)"
      fi
    else
      echo -e "  ${YELLOW}●${NC} $svc  (not started by this script)"
    fi
  done
}

# ─── Helpers ─────────────────────────────────────────────────────────────────
wait_for_port() {
  local port=$1 name=$2 retries=${3:-20}
  for i in $(seq 1 "$retries"); do
    if nc -z localhost "$port" 2>/dev/null; then
      log "$name is up on port $port"
      return 0
    fi
    sleep 1
  done
  err "$name did not come up on port $port after ${retries}s"
  return 1
}

start_bg() {
  local name=$1 cmd=$2 log_file=$3
  eval "$cmd" >> "$log_file" 2>&1 &
  echo $! > "$PID_DIR/$name.pid"
}

# ─── Arg handling ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--stop" ];   then stop_all;   exit 0; fi
if [ "${1:-}" = "--status" ]; then status_all; exit 0; fi

# ─── Pre-flight checks ────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  Trading Bot — Starting all services"
echo "================================================"
echo ""

# Check Python / ib_service dependencies
if ! command -v python3 &>/dev/null; then
  err "python3 not found. Install Python 3.10+"
  exit 1
fi
if ! python3 -c "import ib_insync, fastapi, uvicorn" 2>/dev/null; then
  err "Missing Python deps. Run: pip install ib_insync fastapi uvicorn pytz"
  exit 1
fi

# Check Node
if ! command -v node &>/dev/null; then
  err "node not found"
  exit 1
fi

# ─── 1. IB Service ────────────────────────────────────────────────────────────
echo "Starting ib_service.py (port 8765)..."
start_bg "ib_service" \
  "python3 '$SCRIPT_DIR/ib_service.py'" \
  "$IB_LOG"
wait_for_port 8765 "ib_service.py" 30 || warn "ib_service.py may not have connected to TWS yet (check $IB_LOG)"

# ─── 2. World Monitor ─────────────────────────────────────────────────────────
WM_DIR="$SCRIPT_DIR/worldmonitor"
if [ -d "$WM_DIR" ] && [ -f "$WM_DIR/package.json" ]; then
  echo "Starting World Monitor (port 3000)..."
  # Install deps if needed
  if [ ! -d "$WM_DIR/node_modules" ]; then
    warn "worldmonitor/node_modules missing — running npm install..."
    npm install --prefix "$WM_DIR" --silent
  fi
  start_bg "worldmonitor" \
    "npm run dev:finance --prefix '$WM_DIR'" \
    "$WM_LOG"
  wait_for_port 3000 "World Monitor" 30 || warn "World Monitor did not start (check $WM_LOG)"
else
  warn "worldmonitor/ directory not found — skipping World Monitor"
fi

# ─── 3. Next.js ───────────────────────────────────────────────────────────────
NEXT_DIR="$SCRIPT_DIR/deepseek-ui"
echo "Building and starting Next.js app (port 3001)..."
if [ ! -d "$NEXT_DIR/node_modules" ]; then
  warn "deepseek-ui/node_modules missing — running npm install..."
  npm install --prefix "$NEXT_DIR" --silent
fi
# Build then start in production mode
(cd "$NEXT_DIR" && npm run build >> "$NEXT_LOG" 2>&1 && PORT=3001 npm start >> "$NEXT_LOG" 2>&1) &
echo $! > "$PID_DIR/nextjs.pid"
wait_for_port 3001 "Next.js" 90 || { err "Next.js failed to start (check $NEXT_LOG)"; exit 1; }

# ─── 4. WebSocket Server ──────────────────────────────────────────────────────
echo "Starting WebSocket server (port 3002)..."
start_bg "websocket" \
  "cd '$NEXT_DIR' && npx tsx websocket-server.ts" \
  "$WS_LOG"
wait_for_port 3002 "WebSocket server" 20 || warn "WebSocket server did not start (check $WS_LOG)"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "================================================"
log "All services started!"
echo ""
echo "  Dashboard  :  http://localhost:3001"
echo "  IB Service :  http://localhost:8765/docs"
echo "  WebSocket  :  ws://localhost:3002"
echo "  Logs       :  $LOG_DIR/*.log"
echo ""
echo "  Stop all   :  ./start-all.sh --stop"
echo "  Status     :  ./start-all.sh --status"
echo "================================================"
echo ""
