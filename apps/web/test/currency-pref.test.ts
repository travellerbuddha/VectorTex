import { afterEach, describe, expect, it, vi } from 'vitest';
import { savedCurrency } from '../src/components/currency-pref';

describe('saved header currency', () => {
  afterEach(() => vi.unstubAllGlobals());
  const withCookie = (cookie: string) => vi.stubGlobal('document', { cookie });

  it('reads the chosen currency when it is still on sale', () => {
    withCookie('a=1; th_currency=USD; b=2');
    expect(savedCurrency(['EUR', 'USD'])).toBe('USD');
  });

  it('ignores a currency that is no longer on sale, a malformed value and a missing cookie', () => {
    withCookie('th_currency=TRY');
    expect(savedCurrency(['EUR', 'USD'])).toBeNull();
    withCookie('th_currency=usd');
    expect(savedCurrency(['EUR', 'USD'])).toBeNull();
    withCookie('other=1');
    expect(savedCurrency(['EUR'])).toBeNull();
  });

  it('is null on the server', () => {
    expect(savedCurrency(['EUR'])).toBeNull();
  });
});
