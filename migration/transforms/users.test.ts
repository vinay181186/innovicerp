import { describe, expect, it } from 'vitest';
import { transformUsers } from './users';

describe('transformUsers', () => {
  it('maps a fully-populated record to the expected shape', () => {
    const result = transformUsers([
      {
        id: 'mmtdefvc',
        name: 'Vinay N Makwana',
        role: 'admin',
        pin: '0000',
        email: 'innovic.technology@gmail.com',
      },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      _legacyId: 'mmtdefvc',
      email: 'innovic.technology@gmail.com',
      fullName: 'Vinay N Makwana',
      role: 'admin',
      isActive: true,
      _legacyPin: '0000',
      _legacyExtras: {},
    });
    expect(result.anomalies).toEqual([]);
  });

  it('captures approvalLimit in _legacyExtras', () => {
    const result = transformUsers([
      {
        id: '6am6dudd',
        name: 'Japan',
        role: 'admin',
        pin: 'Japan@12',
        email: 'japan@innovictechnology.com',
        status: 'Active',
        approvalLimit: 100000,
      },
    ]);
    expect(result.rows[0]?._legacyExtras).toEqual({ approvalLimit: 100000 });
  });

  it('lowercases and trims the email', () => {
    const result = transformUsers([{ id: 'a', email: '  Foo@Example.COM  ', role: 'admin' }]);
    expect(result.rows[0]?.email).toBe('foo@example.com');
  });

  it('skips records without an email and reports an anomaly', () => {
    const result = transformUsers([{ id: 'no-email', role: 'admin' } as never]);
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies).toEqual([{ legacyId: 'no-email', type: 'email_missing' }]);
  });

  it('falls back to viewer for missing or unknown roles', () => {
    const result = transformUsers([
      { id: 'r1', email: 'a@b.com' },
      { id: 'r2', email: 'b@c.com', role: 'superuser' },
    ]);
    expect(result.rows[0]?.role).toBe('viewer');
    expect(result.rows[1]?.role).toBe('viewer');
    expect(result.anomalies).toEqual([
      { legacyId: 'r1', type: 'role_missing', details: { from: undefined } },
      { legacyId: 'r2', type: 'role_unrecognised', details: { from: 'superuser' } },
    ]);
  });

  it('treats absent status as active', () => {
    const result = transformUsers([{ id: 'x', email: 'x@y.com', role: 'admin' }]);
    expect(result.rows[0]?.isActive).toBe(true);
    expect(result.anomalies).toEqual([]);
  });

  it('marks isActive=false and emits an anomaly for non-Active status', () => {
    const result = transformUsers([
      { id: 'x', email: 'x@y.com', role: 'admin', status: 'Suspended' },
    ]);
    expect(result.rows[0]?.isActive).toBe(false);
    expect(result.anomalies).toContainEqual({
      legacyId: 'x',
      type: 'status_inactive',
      details: { from: 'Suspended', willActivate: false },
    });
  });

  it('captures unknown legacy keys in _legacyExtras', () => {
    const result = transformUsers([
      { id: 'x', email: 'x@y.com', role: 'admin', favouriteColor: 'orange' } as never,
    ]);
    expect(result.rows[0]?._legacyExtras).toEqual({ favouriteColor: 'orange' });
  });
});
