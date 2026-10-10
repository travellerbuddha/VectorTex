import { NextResponse, type NextRequest } from 'next/server';
import { flightSales } from '../../../../server/booking';
import { errorResponse } from '../../../../server/http';

/** GET /api/v1/airports?q=: airport autocomplete for the flight search (provider data). */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') ?? '';
    return NextResponse.json({ data: await (await flightSales()).airports(q) });
  } catch (err) {
    return errorResponse(err);
  }
}
