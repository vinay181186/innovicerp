import { describe, expect, it } from 'vitest';
import { transformQcProcesses } from './qc-processes';

describe('transformQcProcesses', () => {
  it('maps the 5 real legacy records (MIR/MCR/DIR/Coating/TPI)', () => {
    const result = transformQcProcesses([
      { id: '1olhiafn', name: 'MIR', description: 'Material Identification Report', defaultCycleTime: 0, status: 'Active' },
      { id: 'l3hbf23s', name: 'MCR', description: 'Material Clearance Report', defaultCycleTime: 0, status: 'Active' },
      { id: '5ksvw3uz', name: 'DIR', description: 'Dimensional Inspection Report (Internal Inspection)', defaultCycleTime: 0, status: 'Active' },
      { id: 'i56kaxzs', name: 'Coating Inspection', description: '', defaultCycleTime: 0, status: 'Active' },
      { id: '4p3re6a7', name: 'TPI', description: 'Client Inspection Report', defaultCycleTime: 0, status: 'Active' },
    ]);
    expect(result.table).toBe('qc_processes');
    expect(result.rows).toHaveLength(5);
    expect(result.anomalies).toHaveLength(0);
    const codes = result.rows.map((r) => r.code);
    expect(codes).toEqual(['MIR', 'MCR', 'DIR', 'Coating Inspection', 'TPI']);
    // Description empty in legacy ('Coating Inspection') comes through as null.
    expect(result.rows[3]?.description).toBeNull();
    // defaultCycleTime is always 0 in current data → '0.00' as numeric string.
    expect(result.rows[0]?.defaultCycleTimeMin).toBe('0.00');
    // All Active → isActive=true.
    expect(result.rows.every((r) => r.isActive === true)).toBe(true);
  });

  it('skips records with missing or blank name + logs anomaly', () => {
    const result = transformQcProcesses([
      { id: 'a' /* no name */ },
      { id: 'b', name: '   ' },
      { id: 'c', name: 'Valid', status: 'Active' },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.code).toBe('Valid');
    const types = result.anomalies.map((a) => a.type).sort();
    expect(types).toEqual(['name_blank', 'name_missing']);
  });

  it('non-Active status flips isActive=false and logs status_inactive anomaly', () => {
    const result = transformQcProcesses([
      { id: 'x', name: 'Retired QC', status: 'Inactive' },
    ]);
    expect(result.rows[0]?.isActive).toBe(false);
    expect(result.anomalies.map((a) => a.type)).toContain('status_inactive');
  });

  it('coerces non-numeric defaultCycleTime to 0', () => {
    const result = transformQcProcesses([
      { id: 'x', name: 'A', defaultCycleTime: NaN },
      { id: 'y', name: 'B', defaultCycleTime: 7.5 },
    ]);
    expect(result.rows[0]?.defaultCycleTimeMin).toBe('0.00');
    expect(result.rows[1]?.defaultCycleTimeMin).toBe('7.50');
  });

  it('produces deterministic UUIDv5 ids stable across re-runs', () => {
    const a = transformQcProcesses([{ id: '1olhiafn', name: 'MIR', status: 'Active' }]);
    const b = transformQcProcesses([{ id: '1olhiafn', name: 'MIR', status: 'Active' }]);
    expect(a.rows[0]?.id).toBe(b.rows[0]?.id);
  });
});
