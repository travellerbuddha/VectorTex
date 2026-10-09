import { BookingApp, bookingSettingsFromEnv, type BookingSettings } from '@texholiday/booking';
import { loadConfig } from '@texholiday/config';
import { MockHotelConnector, NuiteeHotelConnector } from '@texholiday/connectors';
import { parseCapabilityMatrix, parseSourceLock, type HotelConnector } from '@texholiday/contracts';
import matrixJson from '../../../../contracts/capability-matrix.json';
import lockJson from '../../../../contracts/sources.lock.json';
import { coreDatabase } from './core';

export interface Booking {
  app: BookingApp;
  settings: BookingSettings;
  /** MOCK environment only: the simulated provider (its payment page marks transactions paid). */
  mock: MockHotelConnector | null;
}

// Next bundles pages and route handlers separately; one instance per process must live on globalThis so every bundle
// shares the database pool (and, in the MOCK environment, the simulated provider's state).
const holder = globalThis as typeof globalThis & { __texholidayBooking?: Promise<Booking> | null };

/** Composition root of the web process (one per server process). Fails fast on invalid configuration. */
export function booking(): Promise<Booking> {
  holder.__texholidayBooking ??= create().catch((err) => {
    holder.__texholidayBooking = null;
    throw err;
  });
  return holder.__texholidayBooking;
}

async function create(): Promise<Booking> {
  const config = loadConfig(process.env);
  const settings = bookingSettingsFromEnv(process.env, config.providerEnvironment, process.env.POLICY_ID ?? 'b2c');
  const core = coreDatabase();
  const mock = config.providerEnvironment === 'mock' ? new MockHotelConnector() : null;
  let hotels: HotelConnector;
  if (mock) hotels = mock;
  else if (config.nuitee) {
    hotels = new NuiteeHotelConnector({
      apiKey: config.nuitee.apiKey,
      environment: config.nuitee.keyEnvironment,
      searchBaseUrl: config.nuitee.searchBaseUrl,
      bookBaseUrl: config.nuitee.bookBaseUrl,
      searchTimeoutSeconds: 6,
      bookTimeoutSeconds: 120,
    });
  } else throw new Error('Nuitee is not configured for this environment (ENABLED_PROVIDERS / NUITEE_API_KEY)');
  const app = new BookingApp({
    db: core.db,
    hotels,
    matrix: parseCapabilityMatrix(matrixJson),
    sourceLock: parseSourceLock(lockJson),
    settings,
    workerId: `web-${process.pid}`,
  });
  return { app, settings, mock };
}
