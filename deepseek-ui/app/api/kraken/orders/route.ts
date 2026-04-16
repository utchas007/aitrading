import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/kraken/orders');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Fetch open and closed orders
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const { searchParams } = new URL(req.url);
      const type = searchParams.get('type') || 'open'; // 'open' or 'closed'

      const kraken = createKrakenClient();

      let orders;
      if (type === 'closed') {
        orders = await kraken.getClosedOrders();
      } else {
        orders = await kraken.getOpenOrders();
      }

      return NextResponse.json({
        success: true,
        orders,
        type,
      });
    } catch (error: any) {
      log.error('Kraken orders fetch error', { error: error.message });
      return apiError(error.message || 'Failed to fetch orders', 'KRAKEN_ERROR');
    }
  });
}

// POST - Place a new order
export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const body = await req.json();
      const { pair, type, ordertype, volume, price, validate } = body;

      // Validation
      if (!pair || !type || !ordertype || !volume) {
        return apiError('Missing required fields: pair, type, ordertype, volume', 'VALIDATION_ERROR', { status: 400 });
      }

      if (type !== 'buy' && type !== 'sell') {
        return apiError('Type must be "buy" or "sell"', 'VALIDATION_ERROR', { status: 400 });
      }

      if (ordertype === 'limit' && !price) {
        return apiError('Price is required for limit orders', 'VALIDATION_ERROR', { status: 400 });
      }

      const kraken = createKrakenClient();
      const result = await kraken.addOrder({
        pair,
        type,
        ordertype,
        volume,
        price,
        validate: validate || false, // Set to true for testing without actually placing order
      });

      return NextResponse.json({
        success: true,
        order: result,
        message: validate ? 'Order validated successfully (not placed)' : 'Order placed successfully',
      });
    } catch (error: any) {
      log.error('Kraken order placement error', { error: error.message });
      return apiError(error.message || 'Failed to place order', 'KRAKEN_ERROR');
    }
  });
}

// DELETE - Cancel an order
export async function DELETE(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const { searchParams } = new URL(req.url);
      const txid = searchParams.get('txid');

      if (!txid) {
        return apiError('Transaction ID (txid) is required', 'VALIDATION_ERROR', { status: 400 });
      }

      const kraken = createKrakenClient();
      const result = await kraken.cancelOrder(txid);

      return NextResponse.json({
        success: true,
        result,
        message: 'Order cancelled successfully',
      });
    } catch (error: any) {
      log.error('Kraken order cancellation error', { error: error.message });
      return apiError(error.message || 'Failed to cancel order', 'KRAKEN_ERROR');
    }
  });
}
