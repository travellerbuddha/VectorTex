import { NextResponse, type NextRequest } from 'next/server';
import { flightSales } from '../../../../../server/booking';
import { assertSameOrigin, errorResponse, readJson } from '../../../../../server/http';

/** POST /api/v1/search/flight: creates a flight search session (§14). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const view = await (await flightSales()).search(await readJson(req));
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
