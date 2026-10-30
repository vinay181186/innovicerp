// Day Log service (simple sheet, owner 2026-10-27) — against the TEST
// database (fixture: test-fixture.ts).
import { addDayLogEntryInputSchema } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { ConflictError, ValidationError } from '../../lib/errors';
import { approvalCases } from './approval-cases';
import { editCases } from './edit-cases';
import { sheetCases } from './sheet-cases';
import { textCases } from './text-cases';
import * as service from './service';
import {
  MON,
  NEXT_MON,
  SAT,
  SUN,
  TUE,
  WED,
  add,
  at,
  fx,
  owner,
  setupFixture,
  teamRow,
  times,
  wipeOwnerDays,
} from './test-fixture';

beforeAll(setupFixture);

beforeEach(async () => {
  await wipeOwnerDays();
});

afterAll(async () => {
  if (fx.ownerBase) await wipeOwnerDays();
});

describe('Day Log — add rows', () => {
  it('adds a row with an SO; kind is work, no remark', async () => {
    const d = await add(MON, at(MON, '12:00'), {
      startTime: '09:00',
      stopTime: '10:15',
      orderType: 'so',
      orderId: fx.openSo.id,
    });
    expect(d.id).not.toBeNull();
    const e = d.entries[0]!;
    expect([e.kind, e.fromTime, e.toTime, e.minutes, e.remarks]).toEqual([
      'work',
      '09:00',
      '10:15',
      75,
      null,
    ]);
    expect(e.order).toEqual({ type: 'so', id: fx.openSo.id, code: fx.openSo.code });
    expect([e.pending, e.rejectReason]).toEqual([null, null]);
    expect(d.summary.workMin).toBe(75);
  });

  it('any Start: rows need not follow each other', async () => {
    const c = at(MON, '17:00');
    await add(MON, c, { startTime: '14:00', stopTime: '15:00' });
    const d = await add(MON, c, { startTime: '09:30', stopTime: '10:00' });
    expect(times(d)).toEqual([
      ['09:30', '10:00'],
      ['14:00', '15:00'],
    ]);
  });

  it('an overlap with a saved row is refused; touching ends are fine', async () => {
    const c = at(MON, '17:00');
    await add(MON, c, { startTime: '10:00', stopTime: '11:00', description: 'GRN' });
    await expect(add(MON, c, { startTime: '10:59', stopTime: '11:30' })).rejects.toThrow(
      'Overlaps 10:00 AM – 11:00 AM GRN — rows cannot share time',
    );
    const d = await add(MON, c, { startTime: '11:00', stopTime: '11:30' });
    expect(d.entries).toHaveLength(2);
  });

  it('a Stop later than now today, and a future day, are refused', async () => {
    await expect(
      add(MON, at(MON, '10:00'), { startTime: '09:00', stopTime: '10:30' }),
    ).rejects.toThrow('Stop 10:30 AM is later than now (10:00 AM)');
    await expect(add(TUE, at(MON, '10:00'))).rejects.toThrow(/has not come yet/);
    // A past day may run to any Stop.
    const d = await add(MON, at(TUE, '08:00'), { startTime: '17:00', stopTime: '19:30' });
    expect(times(d)).toEqual([['17:00', '19:30']]);
  });

  it('the schema refuses a missing Start / Stop / Working on, and Stop before Start', () => {
    const ok = { date: MON, description: 'x', startTime: '09:00', stopTime: '10:00' };
    expect(addDayLogEntryInputSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, stopTime: undefined },
      { ...ok, startTime: undefined },
      { ...ok, description: '  ' },
      { ...ok, stopTime: '08:00' },
    ]) {
      expect(addDayLogEntryInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('two adds of the same slot at once — exactly one wins', async () => {
    const c = at(MON, '12:00');
    const res = await Promise.allSettled([
      add(MON, c, { description: 'a' }),
      add(MON, c, { description: 'b' }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const day = await service.getDay({ date: MON }, owner(), c);
    expect(day.entries).toHaveLength(1);
  });

  it('a saved row cannot be removed or stopped (no such service)', () => {
    const s = service as unknown as Record<string, unknown>;
    expect(s['deleteEntry']).toBeUndefined();
    expect(s['stopEntry']).toBeUndefined();
    expect(s['submitDay']).toBeUndefined();
  });
});

describe('Day Log — yesterday first', () => {
  it("a person's first-ever day is not blocked", async () => {
    const d = await service.getDay({ date: WED }, owner(), at(WED, '12:00'));
    expect([d.blockedBy, d.strayOpen, d.canWrite]).toEqual([null, null, true]);
    await add(WED, at(WED, '12:00'));
  });

  it('D-1 empty while an earlier day has rows → day D is refused with 409', async () => {
    await add(MON, at(MON, '18:00'));
    const wed = await service.getDay({ date: WED }, owner(), at(WED, '12:00'));
    expect(wed.blockedBy).toEqual({
      date: TUE,
      reason: '02-01-2001 (Tue) has no entries — fill it first',
    });
    expect(wed.canWrite).toBe(false);
    const err = await add(WED, at(WED, '12:00')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe('02-01-2001 (Tue) has no entries — fill it first');
    await add(TUE, at(WED, '12:00'), { description: 'Tuesday' });
    expect((await add(WED, at(WED, '12:00'))).blockedBy).toBeNull();
  });

  it('Sunday is not skipped: Monday waits for a Sunday row', async () => {
    await add(SAT, at(SAT, '18:00'));
    await expect(add(NEXT_MON, at(NEXT_MON, '12:00'))).rejects.toThrow(
      '07-01-2001 (Sun) has no entries — fill it first',
    );
    await add(SUN, at(NEXT_MON, '12:00'), { description: 'Sunday' });
    const d = await add(NEXT_MON, at(NEXT_MON, '12:00'));
    expect(d.entries).toHaveLength(1);
  });
});

describe('Day Log — LATE, orders, team', () => {
  it('LATE: first saved more than 60 minutes after its Stop (India time)', async () => {
    const d = await add(MON, at(MON, '12:00'));
    expect(d.entries[0]!.late).toBe(true); // created in 2026 for a 2001 day
    const id = d.entries[0]!.id;
    const setSaved = (iso: string) =>
      db.execute(
        sql`UPDATE public.daily_report_lines SET created_at = ${iso}::timestamptz WHERE id = ${id}::uuid`,
      );
    await setSaved('2001-01-01T11:00:00+05:30'); // Stop 10:00 + 60 = not late
    const read = async () =>
      (await service.getDay({ date: MON }, owner(), at(MON, '12:00'))).entries[0]!.late;
    expect(await read()).toBe(false);
    await setSaved('2001-01-01T11:01:00+05:30');
    expect(await read()).toBe(true);
  });

  it('order options include an open Sales Order', async () => {
    const opts = await service.orderOptions({ search: fx.openSo.code }, owner());
    expect(opts.find((o) => o.id === fx.openSo.id)).toMatchObject({
      type: 'so',
      code: fx.openSo.code,
    });
  });

  it('team today: not_started, working within 30 min of the last Stop, then idle', async () => {
    expect((await teamRow(WED, at(WED, '09:30'))).currentStatus).toBe('not_started');
    await add(WED, at(WED, '14:30'), { startTime: '09:00', stopTime: '14:30', description: 'GRN' });
    const working = await teamRow(WED, at(WED, '14:45'));
    expect([working.currentStatus, working.currentText, working.runningSince]).toEqual([
      'working',
      'till 02:30 PM',
      null,
    ]);
    expect(working.latestWork).toEqual({ description: 'GRN', orderCode: null });
    expect([working.breakMin, working.leaveMin, working.lateInMin]).toEqual([0, 0, 0]);
    const idle = await teamRow(WED, at(WED, '15:01'));
    expect([idle.currentStatus, idle.currentText]).toEqual(['idle', 'since 02:30 PM']);
  });

  it('team past day: idle (Logged) with rows, not_started without', async () => {
    expect((await teamRow(MON, at(WED, '12:00'))).currentStatus).toBe('not_started');
    await add(MON, at(WED, '12:00'));
    expect((await teamRow(MON, at(WED, '12:00'))).currentStatus).toBe('idle');
  });

  it('a schema-less bad row still fails the server check (Stop before Start)', async () => {
    await expect(
      add(MON, at(MON, '12:00'), { startTime: '10:00', stopTime: '09:00' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

approvalCases();
editCases();
sheetCases();
textCases();
