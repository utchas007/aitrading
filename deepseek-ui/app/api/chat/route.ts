import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createKrakenClient } from '@/lib/kraken';
import { createIBClient } from '@/lib/ib-client';
import { getMarketContextForAI } from '@/lib/worldmonitor-data';
import { apiError } from '@/lib/api-response';
import { TIMEOUTS } from '@/lib/timeouts';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';
import { validate } from '@/lib/validation';

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role:    z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1).max(20_000).trim(),
      }),
    )
    .min(1, 'At least one message required')
    .max(100, 'Too many messages in context (max 100)'),
  model:       z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens:  z.number().int().min(1).max(32_000).optional(),
  system:      z.string().max(10_000).optional(),
});

const log = createLogger('api/chat');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Allow up to 2 minutes for AI response

// ─── Trade command detection & execution ─────────────────────────────────────

const KNOWN_SYMBOLS = ['AAPL','MSFT','NVDA','TSLA','GOOGL','AMZN','META','AMD',
                       'JPM','V','JNJ','XOM','CRM','PLTR','SNOW','GS','CVX','PFE',
                       'SPY','QQQ','GLD'];

// Bot defaults — keep in sync with trading-engine config
const STOP_LOSS_PCT   = 0.05;  // 5% below entry
const TAKE_PROFIT_PCT = 0.10;  // 10% above entry
const RISK_PER_TRADE  = 0.05;  // 5% of available cash per trade

interface TradeCommandResult {
  executed: boolean;
  symbol?: string;
  quantity?: number;
  action?: 'sell' | 'buy';
  orderId?: number;
  status?: string;
  message: string;
  error?: string;
}

interface ParsedCommand {
  action: 'sell' | 'buy';
  symbol: string;
  /** number of shares, dollar amount (prefixed $), or 'all' (sell only) */
  quantity: number | 'all';
  isDollarAmount?: boolean;
}

/**
 * Parse the user message for explicit trade commands.
 *
 * Strategy: look for sell/buy keyword + any known symbol anywhere in the
 * message. This handles any natural phrasing without brittle word-order rules:
 *   "sell the META shares", "can you sell my AMZN for me",
 *   "please go ahead and sell META", "buy 10 NVDA shares",
 *   "buy $500 worth of AAPL", "I'd like to sell my TSLA position"
 */
function parseTradeCommand(text: string): ParsedCommand | null {
  const normalized = text.toLowerCase().trim();

  const isSell = /\bsell\b/.test(normalized);
  const isBuy  = /\bbuy\b/.test(normalized);
  if (!isSell && !isBuy) return null;
  const action: 'sell' | 'buy' = isSell ? 'sell' : 'buy';

  // Find any known symbol mentioned anywhere in the message
  const symbol = KNOWN_SYMBOLS.find(s => new RegExp(`\\b${s}\\b`, 'i').test(text));
  if (!symbol) return null;

  let quantity: number | 'all' = action === 'sell' ? 'all' : 0;
  let isDollarAmount = false;

  // Dollar amount: "$500 worth", "$1000"
  const dollarMatch = text.match(/\$(\d+(?:\.\d+)?)/);
  if (dollarMatch) {
    isDollarAmount = true;
    quantity = parseFloat(dollarMatch[1]);
    return { action, symbol, quantity, isDollarAmount };
  }

  // Explicit share count: "10 shares", "sell 50 META", "buy 10 NVDA"
  const qtyMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:shares?)?\b/i);
  if (qtyMatch) {
    const n = parseFloat(qtyMatch[1]);
    // Ignore small standalone numbers that are likely prices/percentages not quantities
    // Only treat as quantity if it's a reasonable share count (>= 1)
    if (n >= 1 && n < 100000) {
      quantity = n;
    }
  }

  // "all", "everything", "entire", "whole" → sell all
  if (/\b(all|everything|entire|whole|position)\b/i.test(text)) {
    quantity = 'all';
  }

  return { action, symbol, quantity, isDollarAmount };
}

