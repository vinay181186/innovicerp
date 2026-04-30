import { describe, expect, it } from 'vitest';
import { transformVendors } from './vendors';

describe('transformVendors', () => {
  it('maps a fully-populated record', () => {
    const result = transformVendors([
      {
        id: 'v1',
        code: 'VND-001',
        name: 'Mehta Steel Traders',
        contact: 'Rajesh Mehta',
        phone: '9876543210',
        email: 'mehta@steeltraders.com',
        gst: '24ABCDE1234F1Z5',
        address: 'GIDC, Anand, Gujarat',
        materials: 'EN8, EN24, EN31',
        rating: 'A',
        status: 'Active',
      },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      _legacyId: 'v1',
      code: 'VND-001',
      name: 'Mehta Steel Traders',
      contactPerson: 'Rajesh Mehta',
      phone: '9876543210',
      email: 'mehta@steeltraders.com',
      gstNumber: '24ABCDE1234F1Z5',
      addressLine1: 'GIDC, Anand, Gujarat',
      materialsSupplied: 'EN8, EN24, EN31',
      rating: 'A',
      isActive: true,
    });
    expect(result.anomalies).toEqual([]);
  });

  it('treats absent status as active', () => {
    const result = transformVendors([
      { id: 'v', code: 'C', name: 'Acme' },
    ]);
    expect(result.rows[0]?.isActive).toBe(true);
    expect(result.anomalies).toEqual([]);
  });

  it('flags non-Active status', () => {
    const result = transformVendors([
      { id: 'v', code: 'C', name: 'Acme', status: 'Suspended' },
    ]);
    expect(result.rows[0]?.isActive).toBe(false);
    expect(result.anomalies).toContainEqual({
      legacyId: 'v',
      type: 'status_inactive',
      details: { from: 'Suspended' },
    });
  });

  it('skips records missing code or name', () => {
    const result = transformVendors([
      { id: 'a', name: 'no code' },
      { id: 'b', code: 'C1' },
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies).toEqual([
      { legacyId: 'a', type: 'code_missing' },
      { legacyId: 'b', type: 'name_missing' },
    ]);
  });

  it('empty-string fields normalise to null', () => {
    const result = transformVendors([
      {
        id: 'v',
        code: 'C',
        name: 'Acme',
        contact: '',
        phone: '   ',
        email: '',
        gst: '',
        address: '',
        materials: '',
        rating: '',
      },
    ]);
    expect(result.rows[0]).toMatchObject({
      contactPerson: null,
      phone: null,
      email: null,
      gstNumber: null,
      addressLine1: null,
      materialsSupplied: null,
      rating: null,
    });
  });
});
