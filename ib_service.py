"""
Interactive Brokers Trading Service
Wraps ib_insync and exposes a REST API for the Next.js trading dashboard.

Usage:
  python ib_service.py

Prerequisites:
  - TWS or IB Gateway must be running
  - Enable API access in TWS: Edit > Global Configuration > API > Settings
    - Enable ActiveX and Socket Clients
    - Socket port: 7497 (paper) or 7496 (live)
    - Uncheck "Read-Only API" if you want to place orders
"""

import asyncio
import logging
import math
import os
import sys
import threading
from contextlib import asynccontextmanager
from datetime import datetime, time as dt_time
from typing import Optional

# ─── Logging ─────────────────────────────────────────────────────────────────
_LOG_LEVEL_STR = os.getenv("IB_LOG_LEVEL", "INFO").upper()
_LOG_LEVEL = getattr(logging, _LOG_LEVEL_STR, None)
if not isinstance(_LOG_LEVEL, int):
    print(f"[ib_service] Invalid IB_LOG_LEVEL '{_LOG_LEVEL_STR}' — valid: DEBUG INFO WARN ERROR. Defaulting to INFO.", file=sys.stderr)
    _LOG_LEVEL = logging.INFO

logging.basicConfig(
    level=_LOG_LEVEL,
    format="%(asctime)s %(levelname)-5s [ib_service] %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("ib_service")

import pytz


def _safe(v):
    """Convert nan/inf floats to None for JSON serialization."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


# ─── Market Hours ─────────────────────────────────────────────────────────────
EASTERN = pytz.timezone("America/New_York")
NYSE_OPEN  = dt_time(9, 30)
NYSE_CLOSE = dt_time(16, 0)
PRE_MARKET_OPEN  = dt_time(4, 0)
POST_MARKET_CLOSE = dt_time(20, 0)


def get_market_status() -> dict:
    """Return current US equity market status with full time context."""
    now_et = datetime.now(EASTERN)
    now_utc = datetime.now(pytz.utc)
    weekday = now_et.weekday()  # 0=Mon, 6=Sun
    t = now_et.time()

    is_weekend = weekday >= 5
    is_regular = not is_weekend and NYSE_OPEN <= t < NYSE_CLOSE
    is_pre     = not is_weekend and PRE_MARKET_OPEN <= t < NYSE_OPEN
    is_post    = not is_weekend and NYSE_CLOSE <= t < POST_MARKET_CLOSE

    if is_weekend:
        session = "closed_weekend"
    elif is_regular:
        session = "regular"
    elif is_pre:
        session = "pre_market"
    elif is_post:
        session = "post_market"
    else:
        session = "closed"

    return {
        "session":         session,
        "is_open":         is_regular,
        "is_extended":     is_pre or is_post,
        "can_place_orders": not is_weekend,
        "time_et":         now_et.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "time_utc":        now_utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "weekday":         now_et.strftime("%A"),
        "next_open":       _next_open_str(now_et),
    }


def _next_open_str(now_et: datetime) -> str:
    """Human-readable string for when regular market opens next."""
    from datetime import timedelta
    t = now_et.time()
    weekday = now_et.weekday()
    # Currently in regular session
    if weekday < 5 and NYSE_OPEN <= t < NYSE_CLOSE:
        return "Open now"
    # Before open today (weekday)
    if weekday < 5 and t < NYSE_OPEN:
        return "Today at 09:30 ET"
    # After close or weekend — find next weekday open
    if weekday == 4:        # Friday after close
        days_until = 3      # Monday
    elif weekday == 5:      # Saturday
        days_until = 2      # Monday
    elif weekday == 6:      # Sunday
        days_until = 1      # Monday
    else:                   # Mon-Thu after close
        days_until = 1
    next_day = (now_et + timedelta(days=days_until)).strftime("%A %b %d")
    return f"{next_day} at 09:30 ET"

import secrets
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from ib_insync import IB, Contract, MarketOrder, LimitOrder, StopOrder, Stock, Forex, Crypto, util
from pydantic import BaseModel

# ─── Config ──────────────────────────────────────────────────────────────────
IB_HOST     = os.getenv("IB_HOST",      "127.0.0.1")
IB_PORT     = int(os.getenv("IB_PORT",  "7497"))   # 7497=paper TWS, 7496=live TWS, 4002=paper GW, 4001=live GW
IB_CLIENT   = int(os.getenv("IB_CLIENT","10"))     # clientId 1 is often reserved by TWS
SERVICE_PORT= int(os.getenv("IB_SERVICE_PORT", "8765"))

# Optional API key auth — set IB_API_KEY env var to enable.
# If unset the service is unauthenticated (safe for localhost-only setups).
_API_KEY: str | None = os.getenv("IB_API_KEY") or None
if _API_KEY:
    logger.info("API key auth ENABLED (X-API-Key header required)")

# ─── IB runs in its own background thread with its own event loop ─────────────
ib        = IB()
ib.RaiseRequestErrors = False   # don't raise on subscription timeouts — keeps connection alive
_ib_loop  : Optional[asyncio.AbstractEventLoop] = None
_ib_ready = threading.Event()   # set when connected (or on failure)
_ib_lock  = threading.Lock()
_last_connected: Optional[datetime] = None

# ─── Known conIds for common US stocks (avoids qualifyContractsAsync round-trip) ─────────────────
_KNOWN_CON_IDS: dict[str, int] = {
    "AAPL":  265598,
    "MSFT":  272093,
    "NVDA":  4815747,
    "TSLA":  76792991,
    "GOOGL": 208813719,
    "AMZN":  3691937,
    "META":  107113386,
    "AMD":   4391,
    "JPM":   1520593,
    "V":     26477227,
    "JNJ":   1274203,
    "XOM":   13977,
    "CRM":   20765463,
    "PLTR":  453104335,
    "SNOW":  468491603,
    "GS":    2190817,
    "CVX":   8578,
    "PFE":   21839000,
    "SPY":   756733,
    "QQQ":   320227571,
}

# ─── Contract cache ───────────────────────────────────────────────────────────────────────────────
_contract_cache: dict = {}


def _build_contract(symbol: str, sec_type: str, exchange: str, currency: str):
    """Build a contract with conId if known, skipping qualifyContractsAsync."""
    contract = make_contract(symbol, sec_type, exchange, currency)
    if sec_type.upper() == "STK" and symbol.upper() in _KNOWN_CON_IDS:
        contract.conId = _KNOWN_CON_IDS[symbol.upper()]
    return contract


async def _get_contract(symbol: str, sec_type: str, exchange: str, currency: str):
    """Return a ready-to-use contract. Uses known conId map to avoid qualifyContractsAsync."""
    cache_key = f"{symbol}:{sec_type}:{exchange}:{currency}"
    if cache_key in _contract_cache:
        return _contract_cache[cache_key]
    contract = _build_contract(symbol, sec_type, exchange, currency)
    _contract_cache[cache_key] = contract
    return contract


def _ib_thread_main():
    """Entry point for the dedicated IB thread."""
    global _ib_loop, _last_connected
    _ib_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_ib_loop)

    async def _connect():
        global _last_connected
        try:
            await ib.connectAsync(IB_HOST, IB_PORT, clientId=IB_CLIENT, timeout=15)
            accounts = ib.managedAccounts()
            logger.info(f"Connected — accounts: {accounts}")
            _last_connected = datetime.now(EASTERN)
            # Subscribe to account updates so accountValues() and positions() are populated
            if accounts:
                # ib_insync's reqAccountUpdates() is auto-called on connect - just wait for data
                logger.debug(f"Waiting for account data for {accounts[0]}...")
                await asyncio.sleep(3)  # Give time for initial account data to arrive
                vals = ib.accountValues()
                logger.info(f"Got {len(vals)} account values")
            # Start auto-reconnect monitor for daily IB reset
            _ib_loop.create_task(_auto_reconnect_monitor())
        except Exception as e:
            logger.error(f"Startup connect failed: {e}")
            logger.warning(f"Will retry on first request. Make sure TWS/Gateway is on port {IB_PORT}.")
        finally:
            _ib_ready.set()  # signal main thread regardless of success/failure

    _ib_loop.run_until_complete(_connect())
    _ib_loop.run_forever()    # keep running for callbacks and reconnects


async def _connect_with_backoff(
    context: str,
    initial_delay: float = 5.0,
    max_delay: float = 120.0,
    max_attempts: int = 10,
) -> bool:
    """
    Attempt to reconnect to IB TWS/Gateway with exponential backoff.

    Delays: 5 → 10 → 20 → 40 → 80 → 120 → 120 → ... seconds (capped at max_delay).
    Returns True if connected, False if all attempts exhausted.
    """
    global _last_connected
    delay = initial_delay
    for attempt in range(1, max_attempts + 1):
        try:
            await ib.connectAsync(IB_HOST, IB_PORT, clientId=IB_CLIENT, timeout=15)
            if ib.isConnected():
                _last_connected = datetime.now(EASTERN)
                accounts = ib.managedAccounts()
                logger.info(f"[{context}] Connected — accounts: {accounts} (attempt {attempt})")
                await asyncio.sleep(3)   # let account data settle
                return True
        except Exception as e:
            logger.warning(f"[{context}] Attempt {attempt}/{max_attempts} failed: {e}")
        if attempt < max_attempts:
            logger.info(f"[{context}] Retrying in {delay:.0f}s...")
            await asyncio.sleep(delay)
            delay = min(delay * 2, max_delay)
    logger.error(f"[{context}] All {max_attempts} attempts exhausted.")
    return False


async def _auto_reconnect_monitor():
    """
    Monitor IB connection and auto-reconnect if dropped.
    IB has a daily server reset around 11:45 PM - 12:00 AM ET.
    This task runs every 30 seconds to check connection status.
    Uses exponential backoff: 5 → 10 → 20 → 40 → 80 → 120s (capped).
    """
    logger.info("Auto-reconnect monitor started (handles daily 11:45 PM ET reset)")

    while True:
        await asyncio.sleep(30)  # Check every 30 seconds

        try:
            if not ib.isConnected():
                now_et = datetime.now(EASTERN)
                logger.warning(f"Connection lost at {now_et.strftime('%Y-%m-%d %H:%M:%S ET')}")
                connected = await _connect_with_backoff(
                    context="auto-reconnect",
                    initial_delay=5.0,
                    max_delay=120.0,
                    max_attempts=10,
                )
                if not connected:
                    logger.error("Could not reconnect after 10 attempts. Will retry next monitor cycle.")
        except Exception as e:
            logger.error(f"Auto-reconnect monitor error: {e}")


def _start_ib_thread():
    t = threading.Thread(target=_ib_thread_main, name="ib-thread", daemon=True)
    t.start()
    _ib_ready.wait(timeout=15)  # wait up to 15s for connection


async def _ib(coro, timeout: int = 65):
    """Run an ib_insync coroutine on the IB thread's event loop and return its result."""
    if _ib_loop is None:
        raise HTTPException(status_code=503, detail="IB thread not started yet")
    fut = asyncio.run_coroutine_threadsafe(coro, _ib_loop)
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, fut.result, timeout)
    except TimeoutError:
        fut.cancel()
        raise HTTPException(status_code=504, detail="IB request timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def ensure_connected():
    """
    Reconnect if session dropped, with exponential backoff (up to 5 attempts).
    Delays: 1 → 2 → 4 → 8 → 16s. Raises HTTP 503 if all attempts fail.
    """
    if not ib.isConnected():
        with _ib_lock:
            if not ib.isConnected():
                event = threading.Event()
                success_flag = [False]

                async def _reconnect():
                    connected = await _connect_with_backoff(
                        context="ensure_connected",
                        initial_delay=1.0,
                        max_delay=16.0,
                        max_attempts=5,
                    )
                    success_flag[0] = connected
                    event.set()

                asyncio.run_coroutine_threadsafe(_reconnect(), _ib_loop)
                event.wait(timeout=60)  # worst case: 1+2+4+8+16 = 31s + connect timeouts

        if not ib.isConnected():
            raise HTTPException(status_code=503, detail="Cannot connect to IB TWS/Gateway after retries")
        # Let IB internal subscriptions settle before making contract/market requests
        await asyncio.sleep(5)


# ─── Helpers ─────────────────────────────────────────────────────────────────
def make_contract(symbol: str, sec_type: str, exchange: str, currency: str) -> Contract:
    sec_type = sec_type.upper()
    if sec_type == "STK":
        return Stock(symbol, exchange, currency)
    elif sec_type == "CRYPTO":
        return Crypto(symbol, exchange, currency)
    elif sec_type == "CASH":
        return Forex(symbol)
    else:
        c = Contract()
        c.symbol   = symbol
        c.secType  = sec_type
        c.exchange = exchange
        c.currency = currency
        return c


# ─── Request models ───────────────────────────────────────────────────────────
class OrderRequest(BaseModel):
    symbol: str
    sec_type: str = "STK"
    exchange: str = "SMART"
    currency: str = "USD"
    action: str                    # BUY or SELL
    quantity: float
    order_type: str = "MKT"       # MKT or LMT
    limit_price: Optional[float] = None
    validate_only: bool = True     # SAFETY: True = dry-run by default


class BracketOrderRequest(BaseModel):
    symbol: str
    sec_type: str = "STK"
    exchange: str = "SMART"
    currency: str = "USD"
    action: str                        # BUY or SELL
    quantity: float
    stop_loss_price: float             # Stop price for the STP child order
    take_profit_price: float           # Limit price for the LMT child order
    limit_price: Optional[float] = None  # If set, entry is LMT order; otherwise MKT
    outside_rth: bool = False          # Allow trading outside regular trading hours
    overnight: bool = False            # Route to OVERNIGHT exchange (8 PM–3:50 AM ET)
    validate_only: bool = True         # SAFETY: True = dry-run by default


# ─── App ─────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    _start_ib_thread()
    yield
    try:
        if ib.isConnected():
            ib.disconnect()
            logger.info("Disconnected.")
    except Exception as e:
        logger.debug(f"Shutdown disconnect error (safe to ignore): {e}")


app = FastAPI(title="IB Trading Service", version="1.0.0", lifespan=lifespan)
# CORS allowed origins — configurable via IB_CORS_ORIGINS env var (comma-separated).
# Default: localhost:3001 (Next.js) and localhost:3000 (World Monitor).
_cors_origins_str = os.getenv("IB_CORS_ORIGINS", "http://localhost:3001,http://localhost:3000")
_cors_origins = [o.strip() for o in _cors_origins_str.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    """
    Optional API key guard. Only active when IB_API_KEY env var is set.
    /health and /market-status are always public (used by dashboards without auth).
    All other endpoints require X-API-Key: <key> header.
    """
    if _API_KEY and request.url.path not in ("/health", "/market-status", "/docs", "/openapi.json"):
        provided = request.headers.get("X-API-Key", "")
        if not secrets.compare_digest(provided, _API_KEY):
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})
    return await call_next(request)


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "connected":     ib.isConnected(),
        "host":          IB_HOST,
        "port":          IB_PORT,
        "accounts":      ib.managedAccounts() if ib.isConnected() else [],
        "market_status": get_market_status(),
        "last_connected": _last_connected.strftime('%Y-%m-%d %H:%M:%S ET') if _last_connected else None,
        "auto_reconnect": True,
    }