/** Fetch latest price from OHLC (ticker returns null for paper accounts without live data subscription) */
async function getLatestPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `http://localhost:8765/ohlc/${symbol}?bar_size=5+mins&duration=1+D`,
      { signal: AbortSignal.timeout(TIMEOUTS.HISTORICAL_MS) }
    );
    if (!res.ok) return null;
    const bars: Array<{ close: number }> = await res.json();
    return bars.length > 0 ? bars[bars.length - 1].close : null;
  } catch {
    return null;
  }
}

/**
 * Execute a trade command against the IB service.
 * Sell → market order for the held position.
 * Buy  → bracket order (GTC stop-loss + take-profit, matching bot config).
 */
async function executeTradeCommand(cmd: ParsedCommand): Promise<TradeCommandResult> {
  try {
    const ib = createIBClient();

    // ── SELL ──────────────────────────────────────────────────────────────
    if (cmd.action === 'sell') {
      const positions = await ib.getPositions();
      const pos = positions.find((p: any) => p.symbol === cmd.symbol && p.position > 0);

      if (!pos) {
        return {
          executed: false, symbol: cmd.symbol, action: 'sell',
          message: `No open position found for ${cmd.symbol} in your IB account.`,
          error: 'no_position',
        };
      }

      const qty = cmd.quantity === 'all'
        ? pos.position
        : Math.min(cmd.quantity as number, pos.position);

      const res = await fetch('http://localhost:8765/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: cmd.symbol, action: 'SELL',
          quantity: qty, order_type: 'MKT', validate_only: false,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        return {
          executed: false, symbol: cmd.symbol, quantity: qty, action: 'sell',
          message: `Failed to place sell order for ${cmd.symbol}: ${err.detail}`,
          error: err.detail,
        };
      }

      const order = await res.json();
      return {
        executed: true, symbol: cmd.symbol, quantity: qty, action: 'sell',
        orderId: order.order_id, status: order.status,
        message: `✅ SELL order placed: ${qty} shares of ${cmd.symbol} at market (Order #${order.order_id}, status: ${order.status}). Your avg cost was $${pos.avg_cost.toFixed(2)}/share.`,
      };
    }

    // ── BUY ───────────────────────────────────────────────────────────────
    // 1. Get current price
    const price = await getLatestPrice(cmd.symbol);
    if (!price || price <= 0) {
      return {
        executed: false, symbol: cmd.symbol, action: 'buy',
        message: `Could not fetch a live price for ${cmd.symbol}. Try again in a moment.`,
        error: 'no_price',
      };
    }

    // 2. Determine share quantity
    let qty: number;
    if (cmd.isDollarAmount && typeof cmd.quantity === 'number') {
      // User said "$500 worth"
      qty = Math.floor((cmd.quantity as number) / price);
    } else if (typeof cmd.quantity === 'number' && cmd.quantity > 0) {
      // User specified shares directly
      qty = Math.floor(cmd.quantity as number);
    } else {
      // Auto-size: 5% of available cash
      const balance = await ib.getBalance().catch(() => ({})) as Record<string, string>;
      const cashKey = Object.keys(balance).find((k: string) => k.startsWith('AvailableFunds_'));
      const cash = cashKey ? parseFloat(balance[cashKey]) : 10000;
      qty = Math.floor((cash * RISK_PER_TRADE) / price);
    }

    if (qty < 1) {
      return {
        executed: false, symbol: cmd.symbol, action: 'buy',
        message: `Quantity rounded to 0 shares for ${cmd.symbol} at $${price.toFixed(2)} — not enough cash or amount too small.`,
        error: 'qty_zero',
      };
    }

    // 3. Calculate bracket levels (same as bot)
    const stopLoss   = parseFloat((price * (1 - STOP_LOSS_PCT)).toFixed(2));
    const takeProfit = parseFloat((price * (1 + TAKE_PROFIT_PCT)).toFixed(2));
    const entryLimit = parseFloat((price * 1.005).toFixed(2)); // 0.5% slippage buffer

    // 4. Place bracket order (GTC children via ib_service)
    const res = await fetch('http://localhost:8765/bracket-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: cmd.symbol, action: 'BUY',
        quantity: qty,
        limit_price: entryLimit,
        stop_loss_price: stopLoss,
        take_profit_price: takeProfit,
        validate_only: false,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      return {
        executed: false, symbol: cmd.symbol, quantity: qty, action: 'buy',
        message: `Failed to place buy order for ${cmd.symbol}: ${err.detail}`,
        error: err.detail,
      };
    }

    const order = await res.json();

    const expectedProfitUSD = parseFloat((qty * (takeProfit - price)).toFixed(2));
    const expectedLossUSD   = parseFloat((qty * (price - stopLoss)).toFixed(2));
    const riskReward        = expectedLossUSD > 0
      ? (expectedProfitUSD / expectedLossUSD).toFixed(2)
      : 'N/A';

    // Persist to DB so the profit target survives restarts
    try {
      const { prisma } = await import('@/lib/db');
      await prisma.trade.create({
        data: {
          pair:              cmd.symbol,
          type:              'buy',
          entryPrice:        price,
          volume:            qty,
          stopLoss,
          takeProfit,
          status:            'open',
          txid:              order.parent_order_id?.toString() ?? null,
          slOrderId:         order.stop_loss_order_id   ?? null,
          tpOrderId:         order.take_profit_order_id ?? null,
          expectedProfitUSD,
          expectedLossUSD,
          riskRewardRatio:   parseFloat(riskReward) || null,
        },
      });
    } catch (dbErr: any) {
      log.error('Failed to save trade to DB', { error: dbErr.message });
    }

    return {
      executed: true, symbol: cmd.symbol, quantity: qty, action: 'buy',
      orderId: order.parent_order_id, status: order.status,
      message: `✅ BUY bracket order placed: ${qty} shares of ${cmd.symbol} @ limit $${entryLimit} | Stop-loss: $${stopLoss} (-$${expectedLossUSD}) | Take-profit: $${takeProfit} (+$${expectedProfitUSD}) | R:R ${riskReward} | Both SL and TP are GTC and will survive restarts.`,
    };
  } catch (err: any) {
    return {
      executed: false, symbol: cmd.symbol, action: cmd.action,
      message: `Trade execution error for ${cmd.symbol}: ${err.message}`,
      error: err.message,
    };
  }
}

