import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../../../server/booking';
import { errorResponse, orderToken } from '../../../../../../server/http';

/** Short-lived parameters of the provider payment component, for the order's owner only. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { app } = await booking();
    return NextResponse.json(await app.paymentSession(id, await orderToken(id)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
