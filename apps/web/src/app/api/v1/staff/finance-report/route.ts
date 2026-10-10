import { type NextRequest } from 'next/server';
import { financeCsv } from '@texholiday/admin';
import { DomainError } from '@texholiday/contracts';
import { admin, currentSession } from '../../../../../server/admin';
import { actorOf } from '../../../../../server/admin-forms';
import { errorResponse } from '../../../../../server/http';

export const dynamic = 'force-dynamic';

/** Line-level finance CSV of a period (P15b): `?from=YYYY-MM-DD&to=YYYY-MM-DD`. orders.view_financials only. */
export async function GET(req: NextRequest) {
  try {
    const s = await currentSession();
    if (!s || s.stage !== 'ACTIVE') throw new DomainError('FORBIDDEN', 'Forbidden', { httpStatus: 403 });
    const from = req.nextUrl.searchParams.get('from') ?? '';
    const to = req.nextUrl.searchParams.get('to') ?? '';
    // The query checks the permission and the period.
    const lines = await admin().finance.lines(actorOf(s.staff), { from, to });
    return new Response(financeCsv(lines), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="texholiday-finans-${from}_${to}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
