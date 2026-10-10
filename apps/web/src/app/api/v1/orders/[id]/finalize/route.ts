import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../../../server/booking';
import { assertSameOrigin, errorResponse, orderToken } from '../../../../../../server/http';

/** Return from the payment component: only triggers server-side finalization with the stored transaction (§5.1). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const { app } = await booking();
    return NextResponse.json(await app.finalize(id, await orderToken(id)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
