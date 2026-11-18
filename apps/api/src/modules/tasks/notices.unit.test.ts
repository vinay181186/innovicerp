// ADR-309 — who is told about a task event (owner rules 2026-11-18). No DB.
import { describe, expect, it } from 'vitest';
import { type TaskNoticeParties, taskNoticeRecipients } from './notices';

const A = 'aaaaaaaa-0000-4000-8000-000000000001'; // assigner / creator
const B = 'bbbbbbbb-0000-4000-8000-000000000002'; // assignee
const C = 'cccccccc-0000-4000-8000-000000000003'; // a third person (admin)

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

  it('private to-do (created_by = assigned_to): nobody, for every kind', () => {
    for (const kind of ['task_assigned', 'task_completed', 'task_cancelled'] as const) {
      expect(who({ kind, assignedTo: A, assignedBy: C, createdBy: A, actorId: C })).toEqual([]);
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