@app.get("/market-status")
async def market_status():
    """Current US equity market session status with timezone info."""
    return get_market_status()


@app.get("/balance")
async def get_balance():
    await ensure_connected()
    account_values = ib.accountValues()
    tags = {
        "NetLiquidation", "TotalCashValue", "AvailableFunds",
        "UnrealizedPnL", "RealizedPnL", "BuyingPower",
        "GrossPositionValue", "MaintMarginReq",
    }
    result = {}
    for av in account_values:
        if av.tag in tags:
            key = f"{av.tag}_{av.currency}" if av.currency else av.tag
            result[key] = av.value
    return result


@app.get("/positions")
async def get_positions():
    await ensure_connected()
    return [
        {
            "account":  p.account,
            "symbol":   p.contract.symbol,
            "sec_type": p.contract.secType,
            "exchange": p.contract.exchange,
            "currency": p.contract.currency,
            "position": p.position,
            "avg_cost": p.avgCost,
        }
        for p in ib.positions()
    ]


@app.get("/ticker/{symbol}")
async def get_ticker(
    symbol: str,
    sec_type: str = "STK",
    exchange: str = "SMART",
    currency: str = "USD",
):
    await ensure_connected()

    async def _fetch():
        contract = _build_contract(symbol, sec_type, exchange, currency)
        ticker = ib.reqMktData(contract, "", False, False)
        await asyncio.sleep(1.5)   # wait for snapshot data to arrive
        ib.cancelMktData(contract)
        return ticker

    ticker = await _ib(_fetch(), timeout=15)
    if ticker is None:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")

    return {
        "symbol":    symbol,
        "last":      _safe(ticker.last),
        "bid":       _safe(ticker.bid),
        "ask":       _safe(ticker.ask),
        "close":     _safe(ticker.close),
        "volume":    _safe(ticker.volume),
        "halted":    _safe(ticker.halted),
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/ohlc/{symbol}")
async def get_ohlc(
    symbol: str,
    sec_type: str    = "STK",
    exchange: str    = "SMART",
    currency: str    = "USD",
    bar_size: str    = "5 mins",
    duration: str    = "1 D",
    what_to_show: str = "TRADES",
):
    await ensure_connected()

    async def _fetch():
        contract = _build_contract(symbol, sec_type, exchange, currency)
        # useRTH=True for intraday (paper trading has limited extended-hours data)
        # useRTH=False for daily+ bars to include full day
        intraday = bar_size not in ("1 day", "1 week", "1 month")
        return await ib.reqHistoricalDataAsync(
            contract,
            endDateTime="",
            durationStr=duration,
            barSizeSetting=bar_size,
            whatToShow=what_to_show,
            useRTH=intraday,
            formatDate=1,
        )

    bars = await _ib(_fetch(), timeout=65)
    if bars is None:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")

    return [
        {
            "time":   bar.date.isoformat() if hasattr(bar.date, "isoformat") else str(bar.date),
            "open":   bar.open,
            "high":   bar.high,
            "low":    bar.low,
            "close":  bar.close,
            "volume": bar.volume,
        }
        for bar in bars
    ]


@app.get("/orders")
async def get_orders():
    await ensure_connected()
    return [
        {
            "order_id":        t.order.orderId,
            "symbol":          t.contract.symbol,
            "action":          t.order.action,
            "quantity":        t.order.totalQuantity,
            "order_type":      t.order.orderType,
            "limit_price":     getattr(t.order, "auxPrice", None) if t.order.orderType == "STP" else getattr(t.order, "lmtPrice", None),
            "status":          t.orderStatus.status,
            "filled":          t.orderStatus.filled,
            "remaining":       t.orderStatus.remaining,
            "avg_fill_price":  t.orderStatus.avgFillPrice,
        }
        for t in ib.trades()
    ]


@app.post("/order")
async def place_order(req: OrderRequest):
    """
    Place or validate an order.
    validate_only=true (default) → dry-run, no real order sent.
    validate_only=false          → REAL order — use with care!
    """
    await ensure_connected()

    # Build order params before entering the IB loop
    action     = req.action.upper()
    order_type = req.order_type.upper()
    if order_type not in ("MKT", "LMT", "STP"):
        raise HTTPException(status_code=400, detail=f"Unsupported order_type: {req.order_type}")
    if order_type in ("LMT", "STP") and req.limit_price is None:
        raise HTTPException(status_code=400, detail="limit_price required for LMT/STP orders")

    async def _execute():
        contract = await _get_contract(req.symbol, req.sec_type, req.exchange, req.currency)
        if contract is None:
            return None

        if order_type == "MKT":
            order = MarketOrder(action, req.quantity)
        elif order_type == "LMT":
            order = LimitOrder(action, req.quantity, req.limit_price)
        else:  # STP
            order = StopOrder(action, req.quantity, req.limit_price)
            order.tif = "GTC"

        if req.validate_only:
            order.whatIf = True
            what_if = await ib.whatIfOrderAsync(contract, order)
            return {"what_if": what_if, "contract": contract}
        else:
            trade = ib.placeOrder(contract, order)
            # Wait up to 10s for order to leave PendingSubmit
            for _ in range(10):
                await asyncio.sleep(1)
                if trade.orderStatus.status not in ("PendingSubmit", "PreSubmitted", ""):
                    break
            return {"trade": trade}

    result = await _ib(_execute(), timeout=60)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Symbol {req.symbol} not found")

    if req.validate_only:
        wi = result["what_if"]
        return {
            "validate_only":  True,
            "symbol":         req.symbol,
            "action":         req.action,
            "quantity":       req.quantity,
            "order_type":     req.order_type,
            "limit_price":    req.limit_price,
            "init_margin":    wi.initMarginChange,
            "maint_margin":   wi.maintMarginChange,
            "equity_change":  wi.equityWithLoanChange,
            "commission":     wi.commission,
            "max_commission": wi.maxCommission,
        }
    else:
        trade = result["trade"]
        return {
            "validate_only": False,
            "order_id":      trade.order.orderId,
            "symbol":        req.symbol,
            "action":        req.action,
            "quantity":      req.quantity,
            "order_type":    req.order_type,
            "status":        trade.orderStatus.status,
            "filled":        trade.orderStatus.filled,
            "remaining":     trade.orderStatus.remaining,
        }


@app.post("/bracket-order")
async def place_bracket_order(req: BracketOrderRequest):
    """
    Place a bracket order: market entry + native SL stop order + native TP limit order.
    All three orders are linked via parentId so IB manages exits automatically.
    validate_only=true (default) → dry-run only, no real orders sent.
    validate_only=false          → REAL orders — use with care!
    """
    await ensure_connected()

    action = req.action.upper()
    if action not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail=f"Invalid action: {req.action}")

    reverse_action = "SELL" if action == "BUY" else "BUY"

    async def _execute():
        # Route to OVERNIGHT exchange for the overnight session (8 PM–3:50 AM ET)
        exchange = "OVERNIGHT" if req.overnight else req.exchange
        contract = await _get_contract(req.symbol, req.sec_type, exchange, req.currency)
        if contract is None:
            return None

        use_outside_rth = req.outside_rth or req.overnight

        if req.validate_only:
            # For dry-run: use limit order if provided, else market order
            if req.limit_price is not None:
                parent = LimitOrder(action, req.quantity, round(req.limit_price, 2))
            else:
                parent = MarketOrder(action, req.quantity)
            if use_outside_rth:
                parent.outsideRth = True
            parent.whatIf = True
            what_if = await ib.whatIfOrderAsync(contract, parent)
            return {"what_if": what_if, "validate_only": True}

        # Build the 3-order bracket using IB-assigned order IDs.
        # Overnight requires limit orders — market orders are not supported outside RTH.
        if req.limit_price is not None:
            parent = LimitOrder(action, req.quantity, round(req.limit_price, 2))
        elif req.overnight:
            raise HTTPException(
                status_code=400,
                detail="Overnight orders require limit_price (market orders not supported outside RTH)",
            )
        else:
            parent = MarketOrder(action, req.quantity)
        parent.orderId = ib.client.getReqId()
        parent.transmit = False  # hold — don't send to exchange until all 3 are placed
        if use_outside_rth:
            parent.outsideRth = True

        take_profit = LimitOrder(reverse_action, req.quantity, round(req.take_profit_price, 2))
        take_profit.orderId = ib.client.getReqId()
        take_profit.parentId = parent.orderId
        take_profit.tif = "GTC"   # persist across sessions — don't expire at day end
        take_profit.transmit = False
        if use_outside_rth:
            take_profit.outsideRth = True

        stop_loss = StopOrder(reverse_action, req.quantity, round(req.stop_loss_price, 2))
        stop_loss.orderId = ib.client.getReqId()
        stop_loss.parentId = parent.orderId
        stop_loss.tif = "GTC"     # persist across sessions — don't expire at day end
        stop_loss.transmit = True  # transmitting this one sends all 3 together
        if use_outside_rth:
            stop_loss.outsideRth = True

        parent_trade = ib.placeOrder(contract, parent)
        tp_trade = ib.placeOrder(contract, take_profit)
        sl_trade = ib.placeOrder(contract, stop_loss)

        # Wait up to 10s for parent to leave PendingSubmit
        for _ in range(10):
            await asyncio.sleep(1)
            if parent_trade.orderStatus.status not in ("PendingSubmit", "PreSubmitted", ""):
                break

        return {
            "validate_only": False,
            "parent_order_id":     parent_trade.order.orderId,
            "take_profit_order_id": tp_trade.order.orderId,
            "stop_loss_order_id":  sl_trade.order.orderId,
            "status":              parent_trade.orderStatus.status,
        }

    result = await _ib(_execute(), timeout=60)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Symbol {req.symbol} not found")

    if req.validate_only:
        wi = result["what_if"]
        return {
            "validate_only":      True,
            "symbol":             req.symbol,
            "action":             req.action,
            "quantity":           req.quantity,
            "stop_loss_price":    req.stop_loss_price,
            "take_profit_price":  req.take_profit_price,
            "init_margin":        wi.initMarginChange,
            "maint_margin":       wi.maintMarginChange,
            "equity_change":      wi.equityWithLoanChange,
            "commission":         wi.commission,
            "max_commission":     wi.maxCommission,
        }

    return {
        "validate_only":        False,
        "symbol":               req.symbol,
        "action":               req.action,
        "quantity":             req.quantity,
        "stop_loss_price":      req.stop_loss_price,
        "take_profit_price":    req.take_profit_price,
        "parent_order_id":      result["parent_order_id"],
        "take_profit_order_id": result["take_profit_order_id"],
        "stop_loss_order_id":   result["stop_loss_order_id"],
        "status":               result["status"],
    }


