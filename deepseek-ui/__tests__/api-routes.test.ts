/**
 * Unit tests for Next.js API routes.
 * All external services (DB, IB, Ollama) are mocked so tests run offline.
 *
 * Pattern: import the route handler directly and call GET/POST with a mock Request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Global mocks ─────────────────────────────────────────────────────────────

vi.mock('../lib/db', () => ({
  prisma: {
    notification: {
      findMany:    vi.fn().mockResolvedValue([]),
      count:       vi.fn().mockResolvedValue(0),
      create:      vi.fn().mockResolvedValue({ id: 1, type: 'info', title: 'Test', message: 'msg', pair: null, read: false, createdAt: new Date() }),
      update:      vi.fn().mockResolvedValue({}),
      updateMany:  vi.fn().mockResolvedValue({ count: 0 }),
    },
    portfolioSnapshot: {
      findMany:    vi.fn().mockResolvedValue([]),
      create:      vi.fn().mockResolvedValue({ id: 1, totalValue: 50000, createdAt: new Date() }),
    },
    activityLog: {
      findMany:    vi.fn().mockResolvedValue([]),
      create:      vi.fn().mockResolvedValue({ id: 1 }),
    },
  },
  default: {
    notification: {
      findMany:    vi.fn().mockResolvedValue([]),
      count:       vi.fn().mockResolvedValue(0),
      create:      vi.fn().mockResolvedValue({ id: 1, type: 'info', title: 'Test', message: 'msg', pair: null, read: false, createdAt: new Date() }),
      update:      vi.fn().mockResolvedValue({}),
      updateMany:  vi.fn().mockResolvedValue({ count: 0 }),
    },
    portfolioSnapshot: {
      findMany:    vi.fn().mockResolvedValue([]),
      create:      vi.fn().mockResolvedValue({ id: 1, totalValue: 50000, createdAt: new Date() }),
    },
    activityLog: {
      findMany:    vi.fn().mockResolvedValue([]),
      create:      vi.fn().mockResolvedValue({ id: 1 }),
    },
  },
}));

vi.mock('../lib/correlation', () => ({
  withCorrelation: (_req: unknown, fn: () => unknown) => fn(),
  generateRequestId: () => 'test-id',
  getRequestId: () => 'test-id',
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  url: string,
  options: { method?: string; body?: Record<string, unknown>; searchParams?: Record<string, string> } = {},
): NextRequest {
  const { method = 'GET', body, searchParams } = options;
  const fullUrl = searchParams
    ? `${url}?${new URLSearchParams(searchParams).toString()}`
    : url;
  return new NextRequest(fullUrl, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
}

// ─── /api/notifications ───────────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  it('returns success:true and empty notifications array', async () => {
    const { GET } = await import('../app/api/notifications/route');
    const req = makeRequest('http://localhost:3001/api/notifications');
    const res = await GET(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(Array.isArray(json.notifications)).toBe(true);
    expect(typeof json.unreadCount).toBe('number');
  });
});

describe('POST /api/notifications', () => {
  it('creates a notification with valid body', async () => {
    const { POST } = await import('../app/api/notifications/route');
    const req = makeRequest('http://localhost:3001/api/notifications', {
      method: 'POST',
      body: { type: 'trade_executed', title: 'BUY AAPL', message: '10 shares at $150' },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.notification).toBeDefined();
  });

  it('returns 400 for missing required fields', async () => {
    const { POST } = await import('../app/api/notifications/route');
    const req = makeRequest('http://localhost:3001/api/notifications', {
      method: 'POST',
      body: { title: 'Missing type and message' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('marks all notifications as read', async () => {
    const { POST } = await import('../app/api/notifications/route');
    const req = makeRequest('http://localhost:3001/api/notifications', {
      method: 'POST',
      body: { action: 'markAllRead' },
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

// ─── /api/portfolio/history ───────────────────────────────────────────────────

describe('GET /api/portfolio/history', () => {
  it('returns success:true with empty history', async () => {
    const { GET } = await import('../app/api/portfolio/history/route');
    const req = makeRequest('http://localhost:3001/api/portfolio/history', {
      searchParams: { days: '7', limit: '100' },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(Array.isArray(json.history)).toBe(true);
    expect(json.summary).toBeDefined();
    expect(typeof json.summary.count).toBe('number');
  });
});

// ─── /api/config/schema ───────────────────────────────────────────────────────

describe('GET /api/config/schema', () => {
  it('returns config entries in non-production', async () => {
    // NODE_ENV is 'test' in vitest — schema endpoint should be allowed
    const { GET } = await import('../app/api/config/schema/route');
    const req = makeRequest('http://localhost:3001/api/config/schema');
    const res = await GET(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(Array.isArray(json.config)).toBe(true);
    expect(json.config.length).toBeGreaterThan(0);

    // Every entry should have key, value, isSet, default, description
    const entry = json.config[0];
    expect(entry).toHaveProperty('key');
    expect(entry).toHaveProperty('value');
    expect(entry).toHaveProperty('isSet');
    expect(entry).toHaveProperty('default');
    expect(entry).toHaveProperty('description');
  });

  it('redacts DATABASE_URL value', async () => {
    process.env.DATABASE_URL = 'postgresql://user:secret@localhost:5432/db';
    const { GET } = await import('../app/api/config/schema/route');
    const req = makeRequest('http://localhost:3001/api/config/schema');
    const res = await GET(req);
    const json = await res.json();

    const dbEntry = json.config.find((e: { key: string }) => e.key === 'DATABASE_URL');
    expect(dbEntry).toBeDefined();
    expect(dbEntry.value).not.toContain('secret');
    expect(dbEntry.value).toContain('redacted');
  });
});
