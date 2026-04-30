import { describe, expect, it } from 'vitest';
import { transformOperators } from './operators';

describe('transformOperators', () => {
  it('maps a fully-populated record', () => {
    const result = transformOperators([
      {
        id: 'xeely6yu',
        opId: 'VNM',
        name: 'Vinay',
        department: '',
        skills: '',
        status: 'Active',
      },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      _legacyId: 'xeely6yu',
      code: 'VNM',
      name: 'Vinay',
      department: null,
      skills: null,
      isActive: true,
      userId: null,
    });
    expect(result.anomalies).toEqual([]);
  });

  it('treats absent status as active', () => {
    const result = transformOperators([{ id: 'x', opId: 'OP1', name: 'A' }]);
    expect(result.rows[0]?.isActive).toBe(true);
    expect(result.anomalies).toEqual([]);
  });

  it('flags non-Active status', () => {
    const result = transformOperators([
      { id: 'x', opId: 'OP1', name: 'A', status: 'Resigned' },
    ]);
    expect(result.rows[0]?.isActive).toBe(false);
    expect(result.anomalies).toContainEqual({
      legacyId: 'x',
      type: 'status_inactive',
      details: { from: 'Resigned' },
    });
  });

  it('skips records missing opId or name', () => {
    const result = transformOperators([
      { id: 'a', name: 'no opId' },
      { id: 'b', opId: 'OP1' },
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies).toEqual([
      { legacyId: 'a', type: 'opId_missing' },
      { legacyId: 'b', type: 'name_missing' },
    ]);
  });

  it('preserves non-empty department and skills', () => {
    const result = transformOperators([
      { id: 'x', opId: 'OP1', name: 'A', department: 'Machining', skills: 'CNC, Welding' },
    ]);
    expect(result.rows[0]).toMatchObject({
      department: 'Machining',
      skills: 'CNC, Welding',
    });
  });
});
