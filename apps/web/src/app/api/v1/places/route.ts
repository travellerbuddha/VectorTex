import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../server/booking';
import { errorResponse } from '../../../../server/http';

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') ?? '';
    const lang = req.nextUrl.searchParams.get('lang') === 'en' ? 'en' : 'tr';
    const { app } = await booking();
    return NextResponse.json({ data: await app.places(q, lang) });
  } catch (err) {
    return errorResponse(err);
  }
}
