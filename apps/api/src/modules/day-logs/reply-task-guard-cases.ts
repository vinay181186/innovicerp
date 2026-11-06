// ADR-274 — two guards on a Day Log reply task, TEST database. Registered by
// service.test.ts after replyTaskCases().
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { ConflictError } from '../../lib/errors';
import * as tasksService from '../tasks/service';
import { blankTasks, entryTasks, saved, sendBlank, sendEntry } from './reply-task-cases';
import { owner, sameDeptAdmin } from './test-fixture';

export function replyTaskGuardCases(): void {
  describe('Day Log reply task — guards (ADR-274)', () => {
    it('Complete from a stale screen is refused when a new reply arrived', async () => {
      const e = await saved();
      await sendEntry(e.id, 'one');
      const t = (await entryTasks(e.id))[0]!;
      const loaded = (await tasksService.getTask(t.id, owner())).updatedAt;
      await new Promise((r) => setTimeout(r, 5)); // updated_at has ms precision here
      await sendEntry(e.id, 'two');
      await expect(
        tasksService.completeTask(t.id, { updatedAt: loaded }, owner()),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await entryTasks(e.id))[0]).toMatchObject({ status: 'todo' });
      const fresh = (await tasksService.getTask(t.id, owner())).updatedAt;
      const done = await tasksService.completeTask(t.id, { updatedAt: fresh }, owner());
      expect(done.status).toBe('completed');
    });

    it('a blank-date task reassigned before ADR-274 shows no reply text', async () => {
      await sendBlank('private');
      const t = (await blankTasks())[0]!;
      const other = sameDeptAdmin();
      await db.execute(sql`
        UPDATE public.tasks SET assigned_to = ${other.id}::uuid WHERE id = ${t.id}::uuid`);
      expect((await tasksService.getTask(t.id, other)).dayLogReplies).toEqual([]);
    });
  });
}
