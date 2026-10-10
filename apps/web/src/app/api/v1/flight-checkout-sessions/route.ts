import { NextResponse, type NextRequest } from 'next/server';
import { flightSales } from '../../../../server/booking';
import { assertSameOrigin, errorResponse, readJson, setOrderCookie } from '../../../../server/http';

/**
 * POST /api/v1/flight-checkout-sessions: guest flight checkout with the provider-managed payment. Idempotent per
 * `idempotencyKey`. Passenger documents go to the provider prebook and are not stored (ADR-0012). The order access
 * token is set as an httpOnly cookie and never returned in the body.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { orderId, accessToken, order } = await (await flightSales()).createCheckout(await readJson(req));
    const res = NextResponse.json({ orderId, order }, { status: 201 });
    setOrderCookie(res, orderId, accessToken);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
