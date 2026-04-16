/**
 * Startup validation — fail fast if required env vars are missing or invalid.
 *
 * Import this module once at the top of any long-lived server entry point
 * (e.g. scripts/trading-bot.ts, websocket-server.ts) to catch misconfigurations
 * before the process starts doing real work.
 *
 * Next.js API routes do NOT call this directly (they are serverless and short-lived),
 * but each critical route already guards its own required vars at request time.
 *
 * Usage:
 *   import '@/lib/startup-check';
 */

interface EnvSpec {
  name: string;
  required: boolean;
  description: string;
  validate?: (value: string) => string | null; // return error message or null if valid
}

const ENV_SPECS: EnvSpec[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    description: 'PostgreSQL connection string (postgresql://user:pass@host:port/db)',
    validate: (v) =>
      v.startsWith('postgresql://') || v.startsWith('postgres://')
        ? null
        : 'Must start with postgresql:// or postgres://',
  },
  {
    name: 'IB_SERVICE_URL',
    required: false,
    description: 'URL of ib_service.py (default: http://localhost:8765)',
    validate: (v) => {
      try { new URL(v); return null; } catch { return 'Must be a valid URL'; }
    },
  },
  {
    name: 'OLLAMA_API_URL',
    required: false,
    description: 'URL of the local Ollama instance (default: http://localhost:11434)',
    validate: (v) => {
      try { new URL(v); return null; } catch { return 'Must be a valid URL'; }
    },
  },
  {
    name: 'OLLAMA_MODEL',
    required: false,
    description: 'Ollama model name for AI analysis (default: deepseek-r1:14b)',
  },
  {
    name: 'WORLDMONITOR_URL',
    required: false,
    description: 'URL of the WorldMonitor service (default: http://localhost:3000)',
    validate: (v) => {
      try { new URL(v); return null; } catch { return 'Must be a valid URL'; }
    },
  },
  {
    name: 'LOG_LEVEL',
    required: false,
    description: 'Log level: debug | info | warn | error (default: info)',
    validate: (v) =>
      ['debug', 'info', 'warn', 'error'].includes(v.toLowerCase())
        ? null
        : 'Must be one of: debug | info | warn | error',
  },
  {
    name: 'NODE_ENV',
    required: false,
    description: 'Node environment: development | production | test',
    validate: (v) =>
      ['development', 'production', 'test'].includes(v)
        ? null
        : 'Must be one of: development | production | test',
  },
];

function runStartupCheck(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const spec of ENV_SPECS) {
    const value = process.env[spec.name];

    if (!value) {
      if (spec.required) {
        errors.push(`[MISSING] ${spec.name} — ${spec.description}`);
      } else {
        // Optional — just note it's not set (only at debug level, not logged here)
      }
      continue;
    }

    if (spec.validate) {
      const err = spec.validate(value);
      if (err) {
        if (spec.required) {
          errors.push(`[INVALID] ${spec.name}="${value}" — ${err}`);
        } else {
          warnings.push(`[INVALID] ${spec.name}="${value}" — ${err} (using default)`);
        }
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Startup configuration warnings:');
    warnings.forEach((w) => console.warn(`   ${w}`));
    console.warn('');
  }

  if (errors.length > 0) {
    console.error('\n❌ Startup validation FAILED — missing or invalid required configuration:\n');
    errors.forEach((e) => console.error(`   ${e}`));
    console.error(
      '\n   See deepseek-ui/env.local.example.txt for all variables and valid values.\n',
    );
    process.exit(1);
  }
}

// Run immediately on import
runStartupCheck();
