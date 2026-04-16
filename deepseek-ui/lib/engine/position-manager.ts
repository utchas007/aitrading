/**
 * Position Manager
 *
 * Handles:
 *   - Updating active positions with live P&L from IB tickers
 *   - Detecting IB-native bracket order closes (SL/TP fired on IB's side)
 *   - Paper-mode manual SL/TP check (when no native IB orders exist)
 *   - Recovering open positions from the DB on engine restart
 *
 * This module extracts updatePositions() and recoverPositions() from TradingEngine.
 */

import type { ActivePosition } from '../trading-engine';
import { createIBClient } from '../ib-client';
import { createRiskManager } from '../risk-management';
import { logActivity } from '../activity-logger';
import { saveNotification } from '../notify';
import { createLogger } from '../logger';

const log = createLogger('position-manager');

export interface PositionManagerConfig {
  autoExecute: boolean;
  stopLossPercent: number;
  takeProfitPercent: number;
}

/**
 * Refresh P&L for all active positions and detect IB-native closes.
 * Mutates the `activePositions` Map in place — removes closed positions.
 */
export async function updatePositions(
  activePositions: Map<string, ActivePosition>,
  config: PositionManagerConfig,
): Promise<void> {
  if (activePositions.size === 0) return;

  const ib = createIBClient();
  const riskManager = createRiskManager({
    stopLossPercent:   config.stopLossPercent,
    takeProfitPercent: config.takeProfitPercent,
  });

  let ibPositions: Awaited<ReturnType<typeof ib.getPositions>> = [];
  if (config.autoExecute) {
    try {
      ibPositions = await ib.getPositions();
    } catch {
      // Non-fatal; P&L update continues without close detection this cycle
    }
  }

  for (const [txid, position] of activePositions) {
    // Update price + P&L
    try {
      const ticker = await ib.getTicker(position.pair);
      const currentPrice = ticker.last ?? ticker.close ?? position.currentPrice;
      position.currentPrice = currentPrice;

      if (position.type === 'buy') {
        position.pnl        = (currentPrice - position.entryPrice) * position.volume;
        position.pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      } else {
        position.pnl        = (position.entryPrice - currentPrice) * position.volume;
        position.pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
      }

      // Log progress toward profit target
      if (position.expectedProfitUSD && position.expectedProfitUSD > 0) {
        const progressPct = Math.min(((position.pnl / position.expectedProfitUSD) * 100), 100).toFixed(1);
        const progressBar =
          '█'.repeat(Math.floor(parseFloat(progressPct) / 10)) +
          '░'.repeat(10 - Math.floor(parseFloat(progressPct) / 10));
        logActivity.info(
          `📈 ${position.pair} — P&L: $${position.pnl.toFixed(2)} / target $${position.expectedProfitUSD.toFixed(2)} ` +
          `[${progressBar}] ${progressPct}% | ` +
          `SL: $${position.stopLoss.toFixed(2)} (-$${position.expectedLossUSD?.toFixed(2) ?? '?'}) | ` +
          `TP: $${position.takeProfit.toFixed(2)}`,
        );
      }
    } catch {
      // Price fetch failed; keep previous values
    }

    if (config.autoExecute) {
      // Native bracket mode: detect close by checking IB position
      const ibPos = ibPositions.find((p) => p.symbol === position.pair && p.position > 0);
      if (!ibPos) {
        const closeReason = position.pnl >= 0 ? 'take_profit' : 'stop_loss';
        log.info('IB bracket closed position', {
          pair: position.pair, closeReason,
          pnl: position.pnl.toFixed(2), pnlPct: position.pnlPercent.toFixed(2),
        });
        logActivity.completed(
          `✅ Position closed by IB — ${position.pair} | P&L: $${position.pnl.toFixed(2)} ` +
          `(${position.pnlPercent.toFixed(2)}%) | Reason: ${closeReason}`,
        );
        saveNotification(
          'trade_closed',
          `Position Closed — ${position.pair}`,
          `${closeReason.replace('_', ' ')} hit | P&L: $${position.pnl.toFixed(2)} (${position.pnlPercent.toFixed(2)}%)`,
          position.pair,
        );

        if (position.dbTradeId) {
          import('../db').then(({ prisma }) =>
            prisma.trade.update({
              where: { id: position.dbTradeId },
              data: {
                exitPrice:   position.currentPrice,
                pnl:         position.pnl,
                pnlPercent:  position.pnlPercent,
                status:      'closed',
                closedAt:    new Date(),
                closeReason,
              },
            }),
          ).catch((e) => log.error('DB failed to update trade on close', { error: String(e) }));
        }

        activePositions.delete(txid);
      }
    } else {
      // Paper mode: manual SL/TP check
      const shouldClose = riskManager.shouldClosePosition({
        pair:         position.pair,
        type:         position.type,
        entryPrice:   position.entryPrice,
        volume:       position.volume,
        stopLoss:     position.stopLoss,
        takeProfit:   position.takeProfit,
        currentPrice: position.currentPrice,
      });

      if (shouldClose.shouldClose) {
        log.info('Paper position closed', {
          pair:    position.pair,
          reason:  shouldClose.reason,
          entry:   position.entryPrice.toFixed(2),
          current: position.currentPrice.toFixed(2),
          pnl:     position.pnl.toFixed(2),
        });
        logActivity.completed(
          `✅ Paper position closed — ${position.pair} | P&L: $${position.pnl.toFixed(2)} ` +
          `(${position.pnlPercent.toFixed(2)}%) | Reason: ${shouldClose.reason}`,
        );
        activePositions.delete(txid);
      }
    }
  }
}

