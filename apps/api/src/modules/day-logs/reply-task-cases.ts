// ADR-274 — a Super Admin's reply reaches the person's Task Board Inbox and the
// sender's Outbox, TEST database. Registered by service.test.ts (replyTaskCases())
// AFTER pendingCases(), whose file-level hooks set the company's first pending date
// to 2040-01-02 for the whole file: the blank-date cases below rely on it.
import { DAY_LOG_DATE_REF, DAY_LOG_ENTRY_REF } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import { permsFor } from '../tasks/history';
import * as tasksService from '../tasks/service';
import { type DayLogClock } from './rules';
import * as service from './service';
import {
  MON,
  add,
  at,
  fx,
  otherSuperAdmin,
  owner,
  sameDeptAdmin,
  superAdmin,
  work,
} from './test-fixture';

const C = at(MON, '17:00');
const BLANK = '2040-01-02';
const THU: DayLogClock = { today: '2040-01-05', nowMin: 12 * 60 };

const saved = async () => (await add(MON, C)).entries[0]!;
const sendEntry = (entryId: string, body: string, as: AuthContext = superAdmin()) =>
  service.sendReply(entryId, { body }, as);
const sendBlank = (body: string, as: AuthContext = superAdmin()) =>
  service.sendDayReply({ userId: fx.ownerBase.id, date: BLANK, body }, as, THU);

interface TaskFacts {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string;
  created_by: string;
  viewed: boolean;
}

/** Every live task of this entry / date, oldest first. */
const tasksOn = (refType: string, refId: string) =>
  db.execute(sql`
    SELECT id::text AS id, code, title, description, status, assigned_to::text AS assigned_to,
      created_by::text AS created_by, viewed_at IS NOT NULL AS viewed
    FROM public.tasks
    WHERE company_id = ${fx.ownerBase.companyId}::uuid AND linked_ref_type = ${refType}
      AND linked_ref_id = ${refId} AND deleted_at IS NULL
    ORDER BY created_at
  `) as unknown as Promise<TaskFacts[]>;
const entryTasks = (entryId: string) => tasksOn(DAY_LOG_ENTRY_REF, entryId);

/** The blank day's tasks (the header is opened by the first reply). */
async function blankTasks(): Promise<TaskFacts[]> {
  const [h] = (await db.execute(sql`
    SELECT id::text AS id FROM public.daily_reports
    WHERE user_id = ${fx.ownerBase.id}::uuid AND report_date = ${BLANK}::date
  `)) as unknown as Array<{ id: string }>;
  return tasksOn(DAY_LOG_DATE_REF, h!.id);
}

const bodiesOf = async (taskId: string, as: AuthContext = owner()) =>
  ((await tasksService.getTask(taskId, as)).dayLogReplies ?? []).map((r) => r.body);

/** A second Super Admin. TEST has one; a missing one must fail, not skip. */
function second(): AuthContext {
  const other = otherSuperAdmin();
  if (!other) throw new Error('TEST needs a third active user for the two-sender cases');
  return other;
}

