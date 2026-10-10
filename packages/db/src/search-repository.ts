import { eq } from 'drizzle-orm';
import type { ProductType, ProviderEnvironment } from '@texholiday/contracts';
import type { CoreDb } from './client';
import { searchSessions } from './schema';

export interface StoredSearchSession<R = unknown, Q = unknown> {
  id: string;
  productType: ProductType;
  environment: ProviderEnvironment | null;
  criteria: Q;
  route: unknown;
  results: R;
  locale: string;
  displayCurrency: string;
  guestNationality: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Search sessions keep provider offer snapshots server-side; clients only get offer keys (§14). */
export class SearchSessionRepository {
  constructor(private readonly db: CoreDb) {}

  async create<R, Q>(s: Omit<StoredSearchSession<R, Q>, 'id' | 'createdAt'>): Promise<string> {
    const [row] = await this.db
      .insert(searchSessions)
      .values({
        productType: s.productType,
        environment: s.environment,
        criteria: s.criteria,
        route: s.route,
        results: s.results,
        locale: s.locale,
        displayCurrency: s.displayCurrency,
        guestNationality: s.guestNationality,
        status: 'COMPLETED',
        expiresAt: s.expiresAt,
      })
      .returning({ id: searchSessions.id });
    return row!.id;
  }

  async get<R, Q>(id: string): Promise<StoredSearchSession<R, Q> | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [r] = await this.db.select().from(searchSessions).where(eq(searchSessions.id, id));
    if (!r) return null;
    return {
      id: r.id,
      productType: r.productType,
      environment: r.environment,
      criteria: r.criteria as Q,
      route: r.route,
      results: r.results as R,
      locale: r.locale,
      displayCurrency: r.displayCurrency,
      guestNationality: r.guestNationality,
      createdAt: new Date(r.createdAt).toISOString(),
      expiresAt: new Date(r.expiresAt).toISOString(),
    };
  }
}
