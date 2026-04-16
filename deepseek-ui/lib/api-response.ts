import { NextResponse } from 'next/server';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IB_ERROR'
  | 'KRAKEN_ERROR'
  | 'DB_ERROR'
  | 'EXTERNAL_API_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

interface ApiErrorOptions {
  status?: number;
  extra?: Record<string, unknown>;
}

/**
 * Returns a standardized error response for all API routes.
 *
 * Shape: { success: false, error: string, code: ErrorCode, timestamp: string, ...extra }
 *
 * @param message  Human-readable error description
 * @param code     Machine-readable error code (used for programmatic handling)
 * @param options  Optional HTTP status (default 500) and extra fields to merge in
 */
export function apiError(
  message: string,
  code: ErrorCode = 'INTERNAL_ERROR',
  { status = 500, extra }: ApiErrorOptions = {},
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code,
      timestamp: new Date().toISOString(),
      ...extra,
    },
    { status },
  );
}