/**
 * Recover open positions from the DB after a restart.
 * Cross-references DB open trades with actual IB positions:
 *   - IB still holds shares → restore to activePositions
 *   - IB no longer holds shares → mark trade closed in DB
 */
export async function recoverPositions(
  activePositions: Map<string, ActivePosition>,
): Promise<void> {
  try {
    const { prisma } = await import('../db');
    const openTrades = await prisma.trade.findMany({
      where: { status: 'open' },
      select: {
        id: true, pair: true, type: true, entryPrice: true, volume: true,
        stopLoss: true, takeProfit: true, txid: true, createdAt: true,
        slOrderId: true, tpOrderId: true,
        expectedProfitUSD: true, expectedLossUSD: true, riskRewardRatio: true,
      },
    });

    if (openTrades.length === 0) return;

    logActivity.info(`🔄 Found ${openTrades.length} open trade(s) in DB — verifying with IB...`);

    const ib = createIBClient();
    let ibPositions: Awaited<ReturnType<typeof ib.getPositions>> = [];
    try {
      ibPositions = await ib.getPositions();
    } catch {
      logActivity.warning('Position recovery: cannot reach IB. Will retry on next update cycle.');
      return;
    }

    let recovered = 0;
    let markedClosed = 0;

    for (const trade of openTrades) {
      const ibPos = ibPositions.find((p) => p.symbol === trade.pair && p.position > 0);

      if (ibPos) {
        const posId = trade.txid ?? `${trade.pair}-${trade.id}`;
        activePositions.set(posId, {
          txid:              posId,
          pair:              trade.pair,
          type:              trade.type as 'buy' | 'sell',
          entryPrice:        trade.entryPrice,
          volume:            ibPos.position,
          stopLoss:          trade.stopLoss,
          takeProfit:        trade.takeProfit,
          currentPrice:      trade.entryPrice,
          pnl:               0,
          pnlPercent:        0,
          timestamp:         trade.createdAt.getTime(),
          dbTradeId:         trade.id,
          parentOrderId:     trade.txid ? (parseInt(trade.txid) || undefined) : undefined,
          slOrderId:         trade.slOrderId         ?? undefined,
          tpOrderId:         trade.tpOrderId         ?? undefined,
          expectedProfitUSD: trade.expectedProfitUSD ?? undefined,
          expectedLossUSD:   trade.expectedLossUSD   ?? undefined,
          riskRewardRatio:   trade.riskRewardRatio   ?? undefined,
        });
        recovered++;

        const slInfo     = trade.slOrderId         ? ` | SL order #${trade.slOrderId}` : '';
        const tpInfo     = trade.tpOrderId         ? ` | TP order #${trade.tpOrderId}` : '';
        const profitInfo = trade.expectedProfitUSD ? ` | 🎯 Target: +$${trade.expectedProfitUSD.toFixed(2)}` : '';
        const lossInfo   = trade.expectedLossUSD   ? ` | 🛡️ Max loss: -$${trade.expectedLossUSD.toFixed(2)}` : '';
        logActivity.info(
          `✅ Recovered: ${trade.pair} | ${ibPos.position} shares @ $${trade.entryPrice.toFixed(2)} | ` +
          `SL: $${trade.stopLoss.toFixed(2)}${slInfo} | TP: $${trade.takeProfit.toFixed(2)}${tpInfo}${profitInfo}${lossInfo}`,
        );
      } else {
        logActivity.warning(`⚠️ ${trade.pair} trade #${trade.id} not in IB positions — marking closed (offline close)`);
        await prisma.trade.update({
          where: { id: trade.id },
          data: { status: 'closed', closedAt: new Date(), closeReason: 'closed_while_offline' },
        });
        markedClosed++;
      }
    }

    if (recovered > 0 || markedClosed > 0) {
      logActivity.info(`🔄 Recovery complete: ${recovered} position(s) restored, ${markedClosed} marked closed (offline)`);
      if (recovered > 0) logActivity.info('ℹ️  Native IB bracket orders are still active — SL/TP protection is intact');
    }
  } catch (err) {
    logActivity.error(`Position recovery failed: ${err}`);
  }
}
