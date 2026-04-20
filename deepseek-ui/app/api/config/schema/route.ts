/**
 * GET /api/config/schema
 *
 * Returns the live runtime configuration with all secrets redacted.
 * Useful for diagnosing misconfiguration without exposing sensitive values.
 *
 * Only available in non-production environments unless ENABLE_CONFIG_SCHEMA=1
 * is explicitly set, to prevent accidental exposure in production.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';
import { effectiveLogLevel } from '@/lib/logger';

const log = createLogger('api/config/schema');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Variables that contain secrets — values are redacted in the response
const SECRET_KEYS = new Set([
  'DATABASE_URL',
  'IB_API_KEY',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
]);

/** Redact a value if it looks like a secret (password in URL, bare key, etc.) */
function redactValue(key: string, value: string | undefined): string {
  if (!value) return '(not set)';
  if (SECRET_KEYS.has(key)) {
    // For connection strings, show scheme + host only
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}/*** (redacted)`;
    } catch {
      return '*** (redacted)';
    }
  }
  return value;
}

interface ConfigEntry {
  key: string;
  value: string;
  isSet: boolean;
  default: string;
  description: string;
}

const CONFIG_SCHEMA: Array<{
  key: string;
  default: string;
  description: string;
  isSecret?: boolean;
}> = [
  {
    key: 'DATABASE_URL',
    default: 'postgresql://tradingbot:***@localhost:5432/tradingdb',
    description: 'PostgreSQL connection string for Prisma',
    isSecret: true,
  },
  {
    key: 'IB_SERVICE_URL',
    default: 'http://localhost:8765',
    description: 'URL of ib_service.py FastAPI server',
  },
  {
    key: 'OLLAMA_API_URL',
    default: 'http://localhost:11434',
    description: 'URL of the local Ollama instance for AI analysis',
  },
  {
    key: 'OLLAMA_MODEL',
    default: 'deepseek-r1:14b',
    description: 'Ollama model used for trading AI sentiment analysis',
  },
  {
    key: 'WORLDMONITOR_URL',
    default: 'http://localhost:3000',
    description: 'URL of the WorldMonitor geopolitical context service',
  },
  {
    key: 'NEXTJS_URL',
    default: 'http://localhost:3001',
    description: 'URL of the Next.js app (used by websocket-server for internal calls)',
  },
  {
    key: 'ACTIVITY_LOG_RETENTION_DAYS',
    default: '90',
    description: 'Days to keep ActivityLog rows before nightly deletion (0 = keep forever)',
  },
  {
    key: 'NOTIFICATION_RETENTION_DAYS',
    default: '90',
    description: 'Days to keep Notification (bell) rows before nightly deletion (0 = keep forever)',
  },
  {
    key: 'CRON_SECRET',
    default: '(not set — endpoint open in dev, blocked in prod)',
    description: 'Secret token for /api/cron/cleanup. Required in production.',
    isSecret: true,
  },
  {
    key: 'LOG_LEVEL',
    default: 'info',
    description: 'Minimum log level: debug | info | warn | error',
  },
  {
    key: 'NODE_ENV',
    default: 'development',
    description: 'Node environment: development | production | test',
  },
  {
    key: 'WS_PORT',
    default: '3002',
    description: 'WebSocket server port',
  },
  {
    key: 'BOT_PORT',
    default: '3003',
    description: 'Standalone trading bot control/status port',
  },
  {
    key: 'BOT_URL',
    default: 'http://localhost:3003',
    description: 'Optional explicit URL override for the standalone trading bot',
  },
  {
    key: 'WS_CORS_ORIGINS',
    default: 'http://localhost:3001,http://localhost:3000',
    description: 'Comma-separated list of allowed CORS origins for the WebSocket server',
  },
  {
    key: 'IB_API_KEY',
    default: '(none — unauthenticated)',
    description: 'Optional API key for ib_service.py authentication',
    isSecret: true,
  },
];

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    // Guard: only allow in non-production unless explicitly enabled
    const isProd = process.env.NODE_ENV === 'production';
    const isExplicitlyEnabled = process.env.ENABLE_CONFIG_SCHEMA === '1';

    if (isProd && !isExplicitlyEnabled) {
      log.warn('Config schema endpoint blocked in production');
      return apiError(
        'Config schema endpoint is disabled in production. Set ENABLE_CONFIG_SCHEMA=1 to enable.',
        'SERVICE_UNAVAILABLE',
        { status: 403 },
      );
    }

    const entries: ConfigEntry[] = CONFIG_SCHEMA.map((spec) => {
      const raw = process.env[spec.key];
      return {
        key: spec.key,
        value: spec.isSecret ? redactValue(spec.key, raw) : (raw ?? '(not set)'),
        isSet: raw !== undefined && raw !== '',
        default: spec.default,
        description: spec.description,
      };
    });

    const missingRequired = entries.filter(
      (e) => !e.isSet && e.key === 'DATABASE_URL',
    );

    log.info('Config schema inspected');

    return NextResponse.json({
      success: true,
      environment: process.env.NODE_ENV ?? 'unknown',
      effectiveLogLevel,
      config: entries,
      warnings: missingRequired.length > 0
        ? missingRequired.map((e) => `${e.key} is not set (required)`)
        : [],
      note: 'All secret values are redacted. Set ENABLE_CONFIG_SCHEMA=1 in production to enable this endpoint.',
    });
  });
}
