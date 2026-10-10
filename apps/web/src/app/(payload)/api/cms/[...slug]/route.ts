import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from '@payloadcms/next/routes';
import config from '../../../../../payload.config';
import { cmsEnabled } from '../../../../../server/cms';

/** Payload REST API (/api/cms). Off with the CMS; access rules decide everything else (payload/access.ts). */
type Handler = (req: Request, ctx: { params: Promise<{ slug: string[] }> }) => Promise<Response>;
const guarded =
  (handler: Handler): Handler =>
  (req, ctx) =>
    cmsEnabled() ? handler(req, ctx) : Promise.resolve(new Response(null, { status: 404 }));

export const GET = guarded(REST_GET(config) as Handler);
export const POST = guarded(REST_POST(config) as Handler);
export const DELETE = guarded(REST_DELETE(config) as Handler);
export const PATCH = guarded(REST_PATCH(config) as Handler);
export const PUT = guarded(REST_PUT(config) as Handler);
export const OPTIONS = guarded(REST_OPTIONS(config) as Handler);
