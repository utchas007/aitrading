import { NextRequest, NextResponse } from 'next/server';
import { createKrakenClient } from '@/lib/kraken';
import { logActivity } from '@/lib/activity-logger';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/test-trade');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Test trade endpoint - Buy $10 worth of TAO
 */
export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    logActivity.info('🧪 Starting test trade: Buying $10 worth of TAO...');
    
    const kraken = createKrakenClient();
    
    // Get current BTC price (using CAD pair - BTC is always available)
    const ticker = await kraken.getTicker(['XXBTZCAD']);
    const btcPrice = parseFloat(ticker['XXBTZCAD'].c[0]);
    
    logActivity.info(`📊 Current BTC price: $${btcPrice.toFixed(2)} CAD`);
    
    // Calculate how much BTC we can buy with $10 CAD
    const cadAmount = 10;
    let btcAmount = cadAmount / btcPrice;
    
    // Ensure we meet minimum (0.0001 BTC)
    const minBTC = 0.0001;
    if (btcAmount < minBTC) {
      btcAmount = minBTC;
      logActivity.warning(`Adjusted to minimum: ${minBTC} BTC (~$${(minBTC * btcPrice).toFixed(2)} CAD)`);
    }
    
    logActivity.info(`💰 Buying ${btcAmount.toFixed(8)} BTC (~$${(btcAmount * btcPrice).toFixed(2)} CAD)`);
    
    // Place the order
    logActivity.executing('⚡ Placing BUY order on Kraken...');
    
    const result = await kraken.addOrder({
      pair: 'XXBTZCAD',
      type: 'buy',
      ordertype: 'market',
      volume: btcAmount.toFixed(8),
      validate: false, // REAL ORDER!
    });
    
    logActivity.completed(`✅ SUCCESS! Bought ${btcAmount.toFixed(8)} BTC`);
    logActivity.completed(`📝 Transaction ID: ${result.txid.join(', ')}`);
    logActivity.completed(`💵 Spent: ~$${(btcAmount * btcPrice).toFixed(2)} CAD`);
    
    return NextResponse.json({
      success: true,
      message: 'Test trade executed successfully!',
      details: {
        pair: 'XXBTZCAD',
        amount: btcAmount,
        price: btcPrice,
        total: btcAmount * btcPrice,
        txid: result.txid,
      },
    });
    
  } catch (error: any) {
    log.error('Test trade failed', { error: error.message });
    logActivity.error(`❌ Test trade failed: ${error.message}`);

    return apiError(error.message, 'KRAKEN_ERROR');
  }
  });
}
