// ADR-249 B2 — Excel import Update Existing under Document Edit Approval.
// Pure, no database: the engine (document-edits/service) is mocked and the
// transaction is a stub, so these pin the row routing (approval / direct /
// skip), the refusal wording, the preview, the gate being passed on (not
// re-read per row) and the counts. Run via
// `npx vitest run --config vitest.unit.config.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterImportRowResult } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { AppError, ConflictError, NotFoundError } from './errors';

const engine = vi.hoisted(() => ({
  gateOn: true,
  gateReads: 0,
  calls: [] as Array<{
    entity: string;
    id: string;
    payload: unknown;
    expected: unknown;
    opts: unknown;
  }>,
  outcome: new Map<string, 'staged' | 'null' | Error>(),
}));
vi.mock('../modules/document-edits/service', () => ({
  isDocEditApprovalOn: vi.fn(() => {
    engine.gateReads += 1;
    return Promise.resolve(engine.gateOn);
  }),
  requestDocumentEditIdInTx: vi.fn(
    (
      _tx: unknown,
      entity: string,
      id: string,
      payload: unknown,
      expected: unknown,
      _user: unknown,
      _precheck: unknown,
      opts: unknown,
    ) => {
      engine.calls.push({ entity, id, payload, expected, opts });
      const o = engine.outcome.get(id) ?? 'staged';
      if (o instanceof Error) return Promise.reject(o);
      return Promise.resolve(o === 'staged' ? `req-${id}` : null);
    },
  ),
}));

const { applyImportUpdates, goneReason, importApprovalRefusal, importCounts, waitingReason } =
  await import('./master-import-approval');

const user = { id: 'u-1', companyId: 'c-1', role: 'manager' } as unknown as AuthContext;
/** The preview's one read (records with an edit waiting) answers `waiting`. */
function stubTx(waiting: string[] = []): DbTransaction {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(waiting.map((entityId) => ({ entityId }))),
  };
  return { select: () => chain } as unknown as DbTransaction;
}
const at = new Date('2026-10-23T05:00:00.123Z');

function candidate(id: string, code: string) {
  const row: MasterImportRowResult = {
    index: 1,
    code,
    name: code,
    action: 'update',
    changedFields: 2,
  };
  return { before: { id, code, updatedAt: at }, payload: { hsnCode: '7318' }, row };
}

beforeEach(() => {
  engine.gateOn = true;
  engine.gateReads = 0;
  engine.calls.length = 0;
  engine.outcome.clear();
});

describe('applyImportUpdates — real run', () => {
  it('gate off → every row is written directly, the engine never stages', async () => {
    engine.gateOn = false;
    const c = [candidate('a', 'ITM-1')];
    const direct = await applyImportUpdates(stubTx(), 'Item', 'c-1', c, { dryRun: false, user });
    expect(direct).toEqual(c);
    expect(engine.calls).toHaveLength(0);
    expect(c[0]!.row.action).toBe('update');
  });

  it('no changed rows → nothing read at all', async () => {
    expect(await applyImportUpdates(stubTx(), 'Item', 'c-1', [], { dryRun: false, user })).toEqual(
      [],
    );
    expect(engine.gateReads).toBe(0);
  });

  it('gate on → staged = approval; null (Trash) and refusals = skip, never direct; gate read once', async () => {
    engine.outcome.set('b', 'null');
    engine.outcome.set(
      'c',
      new ConflictError('This document already has an edit waiting for approval.'),
    );
    engine.outcome.set('d', new ConflictError('Nothing changed to approve.'));
    const cs = [
      candidate('a', 'ITM-1'),
      candidate('b', 'ITM-2'),
      candidate('c', 'ITM-3'),
      candidate('d', 'ITM-4'),
    ];
    const direct = await applyImportUpdates(stubTx(), 'Item', 'c-1', cs, { dryRun: false, user });

    expect(direct).toEqual([]);
    expect(cs.map((c) => c.row.action)).toEqual(['approval', 'skip', 'skip', 'skip']);
    expect(cs[1]!.row.reason).toBe(goneReason('Item', 'ITM-2'));
    expect(cs[1]!.row.reason).toBe('Item ITM-2 no longer exists — it may have been moved to Trash');
    expect(cs[2]!.row.reason).toBe(waitingReason('Item', 'ITM-3'));
    expect(cs[2]!.row.changedFields).toBeUndefined();
    expect(cs[3]!.row.reason).toBe('Nothing to change — the filled cells match what is saved');
    expect(engine.gateReads).toBe(1);
    // The PATCH-shaped payload, the row's own updatedAt and the known gate.
    expect(engine.calls[0]).toEqual({
      entity: 'Item',
      id: 'a',
      payload: { hsnCode: '7318' },
      expected: '2026-10-23T05:00:00.123Z',
      opts: { gateKnownOn: true },
    });
  });

  it('a non-refusal error fails the whole import (rethrown)', async () => {
    engine.outcome.set('x', new NotFoundError('gone'));
    await expect(
      applyImportUpdates(stubTx(), 'Client', 'c-1', [candidate('x', 'CLI-1')], {
        dryRun: false,
        user,
      }),
    ).rejects.toThrow('gone');
  });
});

describe('applyImportUpdates — preview', () => {
  it('gate on → approval, or skip when an edit is already waiting; nothing staged', async () => {
    const cs = [candidate('a', 'OP-1'), candidate('b', 'OP-2')];
    const direct = await applyImportUpdates(stubTx(['b']), 'Operator', 'c-1', cs, {
      dryRun: true,
      user,
    });
    expect(direct).toEqual([]);
    expect(cs.map((c) => c.row.action)).toEqual(['approval', 'skip']);
    expect(cs[1]!.row.reason).toBe(waitingReason('Operator', 'OP-2'));
    expect(engine.calls).toHaveLength(0);
  });
  it('gate off → rows left as update, nothing to write', async () => {
    engine.gateOn = false;
    const cs = [candidate('a', 'OP-1')];
    expect(
      await applyImportUpdates(stubTx(), 'Operator', 'c-1', cs, { dryRun: true, user }),
    ).toEqual([]);
    expect(cs[0]!.row.action).toBe('update');
  });
});

describe('importApprovalRefusal', () => {
  it('words the version conflict and uses the screen name of the master', () => {
    const conflict = new AppError(409, 'edit_conflict', 'changed');
    expect(importApprovalRefusal(conflict, 'Client', 'CLI-7')).toBe(
      'Customer CLI-7 was changed by someone else during the import — run the import again',
    );
    expect(waitingReason('Client', 'CLI-7')).toContain('Customer CLI-7');
  });
  it('passes another 409 through and ignores non-409s', () => {
    expect(importApprovalRefusal(new ConflictError('GSTIN taken'), 'Vendor', 'V-1')).toBe(
      'GSTIN taken',
    );
    expect(importApprovalRefusal(new Error('boom'), 'Vendor', 'V-1')).toBeNull();
    expect(importApprovalRefusal(new NotFoundError('x'), 'Vendor', 'V-1')).toBeNull();
  });
});

describe('importCounts', () => {
  it('counts update and approval rows separately', () => {
    const rows = (['insert', 'update', 'approval', 'approval', 'skip'] as const).map(
      (action, i) => ({ index: i + 1, code: null, name: '', action }),
    );
    expect(importCounts(rows)).toEqual({ updated: 1, sentForApproval: 2 });
  });
});
