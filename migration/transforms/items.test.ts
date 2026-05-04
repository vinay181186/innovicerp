import { describe, expect, it } from 'vitest';
import { legacyItemIdToUuid, transformItems } from './items';

describe('transformItems', () => {
  it('maps the canonical legacy shape to the new schema columns', () => {
    const result = transformItems([
      {
        id: 'ohqnety3',
        code: '60346558',
        name: 'BLOCK',
        desc: 'BLOCK',
        drawing: '60346558',
        rev: 'A',
        material: '1018',
        uom: 'NOS',
        stockQty: 50,
        drawingData: '',
        drawingFile: '',
      },
    ]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row).toMatchObject({
      _legacyId: 'ohqnety3',
      code: '60346558',
      name: 'BLOCK',
      description: 'BLOCK',
      drawingNo: '60346558',
      revision: 'A',
      material: '1018',
      uom: 'NOS',
      drawingFilePath: null,
      _legacyExtras: { stockQty: 50 },
    });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.anomalies).toEqual([]);
  });

  it('produces deterministic uuidv5 ids (re-runs are stable)', () => {
    const a = legacyItemIdToUuid('ohqnety3');
    const b = legacyItemIdToUuid('ohqnety3');
    expect(a).toBe(b);
    expect(a).not.toBe(legacyItemIdToUuid('different'));
  });

  it('normalises lowercased uom variants', () => {
    const result = transformItems([
      { id: 'a', code: 'C1', name: 'X', uom: 'Nos' },
      { id: 'b', code: 'C2', name: 'X', uom: 'Set' },
    ]);
    expect(result.rows[0]?.uom).toBe('NOS');
    expect(result.rows[1]?.uom).toBe('SET');
    expect(result.anomalies).toContainEqual({
      legacyId: 'a',
      type: 'uom_normalised',
      details: { from: 'Nos', to: 'NOS' },
    });
    expect(result.anomalies).toContainEqual({
      legacyId: 'b',
      type: 'uom_normalised',
      details: { from: 'Set', to: 'SET' },
    });
  });

  it('defaults unknown uom to NOS and reports it', () => {
    const result = transformItems([{ id: 'x', code: 'C', name: 'X', uom: 'cubic-furlongs' }]);
    expect(result.rows[0]?.uom).toBe('NOS');
    expect(result.anomalies).toContainEqual({
      legacyId: 'x',
      type: 'uom_unrecognised',
      details: { from: 'cubic-furlongs', defaultedTo: 'NOS' },
    });
  });

  it('skips records missing code or name', () => {
    const result = transformItems([
      { id: 'a', name: 'no code' },
      { id: 'b', code: 'C1' /* no name */ },
      { id: 'c', code: 'C2', name: 'ok' },
    ]);
    expect(result.rows.map((r) => r._legacyId)).toEqual(['c']);
    expect(result.anomalies).toEqual([
      { legacyId: 'a', type: 'code_missing' },
      { legacyId: 'b', type: 'name_missing' },
    ]);
  });

  it('captures stockQty / minStock / category / location / status in _legacyExtras', () => {
    const result = transformItems([
      {
        id: 'x',
        code: 'C',
        name: 'X',
        stockQty: 5,
        minStock: 1,
        category: 'raw',
        location: 'A1',
        status: 'active',
      },
    ]);
    expect(result.rows[0]?._legacyExtras).toEqual({
      stockQty: 5,
      minStock: 1,
      category: 'raw',
      location: 'A1',
      status: 'active',
    });
  });

  it('flags drawingData when non-empty (image bytes are dropped)', () => {
    const result = transformItems([
      { id: 'x', code: 'C', name: 'X', drawingData: 'data:image/png;base64,iVBOR...' },
    ]);
    expect(result.anomalies).toContainEqual({
      legacyId: 'x',
      type: 'drawing_data_present_dropped',
    });
  });

  it('preserves a non-empty drawingFile as drawingFilePath', () => {
    const result = transformItems([
      { id: 'x', code: 'C', name: 'X', drawingFile: 'drawings/60346558.pdf' },
    ]);
    expect(result.rows[0]?.drawingFilePath).toBe('drawings/60346558.pdf');
  });

  it('defaults missing revision to "A"', () => {
    const result = transformItems([{ id: 'x', code: 'C', name: 'X' }]);
    expect(result.rows[0]?.revision).toBe('A');
  });

  it('captures unknown legacy keys in _legacyExtras', () => {
    const result = transformItems([{ id: 'x', code: 'C', name: 'X', mysteryField: 42 } as never]);
    expect(result.rows[0]?._legacyExtras).toMatchObject({ mysteryField: 42 });
  });
});
