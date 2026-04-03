import crypto from 'crypto';

export interface KrakenBalance {
  [currency: string]: string;
}

export interface KrakenTicker {
  a: [string, string, string]; // ask [price, whole lot volume, lot volume]
  b: [string, string, string]; // bid [price, whole lot volume, lot volume]
  c: [string, string]; // last trade closed [price, lot volume]
  v: [string, string]; // volume [today, last 24 hours]
  p: [string, string]; // volume weighted average price [today, last 24 hours]
  t: [number, number]; // number of trades [today, last 24 hours]
  l: [string, string]; // low [today, last 24 hours]
  h: [string, string]; // high [today, last 24 hours]
  o: string; // today's opening price
}

export interface KrakenOrder {
  txid: string;
  status: string;
  type: 'buy' | 'sell';
  pair: string;
  price: string;
  volume: string;
  cost: string;
  fee: string;
  time: number;
}

export class KrakenAPI {
  private apiKey: string;
  private apiSecret: string;
  private apiUrl: string = 'https://api.kraken.com';

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /**
   * Generate authentication signature for private API calls
   */
  private getMessageSignature(path: string, request: any, nonce: number): string {
    const message = nonce + new URLSearchParams(request).toString();
    const secret = Buffer.from(this.apiSecret, 'base64');
    const hash = crypto.createHash('sha256').update(message).digest();
    const hmac = crypto.createHmac('sha512', secret);
    const signature = hmac.update(path + hash.toString('binary'), 'binary').digest('base64');
    return signature;
  }

  /**
   * Make a public API call (no authentication required)
   */
  async publicRequest(endpoint: string, params: any = {}): Promise<any> {
    const url = `${this.apiUrl}/0/public/${endpoint}`;
    const queryString = new URLSearchParams(params).toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    const response = await fetch(fullUrl);
    const data = await response.json();

    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API Error: ${data.error.join(', ')}`);
    }

    return data.result;
  }

  /**
   * Make a private API call (requires authentication)
   */
  async privateRequest(endpoint: string, params: any = {}): Promise<any> {
    const path = `/0/private/${endpoint}`;
    const nonce = Date.now() * 1000;
    const request = { nonce, ...params };

    const signature = this.getMessageSignature(path, request, nonce);

    const response = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': this.apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(request).toString(),
    });

    const data = await response.json();

    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API Error: ${data.error.join(', ')}`);
    }

    return data.result;
  }

  /**
   * Get server time (public)
   */
  async getServerTime(): Promise<{ unixtime: number; rfc1123: string }> {
    return await this.publicRequest('Time');
  }

  /**
   * Get ticker information for trading pairs (public)
   */
  async getTicker(pairs: string[]): Promise<{ [pair: string]: KrakenTicker }> {
    return await this.publicRequest('Ticker', { pair: pairs.join(',') });
  }

  /**
   * Get account balance (private)
   */
  async getBalance(): Promise<KrakenBalance> {
    return await this.privateRequest('Balance');
  }

  /**
   * Get trade balance and total portfolio value (private)
   */
  async getTradeBalance(): Promise<{
    eb: string; // equivalent balance (combined balance of all currencies)
    tb: string; // trade balance (combined balance of all equity currencies)
    m: string; // margin amount of open positions
    n: string; // unrealized net profit/loss of open positions
    c: string; // cost basis of open positions
    v: string; // current floating valuation of open positions
    e: string; // equity = trade balance + unrealized net profit/loss
    mf: string; // free margin = equity - initial margin (maximum margin available to open new positions)
  }> {
    return await this.privateRequest('TradeBalance', { asset: 'ZCAD' });
  }

  /**
   * Get open orders (private)
   */
  async getOpenOrders(): Promise<{ open: { [txid: string]: any } }> {
    return await this.privateRequest('OpenOrders');
  }

  /**
   * Get closed orders (private)
   */
  async getClosedOrders(params: { start?: number; end?: number } = {}): Promise<any> {
    return await this.privateRequest('ClosedOrders', params);
  }

  /**
   * Place a new order (private)
   */
  async addOrder(params: {
    pair: string;
    type: 'buy' | 'sell';
    ordertype: 'market' | 'limit';
    volume: string;
    price?: string;
    validate?: boolean;
  }): Promise<{ descr: { order: string }; txid: string[] }> {
    // For market orders, don't send price parameter at all
    const orderParams: any = {
      pair: params.pair,
      type: params.type,
      ordertype: params.ordertype,
      volume: params.volume,
    };
    
    // Only add price for limit orders
    if (params.ordertype === 'limit' && params.price) {
      orderParams.price = params.price;
    }
    
    // Add validate flag if present
    if (params.validate !== undefined) {
      orderParams.validate = params.validate;
    }
    
    return await this.privateRequest('AddOrder', orderParams);
  }

  /**
   * Cancel an open order (private)
   */
  async cancelOrder(txid: string): Promise<{ count: number; pending: boolean }> {
    return await this.privateRequest('CancelOrder', { txid });
  }

  /**
   * Get OHLC (candlestick) data (public)
   */
  async getOHLC(pair: string, interval: number = 1): Promise<any> {
    return await this.publicRequest('OHLC', { pair, interval });
  }

  /**
   * Get order book (public)
   */
  async getOrderBook(pair: string, count: number = 10): Promise<any> {
    return await this.publicRequest('Depth', { pair, count });
  }

  /**
   * Get recent trades (public)
   */
  async getRecentTrades(pair: string, since?: number): Promise<any> {
    const params: any = { pair };
    if (since) params.since = since;
    return await this.publicRequest('Trades', params);
  }
}

/**
 * Create a Kraken API client instance
 */
export function createKrakenClient(apiKey?: string, apiSecret?: string): KrakenAPI {
  const key = apiKey || process.env.KRAKEN_API_KEY;
  const secret = apiSecret || process.env.KRAKEN_PRIVATE_KEY;

  if (!key || !secret) {
    throw new Error('Kraken API credentials not found. Please set KRAKEN_API_KEY and KRAKEN_PRIVATE_KEY in .env.local');
  }

  return new KrakenAPI(key, secret);
}
