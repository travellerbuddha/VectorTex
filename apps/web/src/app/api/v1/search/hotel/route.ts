import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../../server/booking';
import { assertSameOrigin, errorResponse, readJson } from '../../../../../server/http';

/** POST /api/v1/search/hotel: creates a search session (§14). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { app } = await booking();
    const view = await app.searchHotels(await readJson(req));
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
