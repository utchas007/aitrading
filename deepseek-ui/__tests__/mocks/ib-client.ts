/**
 * Mock IB client — replaces live IB service calls in tests.
 * Import in test files with:
 *   vi.mock('../../lib/ib-client', () => import('./mocks/ib-client'))
 */

import { vi } from 'vitest';

export const createIBClient = vi.fn(() => ({
  getHealth: vi.fn().mockResolvedValue({ connected: true }),
  getTicker: vi.fn().mockResolvedValue({
    last: 150, close: 150, bid: 149.9, ask: 150.1, volume: 1_000_000,
  }),
  getBalance: vi.fn().mockResolvedValue({
    AvailableFunds_USD: '50000',
    NetLiquidation_USD: '100000',
  }),
  getPositions: vi.fn().mockResolvedValue([]),
  getOrders: vi.fn().mockResolvedValue([]),
  placeOrder: vi.fn().mockResolvedValue({
    validate_only: true, commission: 1.5, max_commission: 2.0,
    init_margin: '0', maint_margin: '0', equity_change: '-15000',
  }),
  placeBracketOrder: vi.fn().mockResolvedValue({
    validate_only: false,
    parent_order_id: 1001,
    stop_loss_order_id: 1002,
    take_profit_order_id: 1003,
    status: 'Submitted',
  }),
  cancelOrder: vi.fn().mockResolvedValue({ cancelled: true, order_id: 1001 }),
  getOHLC: vi.fn().mockResolvedValue([]),
}));
