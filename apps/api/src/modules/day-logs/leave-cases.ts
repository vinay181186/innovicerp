// Day Log — the OTHERS entry type (kind 'leave'; owner 2026-10-27) and the
// compulsory remark, TEST database. Registered by service.test.ts
// (leaveCases()) so it shares that file's fixture and runs in the same file,
// one test after another — two test files on the same owner would wipe each
// other's days.
import { describe, expect, it } from 'vitest';
import * as service from './service';
import { WED, add, at, fx, owner, sameDeptAdmin, teamRow, times } from './test-fixture';

/** 09:00–13:00 work, 13:00–13:30 lunch — covered to 01:30 PM. */
async function coveredTo1330(clock = at(WED, '14:00')): Promise<void> {
  await add(WED, clock, { startTime: '09:00', stopTime: '13:00' });
  await add(WED, clock, {
    kind: 'break',
    description: 'Lunch',
    startTime: '13:00',
    stopTime: '13:30',
  });
}

const others = (description: string, startTime: string, stopTime: string | null) => ({
  kind: 'leave' as const,
  description,
  startTime,
  stopTime,
  remarks: 'approved by HOD',
});

export function leaveCases(): void {
  describe('Day Log — Others', () => {
    it('Others · Half day 01:30–06:00 PM saved at 02:00 PM; Submit then works', async () => {
      const c = at(WED, '14:00');
      await coveredTo1330(c);
      const d = await add(WED, c, others('Half day', '13:30', '18:00'));
      const o = d.entries.find((e) => e.kind === 'leave')!;
      expect([o.fromTime, o.toTime, o.description]).toEqual(['13:30', '18:00', 'Half day']);
      expect(d.summary).toMatchObject({ leaveMin: 270, breakMin: 30, workMin: 240 });
      expect(d.summary.unloggedMin).toBe(0);
      const s = await service.submitDay({ date: WED }, owner(), c);
      expect(s.status).toBe('submitted');
    });

    it('Others: no reason, no Stop, a Stop after 06:00 PM, an SO, a Start not yet come — refused', async () => {
      const c = at(WED, '14:00');
      await coveredTo1330(c);
      await expect(add(WED, c, others('Leave', '13:30', '18:00'))).rejects.toThrow(
        'Pick the reason',
      );
      await expect(add(WED, c, others('Permission', '13:30', null))).rejects.toThrow(
        'Give the Stop time of Others',
      );
      await expect(add(WED, c, others('Permission', '13:30', '18:30'))).rejects.toThrow(
        'Others must stop by 06:00 PM',
      );
      await expect(
        add(WED, c, {
          ...others('Personal', '13:30', '15:00'),
          orderType: 'so',
          orderId: fx.openSo.id,
        }),
      ).rejects.toThrow('Others cannot be for an SO / JWSO');
      await expect(
        add(WED, at(WED, '13:00'), others('Personal', '13:30', '15:00')),
      ).rejects.toThrow('Start 01:30 PM is later than now (01:00 PM)');
    });

    it('work may follow an Others row once its time has come; lateInMin everywhere', async () => {
      // Others · Late coming 09:00–10:30, entered at 09:45 (its Stop is ahead).
      const d1 = await add(WED, at(WED, '09:45'), others('Late coming', '09:00', '10:30'));
      expect(d1.summary.nextStart).toBe('10:30');
      expect(d1.summary.lateInMin).toBe(90);
      // Work after it cannot start before its time comes.
      await expect(add(WED, at(WED, '10:00'), { startTime: '10:30' })).rejects.toThrow(
        'Start 10:30 AM is later than now (10:00 AM)',
      );
      const d2 = await add(WED, at(WED, '12:00'), { startTime: '10:30', stopTime: '12:00' });
      expect(times(d2)).toEqual([
        ['leave', '09:00', '10:30'],
        ['work', '10:30', '12:00'],
      ]);
      const row = await teamRow(WED, at(WED, '12:00'));
      expect([row.lateInMin, row.currentStatus]).toEqual([90, 'idle']);
      const p = await service.getPerson(
        { userId: fx.ownerBase.id, from: WED, to: WED },
        sameDeptAdmin(),
        at(WED, '12:00'),
      );
      expect(p.days[0]!.lateInMin).toBe(90);
    });

    it('lateInMin is 0 when the first entry is not Late coming', async () => {
      const d = await add(WED, at(WED, '10:00'), others('Permission', '09:00', '10:00'));
      expect(d.summary.lateInMin).toBe(0);
    });

    it('team: an Others row in progress reads "<reason> · from <Start>"', async () => {
      await coveredTo1330(at(WED, '14:00'));
      await add(WED, at(WED, '14:00'), others('Half day', '13:30', '18:00'));
      const on = await teamRow(WED, at(WED, '16:30'));
      expect([on.currentStatus, on.currentText, on.leaveMin]).toEqual([
        'leave',
        'Half day · from 01:30 PM',
        270,
      ]);
      // A past day reads its day status, not the Others entry.
      const later = await teamRow(WED, at('2001-01-04', '10:00'));
      expect(later.currentStatus).toBe('idle');
    });
  });

  describe('Day Log — compulsory remark', () => {
    it('a closed Work / Others entry without a remark is refused; a break needs none', async () => {
      const c = at(WED, '12:00');
      const msg = 'Remark is compulsory when Start and Stop are filled';
      await expect(
        add(WED, c, { startTime: '09:00', stopTime: '10:00', remarks: null }),
      ).rejects.toThrow(msg);
      await expect(
        add(WED, c, { startTime: '09:00', stopTime: '10:00', remarks: '  ' }),
      ).rejects.toThrow(msg);
      await expect(
        add(WED, c, { ...others('Permission', '09:00', '10:00'), remarks: null }),
      ).rejects.toThrow(msg);
      // An Open work entry may wait for its remark until it is stopped.
      await add(WED, c, { startTime: '09:00', stopTime: '10:00' });
      const d = await add(WED, c, {
        kind: 'break',
        startTime: '10:00',
        stopTime: '10:10',
        remarks: null,
      });
      expect(d.entries).toHaveLength(2);
    });

    it('Stop without a remark is refused; with one it saves the remark', async () => {
      const d = await add(WED, at(WED, '10:00'), { startTime: '09:00', remarks: null });
      const e = d.entries[0]!;
      await expect(service.stopEntry(e.id, {}, owner(), at(WED, '10:30'))).rejects.toThrow(
        'Remark is compulsory when you stop',
      );
      await expect(
        service.stopEntry(e.id, { remarks: ' ' }, owner(), at(WED, '10:30')),
      ).rejects.toThrow('Remark is compulsory when you stop');
      const out = await service.stopEntry(e.id, { remarks: 'GRN done' }, owner(), at(WED, '10:30'));
      expect([out.entries[0]!.toTime, out.entries[0]!.remarks]).toEqual(['10:30', 'GRN done']);
    });

    it('a break stops without a remark', async () => {
      await add(WED, at(WED, '13:00'), { startTime: '09:00', stopTime: '13:00' });
      const d = await add(WED, at(WED, '13:00'), {
        kind: 'break',
        description: 'Lunch',
        startTime: '13:00',
        remarks: null,
      });
      const out = await service.stopEntry(d.entries[1]!.id, {}, owner(), at(WED, '13:20'));
      expect(times(out).at(-1)).toEqual(['break', '13:00', '13:20']);
    });
  });
}
