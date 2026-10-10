import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../../server/booking';
import { errorResponse, orderToken } from '../../../../../server/http';

/** GET /api/v1/orders/{id}: the real state, for the order's owner only (§14). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { app } = await booking();
    return NextResponse.json(await app.order(id, await orderToken(id)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
