import { NextResponse, type NextRequest } from 'next/server';
import { DomainError } from '@texholiday/contracts';
import { booking } from '../../../../../server/booking';
import { allowAttempt, currentSession } from '../../../../../server/admin';
import { errorResponse } from '../../../../../server/http';

/**
 * Hotel name search for the hotel list editor (ADR-0014): `?q=<name>&country=<ISO-2>`. Content staff only, since each
 * call is a provider request; the staff cookie is SameSite=strict, so another site cannot make this call for them.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await currentSession();
    if (!s || s.stage !== 'ACTIVE' || !(s.staff.permissions.has('content.edit') || s.staff.permissions.has('content.publish'))) {
      throw new DomainError('FORBIDDEN', 'Forbidden', { httpStatus: 403 });
    }
    if (!(await allowAttempt(`hotel-names:${s.staff.id}`, 60, 60_000))) {
      throw new DomainError('RATE_LIMITED', 'Too many searches; wait a minute', { httpStatus: 429, retryable: true, action: 'RETRY' });
    }
    const q = req.nextUrl.searchParams.get('q') ?? '';
    const country = (req.nextUrl.searchParams.get('country') ?? '').trim().toUpperCase();
    const lang = req.nextUrl.searchParams.get('lang') === 'en' ? 'en' : 'tr';
    const { app } = await booking();
    return NextResponse.json({ data: await app.hotelsByName(q, country, lang) });
  } catch (err) {
    return errorResponse(err);
  }
}
