// ADR-309 — pop-up words, link, VAPID switch and per-row decision. No DB.
import { describe, expect, it } from 'vitest';
import { taskNote } from '../dashboard/personal/task-notes';
import { buildTaskPushPayload, ddmmyyyy, initialsOf, pushDecision, vapidFrom } from './payload';

const NOTICE = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const base = {
  noticeId: NOTICE,
  taskId: TASK,
  code: 'TSK-00123',
  title: 'Check drawing rev C',
  dueDate: '2026-11-20',
  priority: 'high' as const,
  actorName: 'Rakesh Patel',
  completionRemark: null,
};

describe('buildTaskPushPayload', () => {
  it('assigned: heading, body with From / Due / Priority, inbox link', () => {
    const p = buildTaskPushPayload({ ...base, kind: 'task_assigned' });
    expect(p.title).toBe('New task for you · TSK-00123');
    expect(p.body).toBe('Check drawing rev C\nFrom Rakesh Patel · Due 20-11-2026 · High');
    expect(p.href).toBe(`/task-board?view=inbox&task=${TASK}`);
    expect(p.actorInitials).toBe('RP');
  });

  it('completed: remark line only when present, outbox link', () => {
    const p = buildTaskPushPayload({ ...base, kind: 'task_completed' });
    expect(p.title).toBe('Task completed · TSK-00123');
    expect(p.body).toBe('Rakesh Patel completed "Check drawing rev C"');
    expect(p.href).toBe(`/task-board?view=outbox&task=${TASK}`);
    const r = buildTaskPushPayload({
      ...base,
      kind: 'task_completed',
      completionRemark: 'Done, see file',
    });
    expect(r.body).toBe('Rakesh Patel completed "Check drawing rev C"\nRemark: Done, see file');
  });

  it('cancelled: heading and body, inbox link', () => {
    const p = buildTaskPushPayload({ ...base, kind: 'task_cancelled' });
    expect(p.title).toBe('Task cancelled · TSK-00123');
    expect(p.body).toBe('Rakesh Patel cancelled "Check drawing rev C"');
    expect(p.href).toBe(`/task-board?view=inbox&task=${TASK}`);
  });

  it('long text is clipped to the shared limits; a missing actor reads Someone', () => {
    const p = buildTaskPushPayload({
      ...base,
      kind: 'task_cancelled',
      title: 'x'.repeat(500),
      actorName: null,
    });
    expect(p.body.length).toBeLessThanOrEqual(300);
    expect(p.body.startsWith('Someone cancelled')).toBe(true);
    expect(p.actorInitials).toBeNull();
  });

  it('helpers', () => {
    expect(ddmmyyyy('2026-01-05')).toBe('05-01-2026');
    expect(ddmmyyyy(null)).toBeNull();
    expect(initialsOf('Jinal')).toBe('J');
  });
});

describe('sender switches', () => {
  it('missing VAPID keys: off', () => {
    expect(vapidFrom({})).toBeNull();
    expect(vapidFrom({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k' })).toBeNull();
    expect(
      vapidFrom({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:a@b.c' }),
    ).toEqual({ publicKey: 'p', privateKey: 'k', subject: 'mailto:a@b.c' });
    const now = new Date('2026-11-18T10:00:00Z');
    expect(pushDecision(now, { vapidOn: false, hasSubscription: true, now })).toBe('off');
  });

  it('no subscription: off; older than 24 h: failed; else send', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(pushDecision(now, { vapidOn: true, hasSubscription: false, now })).toBe('off');
    expect(
      pushDecision(new Date('2026-11-17T09:00:00Z'), { vapidOn: true, hasSubscription: true, now }),
    ).toBe('failed');
    expect(pushDecision(now, { vapidOn: true, hasSubscription: true, now })).toBe('send');
  });
});

describe('bell note', () => {
  it('words and links like the pop-up', () => {
    const n = taskNote({
      id: NOTICE,
      kind: 'task_completed',
      taskId: TASK,
      code: 'TSK-00123',
      title: 'Check drawing rev C',
      actor: 'Rakesh Patel',
      ts: '2026-11-18T10:00:00.000Z',
    });
    expect(n.key).toBe(`task:${NOTICE}`);
    expect(n.tone).toBe('ok');
    expect(n.text).toEqual([
      { text: 'Rakesh Patel completed ' },
      { code: 'TSK-00123', href: `/task-board?view=outbox&task=${TASK}` },
      { text: ' · Check drawing rev C' },
    ]);
  });
});
