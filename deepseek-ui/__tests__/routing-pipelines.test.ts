import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../lib/correlation', () => ({
  withCorrelation: (_req: unknown, fn: () => unknown) => fn(),
  generateRequestId: () => 'test-id',
  getRequestId: () => 'test-id',
}));

const envBackup = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env = { ...envBackup };
});

afterEach(() => {
  process.env = { ...envBackup };
});

describe('Trading engine standalone bot routing', () => {
  it('uses BOT_URL override for standalone status probe', async () => {
    process.env.BOT_URL = 'http://localhost:4555';
    delete process.env.BOT_PORT;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, status: { isRunning: false }, activities: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../app/api/trading/engine/route');
    const req = new NextRequest('http://localhost:3001/api/trading/engine');
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4555/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('uses BOT_PORT fallback when BOT_URL is not set', async () => {
    delete process.env.BOT_URL;
    process.env.BOT_PORT = '4666';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, status: { isRunning: false }, activities: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../app/api/trading/engine/route');
    const req = new NextRequest('http://localhost:3001/api/trading/engine');
    await GET(req);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4666/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('World Monitor proxy routing', () => {
  it('defaults WORLDMONITOR_URL to localhost:3000', async () => {
    delete process.env.WORLDMONITOR_URL;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html>ok</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../app/api/worldmonitor/data/route');
    const req = new NextRequest('http://localhost:3001/api/worldmonitor/data');
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/?variant=finance',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.any(String),
          'User-Agent': expect.any(String),
        }),
      }),
    );
  });
});
