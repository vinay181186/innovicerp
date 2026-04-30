import { describe, expect, it } from 'vitest';
import { transformMachines } from './machines';

describe('transformMachines', () => {
  it('maps a fully-populated record', () => {
    const result = transformMachines([
      {
        id: 'm1',
        machineId: 'CNC-01',
        name: 'DX-200 5A',
        type: '',
        capPerShift: 8,
        shifts: 2,
        status: 'Running',
      },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      _legacyId: 'm1',
      code: 'CNC-01',
      name: 'DX-200 5A',
      machineType: null,
      capacityPerShift: 8,
      shiftsPerDay: 2,
      status: 'Running',
    });
    expect(result.anomalies).toEqual([]);
  });

  it('defaults shiftsPerDay to 1 when missing or zero', () => {
    const result = transformMachines([
      { id: 'a', machineId: 'M1', name: 'A' },
      { id: 'b', machineId: 'M2', name: 'B', shifts: 0 },
    ]);
    expect(result.rows[0]?.shiftsPerDay).toBe(1);
    expect(result.rows[1]?.shiftsPerDay).toBe(1);
  });

  it('defaults status to "Idle" when missing or empty', () => {
    const result = transformMachines([
      { id: 'a', machineId: 'M1', name: 'A' },
      { id: 'b', machineId: 'M2', name: 'B', status: '   ' },
    ]);
    expect(result.rows[0]?.status).toBe('Idle');
    expect(result.rows[1]?.status).toBe('Idle');
  });

  it('preserves capacityPerShift only when numeric', () => {
    const result = transformMachines([
      { id: 'a', machineId: 'M1', name: 'A' },
      { id: 'b', machineId: 'M2', name: 'B', capPerShift: 0 },
    ]);
    expect(result.rows[0]?.capacityPerShift).toBeNull();
    expect(result.rows[1]?.capacityPerShift).toBe(0);
  });

  it('skips records missing machineId or name', () => {
    const result = transformMachines([
      { id: 'a', name: 'no id' },
      { id: 'b', machineId: 'M2' },
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies).toEqual([
      { legacyId: 'a', type: 'machineId_missing' },
      { legacyId: 'b', type: 'name_missing' },
    ]);
  });
});
