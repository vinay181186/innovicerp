// ADR-264 / CLAUDE.md §20.2 — a task status change is a conditional UPDATE.
// Two "Complete" clicks (or two people) at the same moment: exactly one
// succeeds, the other gets 409 "Already completed by <name> at <time>".
// Also: a personal to-do keeps its linked document (ADR-264 Create to-do).
// Runs against the TEST database only (the main vitest config refuses PROD).
import { and, eq, ne } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { taskNotices, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('task status changes are conditional (§20.2)', () => {
  it('two completes at once: exactly one succeeds, the other is a 409', async () => {
    const todo = await service.createPersonalTodo(
      { title: 'adr262 race — complete twice', priority: 'medium' },
      admin,
    );
    const results = await Promise.allSettled([
      service.completeTask(todo.id, {}, admin),
      service.completeTask(todo.id, {}, admin),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(ConflictError);
    expect(String(failed[0]!.reason.message)).toMatch(/^Already completed by .+ at /);
    expect((await service.getTask(todo.id, admin)).status).toBe('completed');
  });

  it('complete then cancel: the cancel is told who completed it', async () => {
    const todo = await service.createPersonalTodo(
      { title: 'adr262 race — complete then cancel', priority: 'low' },
      admin,
    );
    await service.completeTask(todo.id, {}, admin);
    await expect(service.cancelTask(todo.id, { reason: 'too late' }, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('start and complete at once: the complete always succeeds', async () => {
    const todo = await service.createPersonalTodo(
      { title: 'adr264 race — start vs complete', priority: 'medium' },
      admin,
    );
    const [start, complete] = await Promise.allSettled([
      service.updateTaskStatus(todo.id, { status: 'in_progress' }, admin),
      service.completeTask(todo.id, {}, admin),
    ]);
    // Complete ends the task from any open status, so the move to In
    // Progress cannot make it fail. The start may win first or be told the
    // task is already completed — never anything else.
    expect(complete.status).toBe('fulfilled');
    if (start.status === 'rejected') expect(start.reason).toBeInstanceOf(ConflictError);
    expect((await service.getTask(todo.id, admin)).status).toBe('completed');
  });

  it('a personal to-do stores its linked document and stays private', async () => {
    const todo = await service.createPersonalTodo(
      {
        title: 'adr262 linked to-do',
        priority: 'medium',
        linkedRef: {
          type: 'sales_order',
          id: '00000000-0000-4000-8000-000000000001',
          display: 'IN-SO-TEST',
          navPage: '/sales-orders/00000000-0000-4000-8000-000000000001',
        },
      },
      admin,
    );
    expect(todo.linkedRef).toMatchObject({ type: 'sales_order', display: 'IN-SO-TEST' });
    expect(todo.assignedTo).toBe(admin.id);
    await service.cancelTask(todo.id, { reason: 'test cleanup' }, admin);
  });

  // ADR-309: a notice is written only by the update that actually ended the
  // task. Two cancels at once (admin = creator) -> the assignee gets exactly
  // one task_cancelled notice, plus the one task_assigned from the create.
  it('two cancels at once: exactly one cancelled notice for the assignee', async () => {
    const others = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.companyId, admin.companyId!),
          eq(users.isActive, true),
          ne(users.id, admin.id),
        ),
      )
      .limit(1);
    const assignee = others[0];
    if (!assignee) return; // TEST has one login only: nothing to notify
    const task = await service.createTask(
      {
        title: 'adr309 race - cancel twice',
        assignedTo: assignee.id,
        priority: 'low',
        dueDate: '2099-12-31',
      },
      admin,
    );
    const results = await Promise.allSettled([
      service.cancelTask(task.id, { reason: 'race 1' }, admin),
      service.cancelTask(task.id, { reason: 'race 2' }, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const notices = await db
      .select({ kind: taskNotices.kind, recipientId: taskNotices.recipientId })
      .from(taskNotices)
      .where(eq(taskNotices.taskId, task.id));
    expect(notices.filter((n) => n.kind === 'task_cancelled')).toEqual([
      { kind: 'task_cancelled', recipientId: assignee.id },
    ]);
    expect(notices.filter((n) => n.kind === 'task_assigned')).toHaveLength(1);
  });
});