class OcaOrderRequest(BaseModel):
    symbol: str
    sec_type: str = "STK"
    exchange: str = "SMART"
    currency: str = "USD"
    quantity: float
    stop_price: float    # STP order trigger price
    limit_price: float   # LMT order target price
    action: str = "SELL" # direction of both exit orders
    validate_only: bool = True


@app.post("/oca-order")
async def place_oca_order(req: OcaOrderRequest):
    """
    Place two exit orders (STP + LMT) linked in an OCA group.
    When one fills, IB automatically cancels the other — preventing
    accidental short positions when both stop and take-profit are live.
    validate_only=true (default) → dry-run only.
    validate_only=false          → REAL orders.
    """
    await ensure_connected()

    action = req.action.upper()
    oca_group = f"{req.symbol}_EXIT_{ib.client.getReqId()}"

    async def _execute():
        contract = await _get_contract(req.symbol, req.sec_type, req.exchange, req.currency)
        if contract is None:
            return None

        stop = StopOrder(action, req.quantity, round(req.stop_price, 2))
        stop.orderId   = ib.client.getReqId()
        stop.tif       = "GTC"
        stop.ocaGroup  = oca_group
        stop.ocaType   = 1   # cancel remaining orders with block

        limit = LimitOrder(action, req.quantity, round(req.limit_price, 2))
        limit.orderId  = ib.client.getReqId()
        limit.tif      = "GTC"
        limit.ocaGroup = oca_group
        limit.ocaType  = 1

        if req.validate_only:
            stop.whatIf = True
            what_if = await ib.whatIfOrderAsync(contract, stop)
            return {"what_if": what_if}

        stop_trade  = ib.placeOrder(contract, stop)
        limit_trade = ib.placeOrder(contract, limit)

        for _ in range(10):
            await asyncio.sleep(1)
            if stop_trade.orderStatus.status not in ("PendingSubmit", "PreSubmitted", ""):
                break

        return {
            "stop_order_id":  stop_trade.order.orderId,
            "limit_order_id": limit_trade.order.orderId,
            "stop_status":    stop_trade.orderStatus.status,
            "limit_status":   limit_trade.orderStatus.status,
        }

    result = await _ib(_execute(), timeout=60)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Symbol {req.symbol} not found")

    if req.validate_only:
        wi = result["what_if"]
        return {
            "validate_only": True,
            "symbol": req.symbol,
            "oca_group": oca_group,
            "stop_price": req.stop_price,
            "limit_price": req.limit_price,
            "init_margin": wi.initMarginChange,
            "commission":  wi.commission,
        }

    return {
        "validate_only":  False,
        "symbol":         req.symbol,
        "oca_group":      oca_group,
        "stop_order_id":  result["stop_order_id"],
        "limit_order_id": result["limit_order_id"],
        "stop_status":    result["stop_status"],
        "limit_status":   result["limit_status"],
        "stop_price":     req.stop_price,
        "limit_price":    req.limit_price,
    }


