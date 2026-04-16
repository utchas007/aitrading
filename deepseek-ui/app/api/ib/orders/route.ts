import { NextRequest, NextResponse } from 'next/server';
import { createIBClient } from '@/lib/ib-client';
import { apiError } from '@/lib/api-response';
import { withCorrelation } from '@/lib/correlation';

// GET /api/ib/orders  — list open orders
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const ib = createIBClient();
      const orders = await ib.getOrders();
      return NextResponse.json({ success: true, orders });
    } catch (error: any) {
      return apiError(error.message, 'IB_ERROR');
    }
  });
}

// POST /api/ib/orders  — place or validate an order
// Body: { symbol, action, quantity, order_type, limit_price?, validate_only? }
// validate_only defaults to true — NO real order until you explicitly pass false
export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const body = await req.json();
      const ib = createIBClient();
      const result = await ib.placeOrder({ validate_only: true, ...body });
      return NextResponse.json({ success: true, result });
    } catch (error: any) {
      return apiError(error.message, 'IB_ERROR');
    }
  });
}

// DELETE /api/ib/orders?orderId=123  — cancel an order
export async function DELETE(req: NextRequest) {
  return withCorrelation(req, async () => {
    const orderId = Number(new URL(req.url).searchParams.get('orderId'));
    if (!orderId) {
      return apiError('orderId is required', 'VALIDATION_ERROR', { status: 400 });
    }
    try {
      const ib = createIBClient();
      const result = await ib.cancelOrder(orderId);
      return NextResponse.json({ success: true, result });
    } catch (error: any) {
      return apiError(error.message, 'IB_ERROR');
    }
  });
}
