import { NextResponse, type NextRequest } from 'next/server';
import { DomainError } from '@texholiday/contracts';
import { booking } from '../../../../../../server/booking';
import { assertSameOrigin, errorResponse, orderToken } from '../../../../../../server/http';

/** MOCK environment only: completes the simulated provider payment. Refused everywhere else. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const { app, mock, settings } = await booking();
    if (!mock || settings.environment !== 'mock') throw new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });
    const session = await app.paymentSession(id, await orderToken(id));
    if (session.state !== 'READY') throw new DomainError('VALIDATION_FAILED', 'No open payment', { httpStatus: 409 });
    const transactionId = session.secretKey.replace(/^MOCK_secret_/, '');
    mock.hotels.markPaid(transactionId);
    mock.flights.markPaid(transactionId);
    return NextResponse.json({ paid: true });
  } catch (err) {
    return errorResponse(err);
  }
}
