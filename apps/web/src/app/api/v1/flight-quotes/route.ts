import { NextResponse, type NextRequest } from 'next/server';
import { DomainError } from '@texholiday/contracts';
import { flightSales } from '../../../../server/booking';
import { assertSameOrigin, errorResponse, readJson } from '../../../../server/http';

/**
 * POST /api/v1/flight-quotes {sessionId, offerKey}: the provider re-checks the fare and the server stores its own quote;
 * provider offer ids never come from clients.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = (await readJson(req)) as { sessionId?: unknown; offerKey?: unknown };
    if (typeof body.sessionId !== 'string' || typeof body.offerKey !== 'string') throw new DomainError('VALIDATION_FAILED', 'sessionId and offerKey are required', { httpStatus: 422 });
    return NextResponse.json(await (await flightSales()).selectOffer(body.sessionId, body.offerKey), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
