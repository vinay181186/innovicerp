import { describe, expect, it } from 'vitest';
import { transformActivityLog } from './activity-log';

describe('transformActivityLog', () => {
  it('maps the real legacy IMPORT entry with snapshot user_name + null user_id', () => {
    const result = transformActivityLog([
      {
        id: 'k8yg0lsp',
        ts: '2026-04-29T14:54:20.514Z',
        user: 'Japan',
        action: 'IMPORT',
        entity: 'Item',
        detail: '7 items from Excel',
        refId: 'bulk',
      },
    ]);
    expect(result.table).toBe('activity_log');
    expect(result.rows).toHaveLength(1);
    expect(result.anomalies).toHaveLength(0);
    const row = result.rows[0]!;
    expect(row.userId).toBeNull(); // resolved post-load if at all
    expect(row.userName).toBe('Japan');
    expect(row.action).toBe('IMPORT');
    expect(row.entity).toBe('Item');
    expect(row.detail).toBe('7 items from Excel');
    expect(row.refId).toBe('bulk');
  });

  it('treats missing user as "System" (legacy fallback in renderer L2128)', () => {
    const result = transformActivityLog([
      { id: 'a', ts: '2026-04-29T14:54:20.514Z', action: 'X', entity: 'Y' },
    ]);
    expect(result.rows[0]?.userName).toBe('System');
    expect(result.rows[0]?.userId).toBeNull();
  });

  it('skips records missing ts / action / entity + logs anomaly', () => {
    const result = transformActivityLog([
      { id: 'no-ts', action: 'X', entity: 'Y' },
      { id: 'no-action', ts: '2026-04-29T14:54:20.514Z', entity: 'Y' },
      { id: 'no-entity', ts: '2026-04-29T14:54:20.514Z', action: 'X' },
      { id: 'good', ts: '2026-04-29T14:54:20.514Z', action: 'X', entity: 'Y' },
    ]);
    expect(result.rows).toHaveLength(1);
    const types = result.anomalies.map((a) => a.type).sort();
    expect(types).toEqual(['action_missing', 'entity_missing', 'ts_missing']);
  });

  it('empty refId/detail strings normalise to null/empty (no false data)', () => {
    const result = transformActivityLog([
      {
        id: 'a',
        ts: '2026-04-29T14:54:20.514Z',
        user: 'System',
        action: 'X',
        entity: 'Y',
        detail: '',
        refId: '   ',
      },
    ]);
    expect(result.rows[0]?.detail).toBe('');
    expect(result.rows[0]?.refId).toBeNull();
  });

  it('produces deterministic UUIDv5 ids stable across re-runs', () => {
    const a = transformActivityLog([
      { id: 'k8yg0lsp', ts: '2026-04-29T14:54:20.514Z', user: 'Japan', action: 'X', entity: 'Y' },
    ]);
    const b = transformActivityLog([
      { id: 'k8yg0lsp', ts: '2026-04-29T14:54:20.514Z', user: 'Japan', action: 'X', entity: 'Y' },
    ]);
    expect(a.rows[0]?.id).toBe(b.rows[0]?.id);
  });

  it('trims whitespace in action / entity / userName', () => {
    const result = transformActivityLog([
      {
        id: 'a',
        ts: '2026-04-29T14:54:20.514Z',
        user: '  Japan  ',
        action: '  IMPORT  ',
        entity: '  Item  ',
      },
    ]);
    expect(result.rows[0]?.userName).toBe('Japan');
    expect(result.rows[0]?.action).toBe('IMPORT');
    expect(result.rows[0]?.entity).toBe('Item');
  });
});
