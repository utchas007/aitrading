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

async function ibFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${IB_SERVICE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(`IB Service error ${res.status}: ${err.detail ?? JSON.stringify(err)}`);
  }
  return res.json() as Promise<T>;
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

    /** Cancel an open order by IB order ID */
    async cancelOrder(orderId: number): Promise<{ cancelled: boolean; order_id: number }> {
      return ibFetch(`/order/${orderId}`, { method: 'DELETE' });
    },
  };
}
