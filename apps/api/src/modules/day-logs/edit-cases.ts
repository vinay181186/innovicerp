// Day Log — Start / Stop / SO-JWSO edits saved DIRECTLY, ONE Entry Rev
// history for every save (ADR-256, owner 2026-10-30), TEST database.
// Registered by service.test.ts (editCases()) so it shares that file's
// fixture and runs in the same file.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { ConflictError } from '../../lib/errors';
import * as service from './service';
import {
  MON,
  add,
  at,
  edit,
  entryRevsOf,
  fx,
  owner,
  sameDeptAdmin,
  stagePending,
  superAdmin,
  times,
  work,
} from './test-fixture';

const C = at(MON, '17:00');
const W = 'test work';

/** One saved row 09:00–10:00, as the owner loaded it. */
const saved = async () =>
  (await add(MON, C, { startTime: '09:00', stopTime: '10:00' })).entries[0]!;

/** The Day Log activity rows of one day header. */
async function activityOf(reportId: string) {
  return (await db.execute(sql`
    SELECT action, detail FROM public.activity_log
    WHERE entity = 'Day Log' AND entity_id = ${reportId}::uuid ORDER BY created_at
  `)) as unknown as Array<{ action: string; detail: string }>;
}

export function editCases(): void {
  describe('Day Log — direct Start / Stop / SO edit, one Entry Rev history (ADR-256)', () => {
    it('an edit changes the live values at once and adds Entry Rev 1; nothing waits', async () => {
      const e = await saved();
      // Working On sent along is IGNORED (ADR-255).
      const d = await edit(e, C, { stopTime: '10:30', description: 'longer' });
      const row = d.entries[0]!;
      expect([row.fromTime, row.toTime, row.minutes, row.description]).toEqual([
        '09:00',
        '10:30',
        90,
        W,
      ]);
      expect([row.pending, row.rejectReason]).toEqual([null, null]);
      expect(row.updatedAt).not.toBe(e.updatedAt);
      const day = await service.getDay({ date: MON }, owner(), C);
      expect(times(day)).toEqual([['09:00', '10:30']]);
      expect(day.entries[0]!.pending).toBeNull();
      expect(await entryRevsOf(e.id)).toEqual([
        [0, W, '09:00', '10:00', null],
        [1, W, '09:00', '10:30', null],
      ]);
      const appr = await service.getApprovals(sameDeptAdmin());
      expect(appr.rows.map((r) => r.entryId)).not.toContain(e.id);
      // One EDIT activity row, times only — no Working On text.
      const act = (await activityOf(d.id!)).filter((a) => a.action === 'EDIT');
      expect(act).toHaveLength(1);
      expect(act[0]!.detail).toMatch(/changed 09:00 AM–10:00 AM to 09:00 AM–10:30 AM$/);
      expect(act[0]!.detail).not.toContain(W);
    });

    it('SO added, then Start moved: Entry Revs 1 and 2 carry the whole line', async () => {
      const e = await saved();
      const d1 = await edit(e, C, { orderType: 'so', orderId: fx.openSo.id });
      const r1 = d1.entries[0]!;
      expect(r1.order).toEqual({ type: 'so', id: fx.openSo.id, code: fx.openSo.code });
      const d2 = await edit(r1, C, { startTime: '08:30' });
      expect(times(d2)).toEqual([['08:30', '10:00']]);
      expect(await entryRevsOf(e.id)).toEqual([
        [0, W, '09:00', '10:00', null],
        [1, W, '09:00', '10:00', fx.openSo.id],
        [2, W, '08:30', '10:00', fx.openSo.id],
      ]);
    });

    it('a Working On edit adds an Entry Rev with the times unchanged; a time edit keeps the text', async () => {
      const e = await saved();
      const d1 = await work(e, C, 'v1');
      await edit(d1.entries[0]!, C, { stopTime: '10:45' });
      expect(await entryRevsOf(e.id)).toEqual([
        [0, W, '09:00', '10:00', null],
        [1, 'v1', '09:00', '10:00', null],
        [2, 'v1', '09:00', '10:45', null],
      ]);
    });

    it('a stale updatedAt is a 409 and adds no Entry Rev', async () => {
      const e = await saved();
      await edit(e, C, { stopTime: '10:30' });
      const err = await edit(e, C, { stopTime: '10:15' }).catch((x: unknown) => x);
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as Error).message).toMatch(/^This entry was changed at .* — reload/);
      expect((await entryRevsOf(e.id)).map((r) => r[0])).toEqual([0, 1]);
      const day = await service.getDay({ date: MON }, owner(), C);
      expect(times(day)).toEqual([['09:00', '10:30']]);
    });

    it('Working On alone is "Nothing changed" here; an overlap is refused — no Entry Rev', async () => {
      await add(MON, C, { startTime: '10:00', stopTime: '11:00' });
      const e = await saved();
      await expect(edit(e, C, { description: 'other text' })).rejects.toThrow('Nothing changed');
      await expect(edit(e, C, { stopTime: '10:30' })).rejects.toThrow(
        /^Overlaps 10:00 AM – 11:00 AM/,
      );
      expect((await entryRevsOf(e.id)).map((r) => r[0])).toEqual([0]);
    });

    it('two edits of the same load at once — exactly one wins, one Entry Rev', async () => {
      const e = await saved();
      const res = await Promise.allSettled([
        edit(e, C, { stopTime: '10:30' }),
        edit(e, C, { stopTime: '10:45' }),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictError);
      expect((await entryRevsOf(e.id)).map((r) => r[0])).toEqual([0, 1]);
    });

    it('approving an OLD waiting edit adds an Entry Rev; rejecting one adds none', async () => {
      const e = await saved();
      const p1 = await stagePending(e, C, '10:30');
      await service.rejectEntry(
        e.id,
        { requestedAt: p1.pending!.requestedAt, reason: 'not right' },
        sameDeptAdmin(),
      );
      expect((await entryRevsOf(e.id)).map((r) => r[0])).toEqual([0]);
      const p2 = await stagePending(e, C, '10:45');
      await service.approveEntry(
        e.id,
        { requestedAt: p2.pending!.requestedAt },
        sameDeptAdmin(),
        C,
      );
      expect(await entryRevsOf(e.id)).toEqual([
        [0, W, '09:00', '10:00', null],
        [1, W, '09:00', '10:45', null],
      ]);
    });

    it('person-day: a Super Admin sees every Entry Rev in full, newest first; an L5 sees none', async () => {
      const e = await saved();
      const d1 = await edit(e, C, { stopTime: '10:30' });
      await edit(d1.entries[0]!, C, { orderType: 'so', orderId: fx.openSo.id });
      const q = { userId: fx.ownerBase.id, date: MON };
      const s = await service.getPersonDay(q, superAdmin(), C);
      const se = s.entries[0]!;
      expect(se.entryRevNo).toBe(2);
      expect(se.entryRevisedAt).not.toBeNull();
      expect(se.revisions.every((r) => typeof r.savedAt === 'string')).toBe(true);
      expect(
        se.revisions.map((r) => [r.entryRevNo, r.description, r.fromTime, r.toTime, r.order]),
      ).toEqual([
        [2, W, '09:00', '10:30', { type: 'so', id: fx.openSo.id, code: fx.openSo.code }],
        [1, W, '09:00', '10:30', null],
        [0, W, '09:00', '10:00', null],
      ]);
      const l = await service.getPersonDay(q, sameDeptAdmin(), C);
      expect(l.isSuperAdmin).toBe(false);
      expect(l.entries[0]).toMatchObject({
        entryRevNo: null,
        entryRevisedAt: null,
        revisions: [],
        toTime: '10:30',
      });
    });
  });
}
