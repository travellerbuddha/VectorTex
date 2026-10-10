import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../../../server/booking';
import { assertSameOrigin, errorResponse, orderToken, readJson } from '../../../../../../server/http';

/** GET /api/v1/orders/{id}/cancellation: whether the owner may cancel online now, and the expected fee (ADR-0021). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { app } = await booking();
    return NextResponse.json({ cancellation: await app.customerCancellation(id, await orderToken(id)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/v1/orders/{id}/cancellation `{ acceptedFee }`: the owner cancels, accepting the fee shown (ADR-0021). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const { app } = await booking();
    return NextResponse.json(await app.customerCancel(id, await orderToken(id), await readJson(req)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
