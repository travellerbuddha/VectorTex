import { BookingApp, bookingSettingsFromEnv, type BookingSettings } from '@texholiday/booking';
import { loadConfig } from '@texholiday/config';
import { MockFlightConnector, MockHotelConnector, NuiteeFlightConnector, NuiteeHotelConnector, NUITEE_HOTEL_TIMEOUTS } from '@texholiday/connectors';
import { DomainError, parseCapabilityMatrix, parseSourceLock, type FlightConnector, type HotelConnector } from '@texholiday/contracts';
import matrixJson from '../../../../contracts/capability-matrix.json';
import lockJson from '../../../../contracts/sources.lock.json';
import { coreDatabase } from './core';

export interface Booking {
  app: BookingApp;
  settings: BookingSettings;
  /** MOCK environment only: the simulated providers (their payment page marks transactions paid). */
  mock: { hotels: MockHotelConnector; flights: MockFlightConnector } | null;
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
  const mock = config.providerEnvironment === 'mock' ? { hotels: new MockHotelConnector(), flights: new MockFlightConnector() } : null;
  let hotels: HotelConnector;
  let flights: FlightConnector;
  if (mock) {
    hotels = mock.hotels;
    flights = mock.flights;
  } else if (config.nuitee) {
    hotels = new NuiteeHotelConnector({
      apiKey: config.nuitee.apiKey,
      environment: config.nuitee.keyEnvironment,
      searchBaseUrl: config.nuitee.searchBaseUrl,
      bookBaseUrl: config.nuitee.bookBaseUrl,
      ...NUITEE_HOTEL_TIMEOUTS,
    });
    // The flights OpenAPI serves every flight operation from the search host (api.liteapi.travel/v3.0). Sales open only
    // with an approved FLIGHT pricing rule and a route the capability matrix allows (ADR-0012).
    flights = new NuiteeFlightConnector({ apiKey: config.nuitee.apiKey, environment: config.nuitee.keyEnvironment, baseUrl: config.nuitee.searchBaseUrl, searchTimeoutSeconds: 30, bookTimeoutSeconds: 120 });
  } else throw new Error('Nuitee is not configured for this environment (ENABLED_PROVIDERS / NUITEE_API_KEY)');
  const app = new BookingApp({
    db: core.db,
    hotels,
    flights,
    matrix: parseCapabilityMatrix(matrixJson),
    sourceLock: parseSourceLock(lockJson),
    settings,
    workerId: `web-${process.pid}`,
  });
  return { app, settings, mock };
}

/** Flight sales of this process; 404 when no flight connector is configured. */
export async function flightSales() {
  const { app } = await booking();
  if (!app.flights) throw new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });
  return app.flights;
}