/** Run `fn` with the owner's Task Board on Hide page, then put the row back. */
async function withBoardHidden<T>(fn: () => Promise<T>): Promise<T> {
  const [row] = (await db.execute(sql`
    SELECT forms FROM public.user_access
    WHERE user_id = ${fx.ownerBase.id}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ forms: Record<string, unknown> }>;
  const setForms = (forms: Record<string, unknown>) =>
    db.execute(sql`
      UPDATE public.user_access SET forms = ${JSON.stringify(forms)}::jsonb
      WHERE user_id = ${fx.ownerBase.id}::uuid AND deleted_at IS NULL`);
  await setForms({ ...row!.forms, taskboard_view: { viewOff: true } });
  try {
    return await fn();
  } finally {
    await setForms(row!.forms);
  }
}

export function replyTaskCases(): void {
  describe('Day Log reply task — one per entry / date per sender (ADR-274)', () => {
    it('an entry reply raises one task with the fixed wording', async () => {
      const e = await saved();
      await sendEntry(e.id, 'first');
      const t = await entryTasks(e.id);
      expect(t).toHaveLength(1);
      expect(t[0]).toMatchObject({
        title: 'Day Log 01-01-2001 — reply',
        description: null,
        status: 'todo',
        assigned_to: fx.ownerBase.id,
        created_by: fx.admin.id,
        viewed: false,
      });
    });

    it('a second reply reuses the task and makes it read New; the row holds both', async () => {
      const e = await saved();
      await sendEntry(e.id, 'first');
      await service.markRepliesSeen(e.id, owner());
      expect((await entryTasks(e.id))[0]!.viewed).toBe(true);
      await sendEntry(e.id, 'second');
      const t = await entryTasks(e.id);
      expect(t).toHaveLength(1);
      expect(t[0]!.viewed).toBe(false);
      const row = await tasksService.getTask(t[0]!.id, owner());
      expect(row.isUnread).toBe(true);
      expect(row.dayLogReplies!.map((r) => r.body)).toEqual(['first', 'second']);
      expect(row.dayLogReplies![0]!.seenAt).not.toBeNull();
      expect(row.dayLogReplies![1]!.seenAt).toBeNull();
    });

    it('two senders on one entry: two tasks, each holding only its own replies', async () => {
      const e = await saved();
      await sendEntry(e.id, 'from A');
      await sendEntry(e.id, 'from B', second());
      await sendEntry(e.id, 'from A again');
      const t = await entryTasks(e.id);
      expect(t.map((x) => x.created_by).sort()).toEqual([fx.admin.id, second().id].sort());
      const a = t.find((x) => x.created_by === fx.admin.id)!;
      const b = t.find((x) => x.created_by === second().id)!;
      expect(await bodiesOf(a.id)).toEqual(['from A', 'from A again']);
      expect(await bodiesOf(b.id)).toEqual(['from B']);
    });

    it('two senders on one blank date: two tasks, each holding only its own replies', async () => {
      await sendBlank('blank from A');
      await sendBlank('blank from B', second());
      const t = await blankTasks();
      expect(t).toHaveLength(2);
      expect(t[0]!.title).toBe('Day Log 02-01-2040 not entered');
      expect(t[0]!.description).toBe('Enter your Day Log for 02-01-2040.');
      const a = t.find((x) => x.created_by === fx.admin.id)!;
      const b = t.find((x) => x.created_by === second().id)!;
      expect(await bodiesOf(a.id)).toEqual(['blank from A']);
      expect(await bodiesOf(b.id)).toEqual(['blank from B']);
    });

    it('two replies fired together: both saved, one open task holding both', async () => {
      const e = await saved();
      const res = await Promise.allSettled([sendEntry(e.id, 'a'), sendEntry(e.id, 'b')]);
      expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      const t = await entryTasks(e.id);
      expect(t).toHaveLength(1);
      expect((await bodiesOf(t[0]!.id)).sort()).toEqual(['a', 'b']);
    });

    it('Task Board hidden: the reply saves, no task, replyGoesToInbox false', async () => {
      const e = await saved();
      const q = { userId: fx.ownerBase.id, date: MON };
      expect((await service.getPersonDay(q, superAdmin(), C)).replyGoesToInbox).toBe(true);
      expect((await service.getPersonDay(q, sameDeptAdmin(), C)).replyGoesToInbox).toBe(false);
      await withBoardHidden(async () => {
        expect((await service.getPersonDay(q, superAdmin(), C)).replyGoesToInbox).toBe(false);
        await sendEntry(e.id, 'nobody opens the board');
      });
      const day = await service.getPersonDay(q, superAdmin(), C);
      expect(day.entries[0]!.replies.map((r) => r.body)).toEqual(['nobody opens the board']);
      expect(await entryTasks(e.id)).toEqual([]);
    });
  });

  describe('Day Log reply task — the dot follows the reply (ADR-274)', () => {
    it('seen on the entry stamps the reply and the task in one statement', async () => {
      const e = await saved();
      await sendEntry(e.id, 'one');
      expect(await service.markRepliesSeen(e.id, owner())).toEqual({ seen: 1 });
      const t = (await entryTasks(e.id))[0]!;
      expect(t.viewed).toBe(true);
      const row = await tasksService.getTask(t.id, owner());
      expect(row.dayLogReplies![0]!.seenAt).not.toBeNull();
      expect(row.isUnread).toBe(false);
    });

    it('seen on the blank date stamps every sender’s task', async () => {
      await sendBlank('a');
      await sendBlank('b', second());
      expect(await service.markDayRepliesSeen({ date: BLANK }, owner())).toEqual({ seen: 2 });
      expect((await blankTasks()).map((t) => t.viewed)).toEqual([true, true]);
    });

    it('opening the Inbox leaves a reply task unread, an ordinary task read', async () => {
      const e = await saved();
      await sendEntry(e.id, 'one');
      const plain = await tasksService.createTask(
        { title: 'plain', assignedTo: fx.ownerBase.id, priority: 'medium', dueDate: BLANK },
        superAdmin(),
      );
      try {
        expect(plain.dayLogReplies).toBeNull();
        await tasksService.markTasksViewed(owner());
        expect((await entryTasks(e.id))[0]!.viewed).toBe(false);
        const [r] = (await db.execute(sql`
          SELECT viewed_at IS NOT NULL AS viewed FROM public.tasks WHERE id = ${plain.id}::uuid
        `)) as unknown as Array<{ viewed: boolean }>;
        expect(r!.viewed).toBe(true);
      } finally {
        await db.execute(sql`DELETE FROM public.task_history WHERE task_id = ${plain.id}::uuid`);
        await db.execute(sql`DELETE FROM public.tasks WHERE id = ${plain.id}::uuid`);
      }
    });

    it('an edit updates the row’s text, clears seen, and the task reads New', async () => {
      const e = await saved();
      const r = await sendEntry(e.id, 'before');
      await service.markRepliesSeen(e.id, owner());
      await service.editReply(r.id, { body: 'after', updatedAt: r.updatedAt }, superAdmin());
      const t = (await entryTasks(e.id))[0]!;
      expect(t.viewed).toBe(false);
      const row = await tasksService.getTask(t.id, owner());
      expect(row.dayLogReplies![0]).toMatchObject({ body: 'after', seenAt: null });
      expect(row.dayLogReplies![0]!.editedAt).not.toBeNull();
    });
  });

  describe('Day Log reply task — its life (ADR-274)', () => {
    it('complete, then reply: a new task; the old row keeps only its old replies', async () => {
      const e = await saved();
      await sendEntry(e.id, 'old life');
      const first = (await entryTasks(e.id))[0]!;
      await tasksService.completeTask(first.id, {}, owner());
      await sendEntry(e.id, 'new life');
      const t = await entryTasks(e.id);
      expect(t.map((x) => x.status)).toEqual(['completed', 'todo']);
      expect(t[0]!.id).toBe(first.id);
      expect(await bodiesOf(first.id)).toEqual(['old life']);
      expect(await bodiesOf(t[1]!.id)).toEqual(['new life']);
    });

    it('editing a reply on a completed task leaves it completed', async () => {
      const e = await saved();
      const r = await sendEntry(e.id, 'before');
      const t = (await entryTasks(e.id))[0]!;
      await tasksService.completeTask(t.id, {}, owner());
      await service.editReply(r.id, { body: 'after', updatedAt: r.updatedAt }, superAdmin());
      const now = await entryTasks(e.id);
      expect(now).toHaveLength(1);
      expect(now[0]!.status).toBe('completed');
      expect(await bodiesOf(t.id)).toEqual(['after']);
    });

    it('an entry task never closes by itself; a blank-date task closes for every sender', async () => {
      const e = await saved();
      await sendEntry(e.id, 'one');
      const day = await service.getDay({ date: MON }, owner(), C);
      await work(day.entries[0]!, C, 'owner changed the text');
      expect((await entryTasks(e.id))[0]!.status).toBe('todo');

      await sendBlank('a');
      await sendBlank('b', second());
      await service.addEntry(
        { date: BLANK, kind: 'work', description: 'x', startTime: '09:00', stopTime: '10:00' },
        owner(),
        THU,
      );
      expect((await blankTasks()).map((t) => t.status)).toEqual(['completed', 'completed']);
    });
  });

  describe('Day Log reply task — who may do what (ADR-274)', () => {
    it('the sender cannot complete, move, reassign or edit; the sender can cancel', async () => {
      const e = await saved();
      await sendEntry(e.id, 'one');
      const t = (await entryTasks(e.id))[0]!;
      const as = superAdmin();
      const row = await tasksService.getTask(t.id, as);
      expect(row.permissions).toMatchObject({
        canUpdateStatus: false,
        canComplete: false,
        canCancel: true,
        canReassign: false,
        canEdit: false,
        canComment: true,
        canAttach: true,
      });
      await expect(tasksService.completeTask(t.id, {}, as)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(
        tasksService.updateTaskStatus(t.id, { status: 'in_progress' }, as),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        tasksService.reassignTask(t.id, { assignedTo: second().id }, as),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(tasksService.updateTask(t.id, { title: 'x' }, as)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      expect((await entryTasks(e.id))[0]).toMatchObject({ status: 'todo', title: t.title });
      expect((await tasksService.cancelTask(t.id, {}, as)).status).toBe('cancelled');
    });

    it('the person it is for can complete it, and cannot cancel or edit it', async () => {
      const e = await saved();
      await sendEntry(e.id, 'one');
      const t = (await entryTasks(e.id))[0]!;
      const row = await tasksService.getTask(t.id, owner());
      expect(row.permissions).toMatchObject({
        canUpdateStatus: true,
        canComplete: true,
        canCancel: false,
        canReassign: false,
        canEdit: false,
      });
      expect((await tasksService.completeTask(t.id, {}, owner())).status).toBe('completed');
    });

    it('a role admin who is neither party may only cancel; other tasks are unchanged', () => {
      const admin = asAccess(fx.admin, { fullAccess: true }, 'admin');
      const r = { createdBy: 'a', assignedTo: 'b', assignedBy: 'a' };
      expect(permsFor({ ...r, linkedRefType: DAY_LOG_DATE_REF }, admin, true)).toMatchObject({
        canUpdateStatus: false,
        canComplete: false,
        canCancel: true,
        canReassign: false,
        canEdit: false,
      });
      for (const plain of [r, { ...r, linkedRefType: 'so' }]) {
        expect(permsFor(plain, admin, true)).toMatchObject({
          canUpdateStatus: true,
          canComplete: true,
          canCancel: true,
          canReassign: true,
          canEdit: true,
        });
      }
    });

    it('the link: the person keeps My Day Log, the sender opens the person’s day', async () => {
      const e = await saved();
      await sendEntry(e.id, 'one');
      const t = (await entryTasks(e.id))[0]!;
      const stored = `/task-board?view=daylog&date=${MON}&line=${e.id}`;
      const person = `/task-board?view=person&user=${fx.ownerBase.id}&date=${MON}`;
      expect((await tasksService.getTask(t.id, owner())).linkedRef?.navPage).toBe(stored);
      expect((await tasksService.getTask(t.id, superAdmin())).linkedRef?.navPage).toBe(person);

      const inbox = await tasksService.listTasks({ view: 'inbox', search: t.code }, owner());
      expect(inbox.tasks.map((x) => [x.linkedRef?.navPage, x.dayLogReplies?.length])).toEqual([
        [stored, 1],
      ]);
      const outbox = await tasksService.listTasks({ view: 'outbox', search: t.code }, superAdmin());
      expect(outbox.tasks.map((x) => [x.linkedRef?.navPage, x.dayLogReplies?.length])).toEqual([
        [person, 1],
      ]);
    });
  });

  describe('Day Log reply task — the text stays private (ADR-255, ADR-274)', () => {
    it('no reply text in tasks, task_comments, task_history or the activity log', async () => {
      const entryText = `dl-private-entry-${Date.now()}`;
      const blankText = `dl-private-blank-${Date.now()}`;
      const editedText = `dl-private-edited-${Date.now()}`;
      const e = await saved();
      const r = await sendEntry(e.id, entryText);
      await service.editReply(r.id, { body: editedText, updatedAt: r.updatedAt }, superAdmin());
      await sendBlank(blankText);
      const t = (await entryTasks(e.id))[0]!;
      // Positive: the text IS on the row, read live.
      expect(await bodiesOf(t.id)).toEqual([editedText]);
      expect(await bodiesOf((await blankTasks())[0]!.id)).toEqual([blankText]);

      for (const text of [entryText, blankText, editedText]) {
        const like = `%${text}%`;
        const company = sql`company_id = ${fx.ownerBase.companyId}::uuid`;
        const [c] = (await db.execute(sql`
          SELECT
            (SELECT count(*)::int FROM public.tasks WHERE ${company}
               AND (title LIKE ${like} OR description LIKE ${like} OR completion_remark LIKE ${like}
                    OR linked_ref_display LIKE ${like} OR linked_ref_nav_page LIKE ${like})) AS tasks,
            (SELECT count(*)::int FROM public.task_comments WHERE ${company} AND text LIKE ${like}) AS comments,
            (SELECT count(*)::int FROM public.task_history WHERE ${company}
               AND (note LIKE ${like} OR from_value LIKE ${like} OR to_value LIKE ${like})) AS history,
            (SELECT count(*)::int FROM public.activity_log WHERE ${company} AND detail LIKE ${like}) AS activity
        `)) as unknown as Array<Record<string, number>>;
        expect(c).toEqual({ tasks: 0, comments: 0, history: 0, activity: 0 });
      }
    });
  });
}
