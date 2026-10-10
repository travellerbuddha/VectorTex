import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../../server/booking';
import { errorResponse } from '../../../../../server/http';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { app } = await booking();
    return NextResponse.json(await app.searchSession(id));
  } catch (err) {
    return errorResponse(err);
  }
}