@app.delete("/order/{order_id}")
async def cancel_order(order_id: int):
    await ensure_connected()
    trades = ib.trades()
    target = next((t for t in trades if t.order.orderId == order_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found")
    ib.cancelOrder(target.order)
    await asyncio.sleep(0.5)
    return {"cancelled": True, "order_id": order_id}


@app.delete("/orders/symbol/{symbol}")
async def cancel_orders_for_symbol(symbol: str):
    """Cancel all open orders for a symbol. Used as a safety net when closing positions."""
    await ensure_connected()
    active_statuses = {"Submitted", "PreSubmitted"}
    cancelled = []
    for t in ib.trades():
        if t.contract.symbol == symbol and t.orderStatus.status in active_statuses:
            try:
                ib.cancelOrder(t.order)
                cancelled.append(t.order.orderId)
            except Exception:
                pass
    if cancelled:
        await asyncio.sleep(0.5)
    return {"symbol": symbol, "cancelled": cancelled, "count": len(cancelled)}


# ─── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("  IB Trading Service")
    print("=" * 60)
    print(f"  TWS/Gateway : {IB_HOST}:{IB_PORT}  (clientId={IB_CLIENT})")
    print(f"  Service URL : http://localhost:{SERVICE_PORT}")
    print(f"  API Docs    : http://localhost:{SERVICE_PORT}/docs")
    print()
    print("  Ports:")
    print("    7497 = TWS Paper Trading   (default)")
    print("    7496 = TWS Live Trading    ⚠️  REAL MONEY")
    print("    4002 = IB Gateway Paper")
    print("    4001 = IB Gateway Live     ⚠️  REAL MONEY")
    print()
    print("  Override: IB_HOST, IB_PORT, IB_CLIENT, IB_SERVICE_PORT env vars")
    print("=" * 60)
    # Suppress uvicorn's per-request access logs for noisy health/status polls.
    # Access log level is controlled by IB_ACCESS_LOG env var (default: off).
    # Set IB_ACCESS_LOG=1 to re-enable full request logging.
    access_log = os.getenv("IB_ACCESS_LOG", "0") == "1"
    uvicorn.run(
        "ib_service:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        access_log=access_log,
        log_level=_LOG_LEVEL_STR.lower(),
    )
