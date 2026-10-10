import { errorMessage, jsonLogger } from '@texholiday/contracts';

/** Web process logs: one JSON line each, personal data and secrets masked (T31). */
export const log = jsonLogger({ service: 'web' });

export { errorMessage };
