// Day Log — the LEAVE entry type (owner 2026-10-26, option A), TEST database.
// Registered by service.test.ts (leaveCases()) so it shares that file's
// fixture and runs in the same file, one test after another — two test files
// on the same owner would wipe each other's days.
import { describe, expect, it } from 'vitest';
import * as service from './service';
import { WED, add, at, edit, fx, owner, teamRow, times } from './test-fixture';

/** 09:00–13:00 work, 13:00–13:30 lunch, 13:30–16:00 work — covered to 16:00. */
async function coveredTo16(clock = at(WED, '16:00')): Promise<void> {
  await add(WED, clock, { startTime: '09:00', stopTime: '13:00' });
  await add(WED, clock, {
    kind: 'break',
    description: 'Lunch',
    startTime: '13:00',
    stopTime: '13:30',
  });
  await add(WED, clock, { startTime: '13:30', stopTime: '16:00' });
}

export function leaveCases(): void {
  describe('Day Log — Leave', () => {
    it('Leave 04:00–06:00 PM saved at 04:05 PM; Submit then works', async () => {
      const c = at(WED, '16:05');
      await coveredTo16(c);
      const d = await add(WED, c, {
        kind: 'leave',
        description: '',
        startTime: '16:00',
        stopTime: '18:00',
      });
      const leave = d.entries.find((e) => e.kind === 'leave')!;
      expect([leave.fromTime, leave.toTime, leave.description]).toEqual([
        '16:00',
        '18:00',
        'Leave',
      ]);
      expect(d.summary).toMatchObject({
        leaveMin: 120,
        breakMin: 30,
        workMin: 390,
        unloggedMin: 0,
      });
      const s = await service.submitDay({ date: WED }, owner(), c);
      expect(s.status).toBe('submitted');
    });

    it('a Leave Stop other than 06:00 PM, or no Stop, is refused', async () => {
      const c = at(WED, '16:05');
      await coveredTo16(c);
      for (const stopTime of ['17:00', null]) {
        await expect(add(WED, c, { kind: 'leave', startTime: '16:00', stopTime })).rejects.toThrow(
          'Leave runs to 06:00 PM',
        );
      }
    });

    it('a Leave whose Start has not come yet is refused', async () => {
      await coveredTo16(at(WED, '16:00'));
      await expect(
        add(WED, at(WED, '15:00'), { kind: 'leave', startTime: '16:00', stopTime: '18:00' }),
      ).rejects.toThrow('Start 04:00 PM is later than now (03:00 PM)');
    });

    it('a Leave for an SO is refused', async () => {
      await coveredTo16();
      await expect(
        add(WED, at(WED, '16:05'), {
          kind: 'leave',
          startTime: '16:00',
          stopTime: '18:00',
          orderType: 'so',
          orderId: fx.openSo.id,
        }),
      ).rejects.toThrow('A Leave cannot be for an SO / JWSO');
    });

    it('nothing may be added after a Leave; the Leave itself may be removed', async () => {
      const c = at(WED, '18:30');
      await coveredTo16(c);
      const d = await add(WED, c, { kind: 'leave', startTime: '16:00', stopTime: '18:00' });
      await expect(add(WED, c, { startTime: '18:00', stopTime: '18:20' })).rejects.toThrow(
        'The day ends with your Leave',
      );
      // An earlier entry keeps its times while a Leave follows it.
      const before = d.entries.find((e) => e.fromTime === '13:30')!;
      await expect(edit(before, c, { stopTime: '15:00' })).rejects.toThrow(/Only the last entry/);
      const leave = d.entries.find((e) => e.kind === 'leave')!;
      const out = await service.deleteEntry(leave.id, owner(), c);
      expect(times(out).at(-1)).toEqual(['work', '13:30', '16:00']);
    });

    it('team: Leave from its Start; a past day reads its day status', async () => {
      await coveredTo16(at(WED, '16:00'));
      await add(WED, at(WED, '16:00'), { kind: 'leave', startTime: '16:00', stopTime: '18:00' });
      const on = await teamRow(WED, at(WED, '16:30'));
      expect([on.currentStatus, on.currentText, on.leaveMin]).toEqual([
        'leave',
        'from 04:00 PM',
        120,
      ]);
      // A past day reads its day status, not the Leave entry.
      const later = await teamRow(WED, at('2001-01-04', '10:00'));
      expect(later.currentStatus).toBe('idle');
    });
  });
}
