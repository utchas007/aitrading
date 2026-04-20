import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activityDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const notificationDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('../lib/db', () => ({
  prisma: {
    activityLog: {
      deleteMany: activityDeleteMany,
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
    },
    notification: {
      deleteMany: notificationDeleteMany,
    },
  },
}));

const envBackup = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env = { ...envBackup };
});

afterEach(() => {
  process.env = { ...envBackup };
});

describe('activity logger retention cleanup', () => {
  it('does not start retention cleanup in test environment', async () => {
    process.env = { ...process.env, NODE_ENV: 'test' };

    await import('../lib/activity-logger');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activityDeleteMany).not.toHaveBeenCalled();
    expect(notificationDeleteMany).not.toHaveBeenCalled();
  });
});
