import { NextResponse, type NextRequest } from 'next/server';
import { flightSales } from '../../../../../../server/booking';
import { assertSameOrigin, errorResponse, orderToken, readJson } from '../../../../../../server/http';

/**
 * POST /api/v1/orders/{id}/services {selections, expectedTotal}: adds seats/bags before payment (ADR-0013). The body
 * carries offer keys and the total the customer saw, never provider ids or prices to be trusted.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const r = await (await flightSales()).services.attach(id, await orderToken(id), await readJson(req));
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