export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const rawBody = await req.json();
    const parsed = validate(rawBody, chatRequestSchema);
    if ('errorResponse' in parsed) return parsed.errorResponse;
    const { messages, model = 'deepseek-r1:14b', temperature = 0.7, max_tokens = 6000, system } = parsed.data;

    // ── Detect & execute trade commands from the latest user message ──────────
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    let tradeResult: TradeCommandResult | null = null;
    if (lastUserMsg) {
      const cmd = parseTradeCommand(lastUserMsg.content);
      if (cmd) {
        tradeResult = await executeTradeCommand(cmd);
        log.info('Trade command executed', { executed: tradeResult.executed, symbol: tradeResult.symbol, action: tradeResult.action });
      }
    }

    // Fetch real-time market data
    const t0 = Date.now();
    const marketContext = await fetchMarketContext();
    log.debug('Market data fetch complete', { ms: Date.now() - t0 });

    // Build time context so AI knows current date, time, and market session
    const now = new Date();
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etHour = etNow.getHours();
    const etMin  = etNow.getMinutes();
    const etDay  = etNow.getDay();
    const isWeekend = etDay === 0 || etDay === 6;
    const isPreMarket    = !isWeekend && etHour >= 4  && (etHour < 9  || (etHour === 9  && etMin < 30));
    const isRegularHours = !isWeekend && (etHour > 9 || (etHour === 9 && etMin >= 30)) && etHour < 16;
    const isAfterHours   = !isWeekend && etHour >= 16 && etHour < 20;
    const marketSession  = isWeekend ? 'Weekend (market closed)'
      : isPreMarket    ? 'Pre-market (4:00–9:30 AM ET)'
      : isRegularHours ? 'Regular hours (9:30 AM–4:00 PM ET)'
      : isAfterHours   ? 'After-hours (4:00–8:00 PM ET)'
      : 'Market closed';
    const timeContext = `CURRENT TIME & MARKET SESSION:
Date/Time (UTC): ${now.toUTCString()}
Eastern Time: ${etNow.toLocaleString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', timeZoneName:'short', timeZone:'America/New_York' })}
Market Session: ${marketSession}
US markets open: Monday–Friday 9:30 AM–4:00 PM ET\n`;

    // Build the prompt from messages with live market data
    let prompt = '';
    if (system) {
      prompt += `System: ${system}\n\n`;
    }

    // Define AI capabilities so it knows what data sources it's connected to
    const capabilitiesContext = `
=== YOUR DATA CONNECTIONS & CAPABILITIES ===
You are connected to the following LIVE data sources:

1. INTERACTIVE BROKERS (IB) - Stock trading broker
   - Real-time stock prices for watchlist (AAPL, MSFT, NVDA, TSLA, GOOGL, AMZN, META, AMD)
   - Account balance, buying power, open positions
   - Order execution capability (paper trading)

2. KRAKEN - Cryptocurrency exchange
   - Live crypto prices (BTC, ETH, SOL in CAD)
   - Portfolio balance and trade history
   - Trading capability

3. WORLD MONITOR - Global intelligence
   - Real-time commodity prices (Oil, Gold, Silver, Natural Gas)
   - Global market indices (S&P 500, Dow, NASDAQ, FTSE, DAX, Nikkei, Hang Seng)
   - Geopolitical risk assessment and hotspots
   - Breaking financial news from multiple sources

4. YAHOO FINANCE - Fallback data source
   - Stock prices when IB is unavailable
   - Technical data

5. AUTOMATED TRADING BOT
   - Running analysis every 5 minutes
   - Recent bot signals and activity
   - Technical indicators (RSI, MACD, etc.)

You have FULL visibility into all this data below. Use it to provide informed, specific answers.
DO NOT say you don't have access to markets, finance, or tech - you absolutely do!
===\n`;

    // Inject trade execution result if a command was detected
    let tradeContext = '';
    if (tradeResult) {
      tradeContext = `\n=== TRADE JUST EXECUTED BY YOU ===\n${tradeResult.message}\n(Confirm this action to the user in your response and provide any relevant market commentary.)\n===\n`;
    }

    // Inject capabilities + time + market context at the top
    prompt += `${capabilitiesContext}\n${timeContext}\nCURRENT MARKET DATA:\n${marketContext}\n${tradeContext}\n`;
    
    messages.forEach((msg: { role: string; content: string }) => {
      if (msg.role === 'user') {
        prompt += `User: ${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        prompt += `Assistant: ${msg.content}\n\n`;
      }
    });
    
    prompt += 'Assistant: ';

    // Check if streaming is requested
    const url = new URL(req.url);
    const useStreaming = url.searchParams.get('stream') === 'true';

    // Connect to local Ollama instance
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: useStreaming,
        options: {
          temperature: temperature,
          num_predict: max_tokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    // If streaming, return a ReadableStream
    if (useStreaming && response.body) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const chunk = decoder.decode(value, { stream: true });
              // Ollama returns newline-delimited JSON
              const lines = chunk.split('\n').filter(line => line.trim());
              
              for (const line of lines) {
                try {
                  const json = JSON.parse(line);
                  if (json.response) {
                    // Send just the text token
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: json.response, done: json.done })}\n\n`));
                  }
                  if (json.done) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
                  }
                } catch (e) {
                  // Skip malformed JSON
                }
              }
            }
          } finally {
            reader.releaseLock();
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming response
    const data = await response.json();

    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const estimatedTokens = Math.ceil(data.response.length / 4);

    return NextResponse.json({
      response: data.response,
      model: model,
      done: data.done,
      tokens: estimatedTokens,
    });
  } catch (error: any) {
    log.error('Chat API error', { error: error.message });
    return apiError(error.message || 'Failed to generate response', 'INTERNAL_ERROR');
  }
  });
}

