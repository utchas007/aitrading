import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Fetch open and closed orders
export async function GET(req: NextRequest) {
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
    console.error('Kraken orders fetch error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}

// POST - Place a new order
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pair, type, ordertype, volume, price, validate } = body;

    // Validation
    if (!pair || !type || !ordertype || !volume) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: pair, type, ordertype, volume' },
        { status: 400 }
      );
    }

    if (type !== 'buy' && type !== 'sell') {
      return NextResponse.json(
        { success: false, error: 'Type must be "buy" or "sell"' },
        { status: 400 }
      );
    }

    if (ordertype === 'limit' && !price) {
      return NextResponse.json(
        { success: false, error: 'Price is required for limit orders' },
        { status: 400 }
      );
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
    console.error('Kraken order placement error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to place order' },
      { status: 500 }
    );
  }
}

// DELETE - Cancel an order
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const txid = searchParams.get('txid');

    if (!txid) {
      return NextResponse.json(
        { success: false, error: 'Transaction ID (txid) is required' },
        { status: 400 }
      );
    }

    const kraken = createKrakenClient();
    const result = await kraken.cancelOrder(txid);

    return NextResponse.json({
      success: true,
      result,
      message: 'Order cancelled successfully',
    });
  } catch (error: any) {
    console.error('Kraken order cancellation error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to cancel order' },
      { status: 500 }
    );
  }
}
