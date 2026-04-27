/**
 * GET /api/health
 *
 * System health check — verifies all critical dependencies are reachable.
 * Returns a detailed status for each service.
 *
 * Response:
 *   200 — all dependencies healthy
 *   503 — one or more dependencies are degraded or unreachable
 *
 * Shape:
 *   {
 *     status: 'ok' | 'degraded',
 *     services: {
 *       database:  { status: 'ok' | 'error', latencyMs: number, error?: string },
 *       ib:        { status: 'ok' | 'error' | 'unavailable', latencyMs: number, connected?: boolean },
 *       ollama:    { status: 'ok' | 'error' | 'unavailable', latencyMs: number, models?: string[] },
 *       worldmonitor: { status: 'ok' | 'error' | 'unavailable', latencyMs: number },
 *     },
 *     timestamp: string,
 *     uptime: number,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCorrelation } from '@/lib/correlation';
import { createLogger } from '@/lib/logger';
import { TIMEOUTS } from '@/lib/timeouts';

const log = createLogger('api/health');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IB_SERVICE_URL     = process.env.IB_SERVICE_URL     || 'http://localhost:8765';
const OLLAMA_API_URL     = process.env.OLLAMA_API_URL     || 'http://localhost:11434';
const WORLDMONITOR_URL   = process.env.WORLDMONITOR_URL   || 'http://localhost:3000';

interface ServiceHealth {
  status: 'ok' | 'error' | 'unavailable';
  latencyMs: number;
  error?: string;
  [key: string]: unknown;
}

async function checkWithTimeout(fn: () => Promise<ServiceHealth>, timeoutMs: number): Promise<ServiceHealth> {
  try {
    return await Promise.race([
      fn(),
      new Promise<ServiceHealth>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  } catch (err: unknown) {
    return { status: 'unavailable', latencyMs: timeoutMs, error: String(err) };
  }
}

async function checkDatabase(): Promise<ServiceHealth> {
  const t = Date.now();
  try {
    const { prisma } = await import('@/lib/db');
    // Simple ping — count 1 row from the smallest table
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - t };
  } catch (err: unknown) {
    return { status: 'error', latencyMs: Date.now() - t, error: String(err) };
  }
}

async function checkIB(): Promise<ServiceHealth> {
  const t = Date.now();
  try {
    const res = await fetch(`${IB_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });
    if (!res.ok) return { status: 'error', latencyMs: Date.now() - t, error: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      status:    data.connected ? 'ok' : 'error',
      latencyMs: Date.now() - t,
      connected: data.connected ?? false,
      accounts:  data.accounts ?? [],
    };
  } catch (err: unknown) {
    return { status: 'unavailable', latencyMs: Date.now() - t, error: String(err) };
  }
}

async function checkOllama(): Promise<ServiceHealth> {
  const t = Date.now();
  try {
    const res = await fetch(`${OLLAMA_API_URL}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });
    if (!res.ok) return { status: 'error', latencyMs: Date.now() - t, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models: string[] = (data.models ?? []).map((m: { name: string }) => m.name);
    return { status: 'ok', latencyMs: Date.now() - t, models, modelCount: models.length };
  } catch (err: unknown) {
    return { status: 'unavailable', latencyMs: Date.now() - t, error: String(err) };
  }
}

async function checkWorldMonitor(): Promise<ServiceHealth> {
  const t = Date.now();
  try {
    const res = await fetch(`${WORLDMONITOR_URL}/api/indices`, {
      signal: AbortSignal.timeout(TIMEOUTS.HEALTH_MS),
    });
    if (!res.ok) return { status: 'error', latencyMs: Date.now() - t, error: `HTTP ${res.status}` };
    return { status: 'ok', latencyMs: Date.now() - t };
  } catch (err: unknown) {
    // World Monitor is optional — return 'unavailable' (not 'error') so overall status doesn't degrade
    return { status: 'unavailable', latencyMs: Date.now() - t, error: String(err) };
  }
}

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    const timeout = TIMEOUTS.HEALTH_MS;

    const [database, ib, ollama, worldmonitor] = await Promise.all([
      checkWithTimeout(checkDatabase,     timeout),
      checkWithTimeout(checkIB,           timeout),
      checkWithTimeout(checkOllama,       timeout),
      checkWithTimeout(checkWorldMonitor, timeout),
    ]);

    const services = { database, ib, ollama, worldmonitor };

    // Overall status for display purposes
    const criticalOk = database.status === 'ok' && ib.status !== 'error';
    const ollamaOk   = ollama.status === 'ok';
    const overallStatus = criticalOk && ollamaOk ? 'ok' : 'degraded';

    // HTTP status: only fail (503) if the database is down — IB/Ollama being
    // offline is expected when TWS isn't running, and must not break the
    // Docker healthcheck which gates other containers starting.
    const httpStatus = database.status === 'ok' ? 200 : 503;

    log.debug('Health check complete', {
      status: overallStatus,
      db:     database.status,
      ib:     ib.status,
      ollama: ollama.status,
    });

    return NextResponse.json(
      {
        status:    overallStatus,
        services,
        timestamp: new Date().toISOString(),
        uptime:    process.uptime(),
        version:   process.env.npm_package_version ?? '0.1.0',
      },
      { status: httpStatus },
    );
  });
}