// Key stocks to always include in context
const WATCHLIST_STOCKS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD'];

/**
 * Fetch stock data from Interactive Brokers and compute technicals
 */
// Fetch with hard timeout — never blocks the chat
async function fetchWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function fetchStockContext(): Promise<string> {
  try {
    const ib = createIBClient();

    // Hard 4s timeout on balance + positions — skip if IB is slow
    const [ibBalance, positions] = await Promise.all([
      fetchWithTimeout(ib.getBalance(), 4000, {} as any),
      fetchWithTimeout(ib.getPositions(), 4000, []),
    ]);

    const netLiq = ibBalance['NetLiquidation_CAD'] ?? ibBalance['NetLiquidation_USD'] ?? '0';
    const cash = ibBalance['TotalCashValue_CAD'] ?? ibBalance['TotalCashValue_USD'] ?? '0';
    const buyingPower = ibBalance['BuyingPower_CAD'] ?? ibBalance['BuyingPower_USD'] ?? '0';
    const unrealizedPnL = ibBalance['UnrealizedPnL_CAD'] ?? ibBalance['UnrealizedPnL_BASE'] ?? '0';

    let context = `\n=== IB PAPER ACCOUNT ===\n`;
    if (netLiq !== '0') {
      context += `Net Liquidation: $${parseFloat(netLiq).toLocaleString()}\n`;
      context += `Cash Available: $${parseFloat(cash).toLocaleString()}\n`;
      context += `Buying Power: $${parseFloat(buyingPower).toLocaleString()}\n`;
      context += `Unrealized P&L: $${parseFloat(unrealizedPnL).toFixed(2)}\n`;
    } else {
      context += `Balance data unavailable\n`;
    }

    if (positions.length > 0) {
      context += `\nOpen Positions:\n`;
      positions.forEach((p: any) => {
        context += `  ${p.symbol}: ${p.position} shares @ avg $${p.avg_cost.toFixed(2)}\n`;
      });
    } else {
      context += `Open Positions: None\n`;
    }

    // Use Yahoo Finance for quick prices — no OHLC, no technicals, just last price
    // This is for chat context only — trading engine does the deep analysis
    context += `\n=== STOCK PRICES (Yahoo Finance) ===\n`;
    const priceResults = await Promise.allSettled(
      WATCHLIST_STOCKS.map(async (symbol) => {
        const res = await fetchWithTimeout(
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(TIMEOUTS.TICKER_MS),
          }).then(r => r.json()),
          3500,
          null
        );
        const meta = res?.chart?.result?.[0]?.meta;
        if (!meta) return null;
        const price = meta.regularMarketPrice ?? 0;
        const prev  = meta.chartPreviousClose ?? price;
        const change = prev > 0 ? (((price - prev) / prev) * 100).toFixed(2) : '0.00';
        return { symbol, price, change };
      })
    );

    priceResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        const { symbol, price, change } = result.value;
        const arrow = parseFloat(change) >= 0 ? '▲' : '▼';
        context += `${symbol}: $${price.toFixed(2)} ${arrow}${change}%\n`;
      } else {
        context += `${WATCHLIST_STOCKS[i]}: unavailable\n`;
      }
    });

    return context;
  } catch (error) {
    log.error('Failed to fetch IB stock context', { error: String(error) });
    return '\n=== IB STOCK DATA ===\nData temporarily unavailable.\n';
  }
}

