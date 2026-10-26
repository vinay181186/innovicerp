// Day Log service — against the TEST database (fixture: test-fixture.ts).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { ConflictError, ValidationError } from '../../lib/errors';
import * as service from './service';
import {
  MON,
  TUE,
  WED,
  add,
  at,
  fullDay,
  fx,
  owner,
  sameDeptAdmin,
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

describe('Day Log — add / Open / Stop', () => {
  it('adds a closed entry with an SO and a remark', async () => {
    const d = await add(MON, at(MON, '12:00'), {
      startTime: '09:00',
      stopTime: '10:15',
      orderType: 'so',
      orderId: fx.openSo.id,
      remarks: 'first pass',
    });
    expect(d.id).not.toBeNull();
    expect(d.entries).toHaveLength(1);
    const e = d.entries[0]!;
    expect([e.fromTime, e.toTime, e.minutes]).toEqual(['09:00', '10:15', 75]);
    expect(e.order).toEqual({ type: 'so', id: fx.openSo.id, code: fx.openSo.code });
    expect(e.remarks).toBe('first pass');
    expect(d.summary.workMin).toBe(75);
  });

  it('an Open entry (no Stop) counts to now, then Stop closes it at now', async () => {
    const d1 = await add(MON, at(MON, '10:00'), { startTime: '09:00' });
    const e = d1.entries[0]!;
    expect(e.toTime).toBeNull();
    expect(e.minutes).toBe(60);
    expect(d1.summary.open).toBe(true);
    const d2 = await service.stopEntry(e.id, owner(), at(MON, '10:30'));
    expect(times(d2)).toEqual([['work', '09:00', '10:30']]);
    await expect(service.stopEntry(e.id, owner(), at(MON, '10:40'))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('Stop in the minute it started removes the entry', async () => {
    const d = await add(MON, at(MON, '10:00'), { startTime: '10:00' });
    const out = await service.stopEntry(d.entries[0]!.id, owner(), at(MON, '10:00'));
    expect(out.entries).toHaveLength(0);
  });

  it('overlap is refused — against work and against a break', async () => {
    const c = at(MON, '15:00');
    await add(MON, c, { startTime: '09:00', stopTime: '10:00' });
    await add(MON, c, {
      kind: 'break',
      description: 'Lunch',
      startTime: '13:00',
      stopTime: '13:30',
    });
    await expect(add(MON, c, { startTime: '09:30', stopTime: '11:00' })).rejects.toThrow(
      /Overlaps/,
    );
    await expect(add(MON, c, { startTime: '12:00', stopTime: '13:10' })).rejects.toThrow(
      /Overlaps/,
    );
    await expect(
      add(MON, c, { kind: 'break', startTime: '09:50', stopTime: '10:05' }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Touching is fine.
    const ok = await add(MON, c, { startTime: '10:00', stopTime: '13:00' });
    expect(ok.entries).toHaveLength(3);
  });

  it('a future day, or a time later than now today, is refused', async () => {
    await expect(
      add(TUE, at(MON, '10:00'), { startTime: '09:00', stopTime: '09:30' }),
    ).rejects.toThrow(/has not come yet/);
    await expect(
      add(MON, at(MON, '10:00'), { startTime: '09:00', stopTime: '10:30' }),
    ).rejects.toThrow(/later than now/);
    await expect(add(MON, at(MON, '10:00'), { startTime: '10:05' })).rejects.toThrow(
      /later than now/,
    );
  });

  it('a second Open entry is refused', async () => {
    await add(MON, at(MON, '10:00'), { startTime: '09:00' });
    await expect(
      add(MON, at(MON, '10:00'), { kind: 'break', startTime: '08:00', stopTime: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('breaks over 60 minutes a day are refused; a break may not have an order', async () => {
    const c = at(MON, '17:00');
    await add(MON, c, { kind: 'break', startTime: '13:00', stopTime: '13:45' });
    await expect(
      add(MON, c, { kind: 'break', startTime: '16:00', stopTime: '16:16' }),
    ).rejects.toThrow(/limit is 60/);
    await expect(
      add(MON, c, {
        kind: 'break',
        startTime: '16:00',
        stopTime: '16:10',
        orderType: 'so',
        orderId: fx.openSo.id,
      }),
    ).rejects.toThrow(/break cannot be for an SO/);
    const d = await add(MON, c, {
      kind: 'break',
      description: '',
      startTime: '16:00',
      stopTime: '16:15',
    });
    expect(d.summary.breakMin).toBe(60);
    expect(d.entries.find((e) => e.fromTime === '16:00')!.description).toBe('Break');
  });
});

describe('Day Log — edit / remove', () => {
  it('edit with a stale updatedAt is a 409; edit excluding itself is fine', async () => {
    const d = await add(MON, at(MON, '12:00'), { startTime: '09:00', stopTime: '10:00' });
    const e = d.entries[0]!;
    const d2 = await service.updateEntry(
      e.id,
      {
        kind: 'work',
        description: 'longer',
        startTime: '09:00',
        stopTime: '11:00',
        updatedAt: e.updatedAt,
      },
      owner(),
      at(MON, '12:00'),
    );
    expect(times(d2)).toEqual([['work', '09:00', '11:00']]);
    await expect(
      service.updateEntry(
        e.id,
        {
          kind: 'work',
          description: 'stale',
          startTime: '09:00',
          stopTime: '09:30',
          updatedAt: e.updatedAt,
        },
        owner(),
        at(MON, '12:00'),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('removes any entry, not only the last', async () => {
    const c = at(MON, '12:00');
    await add(MON, c, { startTime: '09:00', stopTime: '10:00' });
    await add(MON, c, { startTime: '10:00', stopTime: '11:00' });
    const d = await add(MON, c, { startTime: '11:00', stopTime: '12:00' });
    const first = d.entries.find((e) => e.fromTime === '09:00')!;
    const out = await service.deleteEntry(first.id, owner(), c);
    expect(times(out)).toEqual([
      ['work', '10:00', '11:00'],
      ['work', '11:00', '12:00'],
    ]);
  });
});

describe('Day Log — submit and races', () => {
  it('submit with a gap is refused; a full day submits', async () => {
    await add(WED, at(WED, '18:00'), { startTime: '09:00', stopTime: '11:00' });
    await expect(service.submitDay({ date: WED }, owner(), at(WED, '18:00'))).rejects.toThrow(
      /11:00 – 18:00 is empty/,
    );
    await wipeOwnerDays();
    await fullDay(WED);
    const d = await service.submitDay({ date: WED }, owner(), at(WED, '18:00'));
    expect(d.status).toBe('submitted');
    expect(d.canWrite).toBe(false);
  });

  it('two adds of the same slot at once — exactly one wins', async () => {
    const c = at(MON, '12:00');
    const res = await Promise.allSettled([
      add(MON, c, { startTime: '09:00', stopTime: '10:00', description: 'a' }),
      add(MON, c, { startTime: '09:00', stopTime: '10:00', description: 'b' }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const day = await service.getDay({ date: MON }, owner(), c);
    expect(day.entries).toHaveLength(1);
  });

  it('two submits at once — one wins, the other is a 409', async () => {
    await fullDay(WED);
    const res = await Promise.allSettled([
      service.submitDay({ date: WED }, owner(), at(WED, '18:00')),
      service.submitDay({ date: WED }, owner(), at(WED, '18:00')),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
  });

  it('an Open entry left on an earlier day blocks today', async () => {
    const d = await add(MON, at(MON, '17:00'), { startTime: '17:00' });
    const e = d.entries[0]!;
    const tue = await service.getDay({ date: TUE }, owner(), at(TUE, '09:30'));
    expect(tue.strayOpen).toEqual({ date: MON, entryId: e.id, fromTime: '17:00' });
    expect(tue.canWrite).toBe(false);
    await expect(
      add(TUE, at(TUE, '09:30'), { startTime: '09:00', stopTime: '09:20' }),
    ).rejects.toThrow(/still Open since 17:00/);
  });

  it('the earlier Open entry cannot be Stopped at now — it gets a Stop time by edit', async () => {
    const d = await add(MON, at(MON, '17:00'), { startTime: '17:00' });
    const e = d.entries[0]!;
    await expect(service.stopEntry(e.id, owner(), at(TUE, '09:30'))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const fixed = await service.updateEntry(
      e.id,
      {
        kind: 'work',
        description: 'late work',
        startTime: '17:00',
        stopTime: '19:30',
        updatedAt: e.updatedAt,
      },
      owner(),
      at(TUE, '09:30'),
    );
    expect(times(fixed)).toEqual([['work', '17:00', '19:30']]);
    expect(fixed.strayOpen).toBeNull();
  });
});

describe('Day Log — LATE, orders, person, team', () => {
  it('LATE: last saved more than 60 minutes after its Stop (India time)', async () => {
    const d = await add(MON, at(MON, '12:00'), { startTime: '09:00', stopTime: '10:00' });
    // Created in 2026 for a 2001 day — late.
    expect(d.entries[0]!.late).toBe(true);
    expect(d.summary.lateCount).toBe(1);
    const id = d.entries[0]!.id;
    const setSaved = (iso: string) =>
      db.execute(
        sql`UPDATE public.daily_report_lines SET updated_at = ${iso}::timestamptz WHERE id = ${id}::uuid`,
      );
    await setSaved('2001-01-01T11:00:00+05:30'); // Stop 10:00 + 60 = not late
    expect((await service.getDay({ date: MON }, owner(), at(MON, '12:00'))).entries[0]!.late).toBe(
      false,
    );
    await setSaved('2001-01-01T11:01:00+05:30');
    expect((await service.getDay({ date: MON }, owner(), at(MON, '12:00'))).entries[0]!.late).toBe(
      true,
    );
  });

  it('order options include an open Sales Order', async () => {
    const opts = await service.orderOptions({ search: fx.openSo.code }, owner());
    expect(opts.find((o) => o.id === fx.openSo.id)).toMatchObject({
      type: 'so',
      code: fx.openSo.code,
    });
  });

  it('person range: one row per working day, totals', async () => {
    await fullDay(MON);
    await service.submitDay({ date: MON }, owner(), at(MON, '18:00'));
    await add(TUE, at(TUE, '12:00'), {
      startTime: '09:00',
      stopTime: '11:00',
      orderType: 'so',
      orderId: fx.openSo.id,
    });
    const p = await service.getPerson(
      { userId: fx.ownerBase.id, from: MON, to: WED },
      sameDeptAdmin(),
      at(TUE, '12:00'),
    );
    expect(p.to).toBe(TUE); // clipped to today
    expect(p.days.map((d) => d.date)).toEqual([TUE, MON]);
    expect(p.days[0]!.orderCodes).toEqual([fx.openSo.code]);
    expect(p.days[1]!.status).toBe('submitted');
    expect(p.totals).toMatchObject({
      daysLogged: 2,
      workMin: 510 + 120,
      avgWorkMin: 315,
      breakMin: 30,
    });
  });

  it('team current status: not_started, then working', async () => {
    expect((await teamRow(WED, at(WED, '09:30'))).currentStatus).toBe('not_started');
    await add(WED, at(WED, '10:00'), { startTime: '09:00', description: 'GRN entry' });
    const working = await teamRow(WED, at(WED, '10:00'));
    expect(working.currentStatus).toBe('working');
    expect(working.currentText).toBe('GRN entry · since 09:00');
    expect(working.runningSince).toBe('09:00');
    expect(working.latestWork).toEqual({ description: 'GRN entry', orderCode: null });
  });

  it('team current status: break (an Open break entry)', async () => {
    await add(WED, at(WED, '13:05'), { startTime: '09:00', stopTime: '13:00' });
    await add(WED, at(WED, '13:05'), { kind: 'break', description: 'Lunch', startTime: '13:00' });
    const onBreak = await teamRow(WED, at(WED, '13:10'));
    expect(onBreak.currentStatus).toBe('break');
    expect(onBreak.currentText).toBe('Lunch since 13:00');
  });

  it('team current status: idle since the last Stop, with totals', async () => {
    await add(WED, at(WED, '14:00'), { startTime: '09:00', stopTime: '13:00' });
    await add(WED, at(WED, '14:00'), {
      kind: 'break',
      description: 'Lunch',
      startTime: '13:00',
      stopTime: '13:30',
    });
    const idle = await teamRow(WED, at(WED, '14:00'));
    expect(idle.currentStatus).toBe('idle');
    expect(idle.currentText).toBe('since 13:30');
    expect([idle.workMin, idle.breakMin, idle.entryCount]).toEqual([240, 30, 1]);
  });

  it('team current status: submitted', async () => {
    await fullDay(WED);
    await service.submitDay({ date: WED }, owner(), at(WED, '18:00'));
    expect((await teamRow(WED, at(WED, '18:30'))).currentStatus).toBe('submitted');
  });
});
