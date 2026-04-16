/**
 * Next.js middleware — runs at the edge before every /api/* request.
 *
 * Reads X-Request-ID from the incoming request if present; otherwise generates
 * a new 8-character hex ID. The ID is forwarded on both the proxied request
 * (so route handlers can read it via req.headers.get('x-request-id')) and the
 * outgoing response (so clients can correlate their requests in logs).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Generate a random 8-char hex ID using the Web Crypto API (edge-safe). */
function generateRequestId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function middleware(request: NextRequest) {
  const id = request.headers.get('x-request-id') ?? generateRequestId();

  // Propagate the ID on the forwarded request so route handlers can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', id);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Echo it back on the response so clients can trace their requests
  response.headers.set('x-request-id', id);

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