/**
 * Fetch current market context for AI including crypto (Kraken), stocks (IB), and World Monitor geopolitical data
 */
async function fetchMarketContext(): Promise<string> {
  // Run crypto, stock, and world monitor fetches in parallel
  const [cryptoContext, stockContext, worldContext] = await Promise.allSettled([
    fetchCryptoContext(),
    fetchStockContext(),
    fetchWithTimeout(getMarketContextForAI(), 8000, ''),
  ]);

  let context = '';
  context += cryptoContext.status === 'fulfilled' ? cryptoContext.value : 'Crypto data unavailable.\n';
  context += stockContext.status === 'fulfilled' ? stockContext.value : '\nStock data unavailable.\n';
  
  // Add World Monitor global data
  const wmData = worldContext.status === 'fulfilled' ? worldContext.value : '';
  if (wmData) {
    context += '\n' + wmData;
  }
  
  return context;
}

/**
 * Fetch crypto context from Kraken + news + geopolitical data
 */
async function fetchCryptoContext(): Promise<string> {
  try {
    const kraken = createKrakenClient();
    
    // Parallel fetch with hard 4s timeout each — never block chat
    const [balance, tradeBalance, ticker, newsData, engineData, wmData] = await Promise.all([
      fetchWithTimeout(kraken.getBalance(), 4000, {}),
      fetchWithTimeout(kraken.getTradeBalance(), 4000, { eb: '0', tb: '0', m: '0', n: '0', c: '0', v: '0', e: '0', mf: '0' }),
      fetchWithTimeout(kraken.getTicker(['XXBTZCAD', 'XETHZCAD', 'SOLCAD']), 4000, {}),
      fetchWithTimeout(
        fetch('http://localhost:3001/api/worldmonitor/news?category=markets&limit=5', { signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS) })
          .then(r => r.json()).catch(() => ({ success: false })),
        TIMEOUTS.HEALTH_MS + 1000, { success: false }
      ),
      fetchWithTimeout(
        fetch('http://localhost:3001/api/trading/engine', { signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS) })
          .then(r => r.json()).catch(() => ({ success: false })),
        TIMEOUTS.HEALTH_MS + 1000, { success: false }
      ),
      fetchWithTimeout(
        fetch('http://localhost:3000/api/conflict/v1/worldmonitor.conflict.v1.ConflictService/ListConflicts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 5 }),
          signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
        }).then(r => r.json()).catch(() => ({})),
        TIMEOUTS.HEALTH_MS + 1000, {}
      ),
    ]);

    const news = newsData.success ? newsData.news : [];
    const latestActivity = engineData.success ? engineData.activities?.slice(0, 3) : [];
    
    // Build World Monitor geopolitical context
    let worldMonitorData = '';
    if (wmData.conflicts && wmData.conflicts.length > 0) {
      worldMonitorData = `\n=== GEOPOLITICAL EVENTS (World Monitor) ===\n`;
      wmData.conflicts.slice(0, 3).forEach((conflict: any, i: number) => {
        worldMonitorData += `${i + 1}. ${conflict.name || 'Conflict'} - ${conflict.status || 'Active'}\n`;
      });
    }
    
    // Build context string with portfolio information
    let context = `=== CRYPTO PORTFOLIO (Kraken) — ${new Date().toLocaleString()} ===\n`;
    context += `Total Value: $${parseFloat(tradeBalance.eb).toFixed(2)} CAD\n`;
    context += `Equity: $${parseFloat(tradeBalance.e).toFixed(2)} CAD\n`;
    context += `\nCrypto Holdings:\n`;
    Object.entries(balance).forEach(([currency, amount]) => {
      const value = parseFloat(amount as string);
      if (value > 0.0001) {
        context += `  ${currency}: ${value.toFixed(8)}\n`;
      }
    });
    
    context += `\n=== LIVE CRYPTO PRICES ===\n`;
    Object.entries(ticker).forEach(([pair, data]) => {
      context += `${pair}: $${parseFloat(data.c[0]).toLocaleString()} (24h Vol: ${parseFloat(data.v[1]).toFixed(2)})\n`;
    });
    
    context += `\n=== LATEST FINANCIAL NEWS ===\n`;
    news.slice(0, 3).forEach((item: any, i: number) => {
      context += `${i + 1}. ${item.title} (${item.source}, ${new Date(item.pubDate).toLocaleTimeString()})\n`;
    });
    
    if (worldMonitorData) {
      context += worldMonitorData;
    }
    
    context += `\n=== BOT'S RECENT ANALYSIS ===\n`;
    latestActivity.forEach((activity: any) => {
      context += `- ${activity.message}\n`;
    });
    
    return context;
  } catch (error) {
    log.error('Failed to fetch crypto market context', { error: String(error) });
    return 'Crypto market data temporarily unavailable.';
  }
}
