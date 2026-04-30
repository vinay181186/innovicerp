import { describe, expect, it } from 'vitest';
import { legacyClientIdToUuid, transformClients } from './clients';

describe('transformClients', () => {
  it('maps a fully-populated record', () => {
    const result = transformClients([
      {
        id: 'a559u04v',
        code: 'L&T_1',
        name: 'L&T Precision engineering (Hazira)',
        address: '',
        contact: '',
        email: '',
      },
    ]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row).toMatchObject({
      _legacyId: 'a559u04v',
      code: 'L&T_1',
      name: 'L&T Precision engineering (Hazira)',
      contactPerson: null,
      email: null,
      addressLine1: null,
      isActive: true,
    });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.anomalies).toEqual([]);
  });

  it('produces deterministic uuidv5 ids', () => {
    expect(legacyClientIdToUuid('a559u04v')).toBe(legacyClientIdToUuid('a559u04v'));
    expect(legacyClientIdToUuid('a559u04v')).not.toBe(legacyClientIdToUuid('different'));
  });

  it('preserves non-empty contact + email + address', () => {
    const result = transformClients([
      {
        id: 'x',
        code: 'C1',
        name: 'Acme',
        contact: '  Mr Acme  ',
        email: '  Foo@Bar.COM',
        address: '  1 Main St  ',
      },
    ]);
    expect(result.rows[0]).toMatchObject({
      contactPerson: 'Mr Acme',
      email: 'foo@bar.com',
      addressLine1: '1 Main St',
    });
  });

  it('skips records missing code or name', () => {
    const result = transformClients([
      { id: 'a', name: 'no code' },
      { id: 'b', code: 'C1' },
      { id: 'c', code: 'C2', name: 'ok' },
    ]);
    expect(result.rows.map((r) => r._legacyId)).toEqual(['c']);
    expect(result.anomalies).toEqual([
      { legacyId: 'a', type: 'code_missing' },
      { legacyId: 'b', type: 'name_missing' },
    ]);
  });

  it('captures unknown legacy keys', () => {
    const result = transformClients([
      { id: 'x', code: 'C', name: 'X', credit: 100000 } as never,
    ]);
    expect(result.rows[0]?._legacyExtras).toEqual({ credit: 100000 });
  });
});
