// ADR-309 — who is told about a task event (owner rules 2026-11-18). No DB.
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { type TaskNoticeParties, recordTaskNotices, taskNoticeRecipients } from './notices';

const A = 'aaaaaaaa-0000-4000-8000-000000000001'; // assigner / creator
const B = 'bbbbbbbb-0000-4000-8000-000000000002'; // assignee
const C = 'cccccccc-0000-4000-8000-000000000003'; // a third person (admin)
const HIDDEN = 'dddddddd-0000-4000-8000-000000000004'; // Task Board hidden
const CID = 'eeeeeeee-0000-4000-8000-000000000005';

// The real rule loads the db client (env); the Task Board answer is all the
// caller test needs: everyone opens it except HIDDEN.
vi.mock('../access-control/users-with-right', () => ({
  personHolds: (r: { id?: string }) => r.id !== HIDDEN,
}));

const who = (p: TaskNoticeParties): string[] => taskNoticeRecipients(p);

describe('taskNoticeRecipients', () => {
  it('assign to someone else: the assignee only', () => {
    expect(
      who({ kind: 'task_assigned', assignedTo: B, assignedBy: A, createdBy: A, actorId: A }),
    ).toEqual([B]);
  });

  it('assign to yourself (QC Pick Up): nobody', () => {
    expect(
      who({ kind: 'task_assigned', assignedTo: A, assignedBy: A, createdBy: C, actorId: A }),
    ).toEqual([]);
  });

  it('reassign back to the creator by someone else: the creator IS told', () => {
    // A created it for B; C hands it back to A → looks like created_by =
    // assigned_to, but it is not A's own to-do.
    expect(
      who({ kind: 'task_assigned', assignedTo: A, assignedBy: C, createdBy: A, actorId: C }),
    ).toEqual([A]);
    // B hands it back to A.
    expect(
      who({ kind: 'task_assigned', assignedTo: A, assignedBy: B, createdBy: A, actorId: B }),
    ).toEqual([A]);
  });

  it('own to-do assigned by its owner: nobody (actor rule)', () => {
    expect(
      who({ kind: 'task_assigned', assignedTo: A, assignedBy: A, createdBy: A, actorId: A }),
    ).toEqual([]);
  });

  it('complete by the assignee, assigner differs from creator: both, deduped', () => {
    expect(
      who({ kind: 'task_completed', assignedTo: B, assignedBy: C, createdBy: A, actorId: B }),
    ).toEqual([C, A]);
    expect(
      who({ kind: 'task_completed', assignedTo: B, assignedBy: A, createdBy: A, actorId: B }),
    ).toEqual([A]);
  });

  it('complete by the assigner: not the assigner; the creator if different', () => {
    expect(
      who({ kind: 'task_completed', assignedTo: B, assignedBy: A, createdBy: A, actorId: A }),
    ).toEqual([]);
    expect(
      who({ kind: 'task_completed', assignedTo: B, assignedBy: C, createdBy: A, actorId: C }),
    ).toEqual([A]);
  });

  it('cancel: the assignee, never the canceller', () => {
    expect(
      who({ kind: 'task_cancelled', assignedTo: B, assignedBy: A, createdBy: A, actorId: A }),
    ).toEqual([B]);
    expect(
      who({ kind: 'task_cancelled', assignedTo: B, assignedBy: A, createdBy: A, actorId: B }),
    ).toEqual([]);
  });

  it('private to-do (created_by = assigned_to): nobody on complete / cancel', () => {
    for (const kind of ['task_completed', 'task_cancelled'] as const) {
      expect(who({ kind, assignedTo: A, assignedBy: C, createdBy: A, actorId: C })).toEqual([]);
      expect(who({ kind, assignedTo: A, assignedBy: C, createdBy: A, actorId: A })).toEqual([]);
    }
  });

  it('null ids are dropped', () => {
    expect(
      who({ kind: 'task_completed', assignedTo: B, assignedBy: null, createdBy: null, actorId: B }),
    ).toEqual([]);
    expect(
      who({ kind: 'task_assigned', assignedTo: null, assignedBy: A, createdBy: A, actorId: A }),
    ).toEqual([]);
  });
});

/** A transaction double: counts selects, records inserted values. */
function fakeTx(people: string[]) {
  const seen = { selects: 0, inserts: [] as Array<Array<Record<string, unknown>>> };
  const rows = people.map((id) => ({ id, role: 'manager' }));
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'leftJoin', 'where']) chain[m] = () => chain;
  chain['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  const tx = {
    select: () => {
      seen.selects += 1;
      return chain;
    },
    insert: () => ({
      values: (v: Array<Record<string, unknown>>) => {
        seen.inserts.push(v);
        return {
          onConflictDoNothing: () => ({
            returning: async () => v.map((_, i) => ({ id: String(i) })),
          }),
        };
      },
    }),
  };
  return { tx: tx as unknown as DbTransaction, seen };
}

const user = { id: C } as AuthContext;
const at = new Date('2026-11-19T10:00:00Z');

describe('recordTaskNotices (caller side)', () => {
  it('Task Board hidden: no notice for that person (bell and pop-up agree)', async () => {
    const { tx, seen } = fakeTx([B, HIDDEN]);
    const n = await recordTaskNotices(
      tx,
      [
        {
          companyId: CID,
          task: { id: 't1', assignedTo: B, assignedBy: C, createdBy: C },
          kind: 'task_assigned',
          actorId: C,
          eventAt: at,
        },
        {
          companyId: CID,
          task: { id: 't2', assignedTo: HIDDEN, assignedBy: C, createdBy: C },
          kind: 'task_assigned',
          actorId: C,
          eventAt: at,
        },
      ],
      user,
    );
    expect(n).toBe(1);
    expect(seen.inserts[0]!.map((r) => r['recipientId'])).toEqual([B]);
  });

  it('many closed tasks: ONE access read and ONE insert', async () => {
    const { tx, seen } = fakeTx([A, B]);
    const n = await recordTaskNotices(
      tx,
      ['t1', 't2', 't3'].map((id) => ({
        companyId: CID,
        task: { id, assignedTo: B, assignedBy: A, createdBy: A },
        kind: 'task_completed' as const,
        actorId: C,
        eventAt: at,
      })),
      user,
    );
    expect(n).toBe(3);
    expect(seen.selects).toBe(1);
    expect(seen.inserts).toHaveLength(1);
    expect(seen.inserts[0]!.map((r) => r['taskId'])).toEqual(['t1', 't2', 't3']);
  });

  it('nobody to tell: no read, no insert', async () => {
    const { tx, seen } = fakeTx([]);
    const n = await recordTaskNotices(
      tx,
      {
        companyId: CID,
        task: { id: 't1', assignedTo: A, assignedBy: A, createdBy: A },
        kind: 'task_assigned',
        actorId: A,
        eventAt: at,
      },
      user,
    );
    expect(n).toBe(0);
    expect(seen.selects).toBe(0);
    expect(seen.inserts).toHaveLength(0);
  });
});
