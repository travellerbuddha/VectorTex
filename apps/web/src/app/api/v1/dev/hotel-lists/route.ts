import { NextResponse, type NextRequest } from 'next/server';
import { DomainError } from '@texholiday/contracts';
import { booking } from '../../../../../server/booking';
import { currentSession } from '../../../../../server/admin';
import { assertSameOrigin, errorResponse } from '../../../../../server/http';

/**
 * MOCK environment only: runs the hotel list price scanner (normally the worker's job, ADR-0014) on this process's MOCK
 * hotel connector until nothing is due. Needs a signed-in content publisher. Refused everywhere else.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { app, mock, settings } = await booking();
    if (!mock || settings.environment !== 'mock') throw new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });
    const s = await currentSession();
    if (!s || s.stage !== 'ACTIVE' || !s.staff.permissions.has('content.publish')) throw new DomainError('FORBIDDEN', 'Forbidden', { httpStatus: 403 });
    const steps = await app.hotelListScanner(`web-mock-${process.pid}`, { sleep: async () => {} }).runUntilIdle();
    return NextResponse.json({ steps });
  } catch (err) {
    return errorResponse(err);
  }
}
