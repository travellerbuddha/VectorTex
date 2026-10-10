import { NextResponse, type NextRequest } from 'next/server';
import { booking } from '../../../../server/booking';
import { assertSameOrigin, errorResponse, readJson, setOrderCookie } from '../../../../server/http';

/**
 * POST /api/v1/checkout-sessions: guest checkout with the provider-managed payment. Idempotent per
 * `idempotencyKey`. The order access token is set as an httpOnly cookie and never returned in the body.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { app } = await booking();
    const { orderId, accessToken, order } = await app.createCheckout(await readJson(req));
    const res = NextResponse.json({ orderId, order }, { status: 201 });
    setOrderCookie(res, orderId, accessToken);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
