import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { DomainError, isDomainError } from '@texholiday/contracts';

/** Error body of the public API (§14): code, message, requestId, retryable, action. No provider internals. */
export function errorResponse(err: unknown): NextResponse {
  const requestId = randomUUID();
  if (isDomainError(err)) {
    const issues = (err as { issues?: unknown }).issues;
    return NextResponse.json(
      { code: err.code, message: err.message, requestId, retryable: err.retryable, action: err.action, ...(Array.isArray(issues) ? { issues } : {}) },
      { status: err.httpStatus },
    );
  }
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled API error', requestId, error: err instanceof Error ? err.message : String(err) }));
  return NextResponse.json({ code: 'INTERNAL', message: 'Unexpected error', requestId, retryable: true, action: 'RETRY' }, { status: 500 });
}

/** Same-origin check for state-changing requests (CSRF): browsers always send Origin on cross-site POSTs. */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) {
    throw new DomainError('FORBIDDEN', 'Cross-site request refused', { httpStatus: 403 });
  }
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'Request body must be JSON', { httpStatus: 400 });
  }
}

const cookieName = (orderId: string) => `th_order_${orderId.replace(/-/g, '')}`;

/** Order access token in an httpOnly cookie: never in URLs (the provider return URL carries no secret). */
export function setOrderCookie(res: NextResponse, orderId: string, token: string): void {
  res.cookies.set(cookieName(orderId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 86_400,
  });
}

export async function orderToken(orderId: string): Promise<string | null> {
  return (await cookies()).get(cookieName(orderId))?.value ?? null;
}

export { originOf } from './origin';
