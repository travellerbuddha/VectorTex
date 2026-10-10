import { describe, expect, it } from 'vitest';
import { errorMessage, jsonLogger, redact, redactText, REDACTED } from '../src/index';

/** T31: no personal data or secrets in logs. */
describe('log redaction', () => {
  it('masks personal data and secrets in free text', () => {
    const text = redactText(
      'Guest ayse.demir@ornek.test (+90 532 111 22 33, 05321112233) card 4242 4242 4242 4242 IBAN TR33 0006 1005 1978 6457 8413 26 key sand_c0155ab8-7a6e-4c2a-9a33-1f2e3d4c5b6a Authorization: Bearer abc.def.ghijklmnop token=s3cr3tValue',
    );
    for (const leak of ['ayse.demir', 'ornek.test', '532 111', '05321112233', '4242 4242', 'TR33', 'sand_c0155ab8', 'abc.def.ghijklmnop', 's3cr3tValue']) expect(text).not.toContain(leak);
    expect(text).toContain('[EMAIL]');
    expect(text).toContain('[PHONE]');
  });

  it('cuts the query values off a database error (they can be customer data)', () => {
    const err = new Error('Failed query: INSERT INTO core.customers (email, phone) VALUES ($1, $2)\nparams: ayse@example.test,+905321112233');
    expect(errorMessage(err)).toBe('Failed query: INSERT INTO core.customers (email, phone) VALUES ($1, $2)\nparams: [REDACTED]');
    expect(errorMessage(new Error('outer', { cause: new Error('duplicate key for john@example.test') }))).toBe('outer (cause: duplicate key for [EMAIL])');
    // The cause of a failed query stays readable after its params are cut.
    const query = new Error('Failed query: insert into core.ledger_entries values ($1)\nparams: 0,EUR', { cause: new Error('new row violates check constraint "ledger_entries_amount_positive"') });
    expect(errorMessage(query)).toBe('Failed query: insert into core.ledger_entries values ($1)\nparams: [REDACTED] (cause: new row violates check constraint "ledger_entries_amount_positive")');
  });

  it('replaces sensitive fields at any depth; keeps ids, statuses, amounts and dates', () => {
    const out = redact({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'CONFIRMED',
      amount: { currency: 'EUR', minor: 29700n },
      at: new Date('2027-06-10T10:00:00Z'),
      holder: { firstName: 'Ayşe', email: 'a@b.test' },
      guests: [{ firstName: 'Can' }],
      meta: { apiKey: 'x', 'set-cookie': 'th=1', password: 'p', firstName: 'Ayşe', last_name: 'Demir', phone: '+905321112233', to: 'x@y.test', passport_number: 'U123' },
      note: 'call +90 532 111 22 33',
    }) as Record<string, unknown>;
    expect(out).toEqual({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'CONFIRMED',
      amount: { currency: 'EUR', minor: '29700' },
      at: '2027-06-10T10:00:00.000Z',
      holder: REDACTED,
      guests: REDACTED,
      meta: { apiKey: REDACTED, 'set-cookie': REDACTED, password: REDACTED, firstName: REDACTED, last_name: REDACTED, phone: REDACTED, to: REDACTED, passport_number: REDACTED },
      note: 'call [PHONE]',
    });
  });

  it('survives cycles, errors and deep values; the logger writes one redacted JSON line', () => {
    const a: Record<string, unknown> = { name: 'loop' };
    a.self = a;
    expect(redact(a)).toEqual({ name: 'loop', self: '[Circular]' });
    const lines: string[] = [];
    const sink = { log: (s: string) => lines.push(s), warn: (s: string) => lines.push(s), error: (s: string) => lines.push(s) };
    jsonLogger({ service: 'test' }, sink).error('mail to ayse@example.test failed', { error: new Error('SMTP 550 for ayse@example.test'), orderId: 'o-1', token: 'abc' });
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'error', service: 'test', msg: 'mail to [EMAIL] failed', orderId: 'o-1', token: REDACTED, error: { name: 'Error', message: 'SMTP 550 for [EMAIL]' } });
    expect(lines[0]).not.toContain('ayse');
  });
});
