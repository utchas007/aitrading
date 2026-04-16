/**
 * Alerting Module
 *
 * Sends critical alerts when:
 *   - The trading bot crashes or unexpectedly stops
 *   - Account balance drops by more than a configurable threshold
 *   - IB connection is lost for an extended period
 *
 * Current channels:
 *   - Database notification record (always — shows in UI)
 *   - Webhook (optional — set ALERT_WEBHOOK_URL for Slack/Discord/n8n)
 *   - Email (optional — future, placeholder)
 *
 * Configuration env vars:
 *   ALERT_WEBHOOK_URL  — Webhook URL (Slack/Discord incoming webhook)
 *   ALERT_BOT_TOKEN    — Bot token for authenticated webhook calls (optional)
 *   ALERT_BALANCE_DROP_PCT — % drop from peak balance to trigger alert (default: 5)
 */

import { createLogger } from './logger';

const log = createLogger('alerting');

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL ?? '';
const BALANCE_DROP_THRESHOLD = parseFloat(process.env.ALERT_BALANCE_DROP_PCT ?? '5');

export type AlertLevel = 'info' | 'warning' | 'critical';

export interface Alert {
  level:   AlertLevel;
  title:   string;
  message: string;
  context?: Record<string, unknown>;
}

/** Send alert to all configured channels. Never throws. */
export async function sendAlert(alert: Alert): Promise<void> {
  log.warn(`ALERT [${alert.level.toUpperCase()}]: ${alert.title}`, { message: alert.message, ...alert.context });

  // 1. Persist to DB (shows in UI notification panel)
  try {
    const { prisma } = await import('./db');
    await prisma.notification.create({
      data: {
        type:    `alert_${alert.level}`,
        title:   `[${alert.level.toUpperCase()}] ${alert.title}`,
        message: alert.message,
        pair:    null,
      },
    });
  } catch (e: unknown) {
    log.error('Failed to persist alert to DB', { error: String(e) });
  }

  // 2. Send to webhook (Slack/Discord/n8n) if configured
  if (WEBHOOK_URL) {
    try {
      const emoji = alert.level === 'critical' ? '🚨' : alert.level === 'warning' ? '⚠️' : 'ℹ️';
      const payload = {
        text: `${emoji} *Trading Bot Alert — ${alert.title}*\n${alert.message}`,
        attachments: alert.context
          ? [{ text: JSON.stringify(alert.context, null, 2), color: alert.level === 'critical' ? 'danger' : 'warning' }]
          : undefined,
      };
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(5000),
      });
    } catch (e: unknown) {
      log.error('Failed to send webhook alert', { error: String(e) });
    }
  }
}

// ─── Balance monitor ──────────────────────────────────────────────────────────

let peakBalance: number | null = null;
let balanceDropAlerted = false;

/**
 * Check if portfolio balance has dropped significantly from the peak.
 * Call this once per market cycle with the current account net liquidation value.
 */
export async function checkBalanceDrop(currentBalance: number): Promise<void> {
  if (currentBalance <= 0) return;

  if (peakBalance === null || currentBalance > peakBalance) {
    peakBalance = currentBalance;
    balanceDropAlerted = false; // Reset alert flag when new peak is set
    return;
  }

  const dropPct = ((peakBalance - currentBalance) / peakBalance) * 100;
  if (dropPct >= BALANCE_DROP_THRESHOLD && !balanceDropAlerted) {
    balanceDropAlerted = true;
    await sendAlert({
      level:   'critical',
      title:   'Account Balance Drop Alert',
      message:
        `Portfolio balance dropped ${dropPct.toFixed(2)}% from peak ` +
        `($${peakBalance.toFixed(2)} → $${currentBalance.toFixed(2)}). ` +
        `Threshold: ${BALANCE_DROP_THRESHOLD}%.`,
      context: { peakBalance, currentBalance, dropPct: dropPct.toFixed(2) },
    });
  }
}

/**
 * Alert when the engine exits unexpectedly.
 * Call from the `uncaughtException` handler in trading-bot.ts.
 */
export async function alertEnginecrash(error: Error): Promise<void> {
  await sendAlert({
    level:   'critical',
    title:   'Trading Bot Crashed',
    message: `The trading bot process crashed: ${error.message}. All open IB bracket orders are still protected by native GTC orders.`,
    context: { error: error.message, stack: error.stack?.split('\n').slice(0, 5).join('\n') },
  });
}

/**
 * Alert when IB connection is lost for too long.
 * @param consecutiveFailures  How many consecutive health check failures
 */
export async function alertIBDisconnected(consecutiveFailures: number): Promise<void> {
  await sendAlert({
    level:   'critical',
    title:   'IB Connection Lost',
    message:
      `Interactive Brokers connection has been unavailable for ${consecutiveFailures} consecutive checks. ` +
      `Ensure TWS/Gateway is running and logged in. All open positions are still protected by native GTC orders.`,
    context: { consecutiveFailures },
  });
}
