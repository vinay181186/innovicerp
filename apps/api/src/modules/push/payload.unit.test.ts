// ADR-309 — pop-up words, link, VAPID switch and per-row decision. No DB.
import { PgDialect } from 'drizzle-orm/pg-core';
import webpush from 'web-push';
import { describe, expect, it } from 'vitest';
import { taskNote } from '../dashboard/personal/task-notes';
import { claimPendingSql } from './claim';
import {
  assertDesktopPopupsAllowed,
  buildTaskPushPayload,
  DESKTOP_POPUPS_DISABLED_MESSAGE,
  ddmmyyyy,
  initialsOf,
  pushConfigFor,
  pushDecision,
  taskNoticeHref,
  vapidFrom,
} from './payload';
import { vapidProblem } from './vapid';

const NOTICE = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const base = {
  noticeId: NOTICE,
  taskId: TASK,
  recipientIsCreator: false,
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

  it('completed: remark line only when present; Outbox link only for the creator', () => {
    const p = buildTaskPushPayload({ ...base, kind: 'task_completed', recipientIsCreator: true });
    expect(p.title).toBe('Task completed · TSK-00123');
    expect(p.body).toBe('Rakesh Patel completed "Check drawing rev C"');
    expect(p.href).toBe(`/task-board?view=outbox&task=${TASK}`);
    // An assigner who did not create it: not in their Outbox → ?task only.
    expect(buildTaskPushPayload({ ...base, kind: 'task_completed' }).href).toBe(
      `/task-board?task=${TASK}`,
    );
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

describe('taskNoticeHref', () => {
  it('assigned / cancelled → Inbox whoever created it', () => {
    for (const creator of [true, false]) {
      expect(taskNoticeHref('task_assigned', TASK, creator)).toBe(
        `/task-board?view=inbox&task=${TASK}`,
      );
      expect(taskNoticeHref('task_cancelled', TASK, creator)).toBe(
        `/task-board?view=inbox&task=${TASK}`,
      );
    }
  });
  it('completed → Outbox for the creator, else ?task only', () => {
    expect(taskNoticeHref('task_completed', TASK, true)).toBe(
      `/task-board?view=outbox&task=${TASK}`,
    );
    expect(taskNoticeHref('task_completed', TASK, false)).toBe(`/task-board?task=${TASK}`);
  });
});

describe('claim statement', () => {
  const q = new PgDialect().sqlToQuery(claimPendingSql(50, 15_000));
  it('is one UPDATE … IN (SELECT … SKIP LOCKED) with the backoff lease', () => {
    const text = q.sql.replace(/\s+/g, ' ');
    expect(text).toMatch(
      /^ ?UPDATE public\.task_notices n SET push_attempts = n\.push_attempts \+ 1/,
    );
    expect(text).toContain("p.push_status = 'pending' AND p.deleted_at IS NULL");
    expect(text).toContain('p.push_attempts = 0 OR p.updated_at < now() - (');
    expect(text).toContain('FOR UPDATE SKIP LOCKED');
    expect(text).toContain('ORDER BY p.event_at');
    expect(text).toContain('RETURNING');
    expect(q.params).toEqual([15_000, 50]);
  });
  it("ADR-314: flags rows whose recipient's Desktop Pop-ups are disabled", () => {
    const text = q.sql.replace(/\s+/g, ' ');
    expect(text).toContain(
      "COALESCE((SELECT u.desktop_popups = 'disabled' FROM public.users u WHERE u.id = n.recipient_id), false) AS popups_off",
    );
  });
});

describe('Desktop Pop-ups switch (ADR-314)', () => {
  const keys = { publicKey: 'pub' };
  it('disabled → config enabled false, no key; allowed → on; no server keys → off', () => {
    expect(pushConfigFor('disabled', keys)).toEqual({ enabled: false, publicKey: null });
    expect(pushConfigFor('allowed', keys)).toEqual({ enabled: true, publicKey: 'pub' });
    expect(pushConfigFor(null, keys)).toEqual({ enabled: true, publicKey: 'pub' });
    expect(pushConfigFor('allowed', null)).toEqual({ enabled: false, publicKey: null });
  });
  it('subscribe / test refused with 403 for a disabled login only', () => {
    expect(() => assertDesktopPopupsAllowed('disabled')).toThrow(DESKTOP_POPUPS_DISABLED_MESSAGE);
    try {
      assertDesktopPopupsAllowed('disabled');
    } catch (e) {
      expect((e as { statusCode?: number }).statusCode).toBe(403);
    }
    expect(() => assertDesktopPopupsAllowed('allowed')).not.toThrow();
    expect(() => assertDesktopPopupsAllowed(null)).not.toThrow();
  });
});

describe('VAPID validation', () => {
  const good = webpush.generateVAPIDKeys();
  it('valid keys and subject: no problem', () => {
    expect(
      vapidProblem({
        publicKey: good.publicKey,
        privateKey: good.privateKey,
        subject: 'mailto:a@b.c',
      }),
    ).toBeNull();
  });
  it('bad subject / bad public key / bad private key: a reason', () => {
    expect(
      vapidProblem({
        publicKey: good.publicKey,
        privateKey: good.privateKey,
        subject: 'not a url',
      }),
    ).toEqual(expect.any(String));
    expect(
      vapidProblem({ publicKey: 'p', privateKey: good.privateKey, subject: 'mailto:a@b.c' }),
    ).toEqual(expect.any(String));
    expect(
      vapidProblem({ publicKey: good.publicKey, privateKey: 'k', subject: 'mailto:a@b.c' }),
    ).toEqual(expect.any(String));
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
      recipientIsCreator: true,
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

describe('bell and pop-up links agree', () => {
  it('same href for every kind and creator flag', () => {
    for (const kind of ['task_assigned', 'task_completed', 'task_cancelled'] as const) {
      for (const recipientIsCreator of [true, false]) {
        const bell = taskNote({
          id: NOTICE,
          kind,
          taskId: TASK,
          recipientIsCreator,
          code: 'TSK-00123',
          title: 't',
          actor: 'Rakesh Patel',
          ts: '2026-11-18T10:00:00.000Z',
        });
        const pop = buildTaskPushPayload({ ...base, kind, recipientIsCreator });
        expect(bell.text[1]).toEqual({ code: 'TSK-00123', href: pop.href });
      }
    }
  });
});
