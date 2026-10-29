// Day Log — EDIT APPROVAL (0225, owner 2026-10-27), TEST database.
// Registered by service.test.ts (approvalCases()) so it shares that file's
// fixture and runs in the same file, one test after another.
import { describe, expect, it } from 'vitest';
import { AuthorizationError, ConflictError } from '../../lib/errors';
import * as service from './service';
import {
  MON,
  add,
  at,
  edit,
  fx,
  otherDeptAdmin,
  owner,
  ownerAsAdmin,
  sameDeptAdmin,
  times,
} from './test-fixture';

const C = at(MON, '17:00');

/** One saved row 09:00–10:00 and its edit request to 09:00–10:30. It also
 *  sends Working On "longer" — IGNORED on this path (ADR-255). */
async function requested() {
  const d = await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
  const e = d.entries[0]!;
  const after = await edit(e, C, { stopTime: '10:30', description: 'longer' });
  return { e, after: after.entries[0]! };
}

const mine = async () =>
  (await service.getApprovals(sameDeptAdmin())).rows.filter((r) => r.userId === fx.ownerBase.id);

export function approvalCases(): void {
  describe('Day Log — edit approval', () => {
    it('an edit goes pending; the live values do not change; the sent text is ignored', async () => {
      const { after } = await requested();
      expect([after.fromTime, after.toTime, after.description]).toEqual([
        '09:00',
        '10:00',
        'test work',
      ]);
      expect(after.pending).toMatchObject({
        fromTime: '09:00',
        toTime: '10:30',
        description: 'test work', // ADR-255 — the live text, not "longer"
        order: null,
      });
      const day = await service.getDay({ date: MON }, owner(), C);
      expect(times(day)).toEqual([['09:00', '10:00']]);
      expect(day.entries[0]!.pending?.toTime).toBe('10:30');
      const rows = await mine();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entryId: after.id,
        date: MON,
        current: { fromTime: '09:00', toTime: '10:00', description: 'test work' },
        proposed: { fromTime: '09:00', toTime: '10:30', description: 'test work' },
      });
    });

    it('an edit of Working On alone is "Nothing changed" here (ADR-255)', async () => {
      const d = await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
      await expect(edit(d.entries[0]!, C, { description: 'other text' })).rejects.toThrow(
        'Nothing changed',
      );
    });

    it('a second edit while one waits is a 409; a stale updatedAt is a 409', async () => {
      const { e, after } = await requested();
      await expect(edit(after, C, { stopTime: '10:15' })).rejects.toThrow(
        'An edit is already waiting for approval',
      );
      // Rejected → nothing waits; the ORIGINAL load (old updatedAt) is now stale.
      await service.rejectEntry(
        after.id,
        { requestedAt: after.pending!.requestedAt, reason: 'not right' },
        sameDeptAdmin(),
      );
      await expect(edit(e, C, { stopTime: '10:15' })).rejects.toBeInstanceOf(ConflictError);
    });

    it('the proposed values are checked like a new row (overlap with the others)', async () => {
      await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
      const d = await add(MON, C, { startTime: '10:00', stopTime: '11:00' });
      await expect(edit(d.entries[1]!, C, { startTime: '09:30' })).rejects.toThrow(
        /^Overlaps 09:00 AM – 10:00 AM/,
      );
    });

    it('a same-department L5 approves: the new times apply, the text does not; a second decision is a 409', async () => {
      const { after } = await requested();
      const res = await service.approveEntry(
        after.id,
        { requestedAt: after.pending!.requestedAt },
        sameDeptAdmin(),
        C,
      );
      expect(res.rows.filter((r) => r.entryId === after.id)).toHaveLength(0);
      const day = await service.getDay({ date: MON }, owner(), C);
      const row = day.entries[0]!;
      expect([row.fromTime, row.toTime, row.description, row.minutes]).toEqual([
        '09:00',
        '10:30',
        'test work', // ADR-255 — approving never changes Working On
        90,
      ]);
      expect(row.pending).toBeNull();
      await expect(
        service.approveEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt },
          sameDeptAdmin(),
          C,
        ),
      ).rejects.toThrow('This edit was already approved or rejected — reload');
      await expect(
        service.rejectEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt, reason: 'late' },
          sameDeptAdmin(),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('approve and reject at once — exactly one wins', async () => {
      const { after } = await requested();
      const res = await Promise.allSettled([
        service.approveEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt },
          sameDeptAdmin(),
          C,
        ),
        service.rejectEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt, reason: 'no thanks' },
          sameDeptAdmin(),
        ),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictError);
    });

    it('reject keeps the values and shows the reason; the next edit clears it', async () => {
      const { after } = await requested();
      await service.rejectEntry(
        after.id,
        { requestedAt: after.pending!.requestedAt, reason: 'Stop was 10:00' },
        sameDeptAdmin(),
      );
      const day = await service.getDay({ date: MON }, owner(), C);
      const row = day.entries[0]!;
      expect([row.toTime, row.description, row.pending, row.rejectReason]).toEqual([
        '10:00',
        'test work',
        null,
        'Stop was 10:00',
      ]);
      const again = await edit(row, C, { stopTime: '10:15' });
      expect(again.entries[0]!.rejectReason).toBeNull();
      expect(again.entries[0]!.pending?.toTime).toBe('10:15');
    });

    it('approval re-checks overlap against the rows saved since the request', async () => {
      const { after } = await requested(); // asks 09:00–10:30
      await add(MON, C, { startTime: '10:15', stopTime: '11:00' });
      await expect(
        service.approveEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt },
          sameDeptAdmin(),
          C,
        ),
      ).rejects.toThrow(/^Cannot approve — Overlaps 10:15 AM – 11:00 AM/);
    });

    it('nobody approves their own edit; another department L5 cannot either', async () => {
      const { after } = await requested();
      await expect(
        service.approveEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt },
          ownerAsAdmin(),
          C,
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        service.approveEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt },
          otherDeptAdmin(),
          C,
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        service.rejectEntry(
          after.id,
          { requestedAt: after.pending!.requestedAt, reason: 'nope' },
          otherDeptAdmin(),
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect((await service.getApprovals(ownerAsAdmin())).rows.map((r) => r.entryId)).not.toContain(
        after.id,
      );
      expect(
        (await service.getApprovals(otherDeptAdmin())).rows.map((r) => r.entryId),
      ).not.toContain(after.id);
      expect((await mine()).map((r) => r.entryId)).toContain(after.id);
    });

    it('access: canApprove for an L5, not for an L1', async () => {
      expect((await service.getAccess(sameDeptAdmin())).canApprove).toBe(true);
      expect((await service.getAccess(owner())).canApprove).toBe(false);
    });
  });
}
