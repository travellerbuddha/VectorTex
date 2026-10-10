import { getPayload, type Payload } from 'payload';
import config from '../payload.config';

/** The CMS is off when PAYLOAD_ENABLED=false (e.g. booking-only test runs): its routes answer 404. */
export const cmsEnabled = (): boolean => process.env.PAYLOAD_ENABLED !== 'false';

/** Payload's Local API for this server process (Payload keeps one instance per process). */
export async function cms(): Promise<Payload> {
  return getPayload({ config });
}
