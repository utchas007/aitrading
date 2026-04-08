/**
 * Interactive Brokers Client
 * Calls the Python ib_service.py REST API.
 * Run: python ib_service.py  (must be running before using these functions)
 */

const IB_SERVICE_URL = process.env.IB_SERVICE_URL || 'http://localhost:8765';

export interface IBBalance {
  [key: string]: string; // e.g. NetLiquidation_USD, TotalCashValue_USD, ...
}

export interface IBPosition {
  account: string;
  symbol: string;
  sec_type: string;
  exchange: string;
  currency: string;
  position: number;
  avg_cost: number;
}

export interface IBTicker {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  close: number | null;
  volume: number | null;
  halted: number | null;
  timestamp: string;
}

export interface IBOHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IBOrder {
  order_id: number;
  symbol: string;
  action: string;
  quantity: number;
  order_type: string;
  limit_price: number | null;
  status: string;
  filled: number;
  remaining: number;
  avg_fill_price: number;
}

export interface PlaceOrderRequest {
  symbol: string;
  sec_type?: 'STK' | 'CRYPTO' | 'CASH' | 'FUT' | 'OPT';
  exchange?: string;
  currency?: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  order_type?: 'MKT' | 'LMT';
  limit_price?: number;
  validate_only?: boolean; // default true — set false to send real orders
}

export interface PlaceOrderResult {
  validate_only: boolean;
  order_id?: number;
  symbol: string;
  action: string;
  quantity: number;
  order_type: string;
  limit_price?: number | null;
  status?: string;
  filled?: number;
  remaining?: number;
  // what-if fields (validate_only=true)
  init_margin?: string;
  maint_margin?: string;
  equity_change?: string;
  commission?: string;
  max_commission?: string;
}

export interface PlaceBracketOrderRequest {
  symbol: string;
  sec_type?: 'STK' | 'CRYPTO' | 'CASH' | 'FUT' | 'OPT';
  exchange?: string;
  currency?: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  stop_loss_price: number;
  take_profit_price: number;
  validate_only?: boolean;
}

export interface PlaceBracketOrderResult {
  validate_only: boolean;
  symbol: string;
  action: string;
  quantity: number;
  stop_loss_price: number;
  take_profit_price: number;
  // live order fields (validate_only=false)
  parent_order_id?: number;
  take_profit_order_id?: number;
  stop_loss_order_id?: number;
  status?: string;
  // what-if fields (validate_only=true)
  init_margin?: string;
  maint_margin?: string;
  equity_change?: string;
  commission?: string;
  max_commission?: string;
}

const IB_API_KEY = process.env.IB_API_KEY;

// Retry delays in ms: 500 → 1000 → 2000 (3 attempts after the initial try)
const RETRY_DELAYS = [500, 1000, 2000];

async function ibFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> ?? {}),
  };
  if (IB_API_KEY) headers['X-API-Key'] = IB_API_KEY;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(`${IB_SERVICE_URL}${path}`, { ...options, headers });

      // 4xx = client/logic error — don't retry, fail immediately
      if (res.status >= 400 && res.status < 500) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(`IB Service error ${res.status}: ${err.detail ?? JSON.stringify(err)}`);
      }

      // 5xx = server error — retry after delay
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        lastError = new Error(`IB Service error ${res.status}: ${err.detail ?? JSON.stringify(err)}`);
      } else {
        return res.json() as Promise<T>;
      }
    } catch (e: any) {
      // Network-level failure (ECONNREFUSED, timeout, etc.) — retry
      if (e.message?.startsWith('IB Service error 4')) throw e; // re-throw 4xx immediately
      lastError = e;
    }

    if (attempt < RETRY_DELAYS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }

  throw lastError ?? new Error(`IB Service unreachable after ${RETRY_DELAYS.length + 1} attempts`);
}

export function createIBClient() {
  return {
    /** Check if the IB service and TWS/Gateway are reachable */
    async getHealth() {
      return ibFetch<{ connected: boolean; host: string; port: number; accounts: string[] }>('/health');
    },

    /** Account balances (cash, net liquidation, buying power, PnL …) */
    async getBalance(): Promise<IBBalance> {
      return ibFetch<IBBalance>('/balance');
    },

    /** All open positions */
    async getPositions(): Promise<IBPosition[]> {
      return ibFetch<IBPosition[]>('/positions');
    },

    /**
     * Live market snapshot for a symbol.
     * @example getTicker('AAPL')
     * @example getTicker('BTC', 'CRYPTO', 'PAXOS', 'USD')
     */
    async getTicker(
      symbol: string,
      secType = 'STK',
      exchange = 'SMART',
      currency = 'USD',
    ): Promise<IBTicker> {
      const params = new URLSearchParams({ sec_type: secType, exchange, currency });
      return ibFetch<IBTicker>(`/ticker/${symbol}?${params}`);
    },

    /**
     * Historical OHLCV bars.
     * @example getOHLC('AAPL', 'STK', 'SMART', 'USD', '5 mins', '1 D')
     */
    async getOHLC(
      symbol: string,
      secType = 'STK',
      exchange = 'SMART',
      currency = 'USD',
      barSize = '5 mins',
      duration = '1 D',
    ): Promise<IBOHLCBar[]> {
      const params = new URLSearchParams({ sec_type: secType, exchange, currency, bar_size: barSize, duration });
      return ibFetch<IBOHLCBar[]>(`/ohlc/${symbol}?${params}`);
    },

    /** All open orders */
    async getOrders(): Promise<IBOrder[]> {
      return ibFetch<IBOrder[]>('/orders');
    },

    /**
     * Place or validate an order.
     * validate_only defaults to true — no real order will be sent unless you explicitly set it to false.
     */
    async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
      return ibFetch<PlaceOrderResult>('/order', {
        method: 'POST',
        body: JSON.stringify({ validate_only: true, ...req }),
      });
    },

    /**
     * Place a bracket order: market entry + native IB stop-loss + take-profit.
     * All three orders are linked via parentId so IB manages exits automatically,
     * surviving any process restart.
     * validate_only defaults to true — no real orders sent unless explicitly false.
     */
    async placeBracketOrder(req: PlaceBracketOrderRequest): Promise<PlaceBracketOrderResult> {
      return ibFetch<PlaceBracketOrderResult>('/bracket-order', {
        method: 'POST',
        body: JSON.stringify({ validate_only: true, ...req }),
      });
    },

    /** Cancel an open order by IB order ID */
    async cancelOrder(orderId: number): Promise<{ cancelled: boolean; order_id: number }> {
      return ibFetch(`/order/${orderId}`, { method: 'DELETE' });
    },
  };
}
