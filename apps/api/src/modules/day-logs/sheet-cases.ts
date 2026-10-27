// Day Log — ONE SHEET (POST /day-logs/entries/batch, owner 2026-10-27), TEST
// database. Registered by service.test.ts (sheetCases()) so it shares that
// file's fixture and runs in the same file, one test after another.
import type { DayLogSheetRow } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../lib/errors';
import * as service from './service';
import { MON, add, at, owner, times } from './test-fixture';

const work = (stopTime: string | null, remarks: string | null = 'done'): DayLogSheetRow => ({
  kind: 'work',
  description: 'sheet work',
  stopTime,
  remarks,
});
const brk = (stopTime: string | null): DayLogSheetRow => ({
  kind: 'break',
  description: 'Tea',
  stopTime,
});
const batch = (rows: DayLogSheetRow[], clock = at(MON, '13:00')) =>
  service.addEntries({ date: MON, rows }, owner(), clock);

export function sheetCases(): void {
  describe('Day Log — one sheet (batch)', () => {
    it('3 rows are saved with chained starts, after the existing entries', async () => {
      await add(MON, at(MON, '13:00'), { startTime: '09:00', stopTime: '10:00' });
      const d = await batch([work('11:00'), brk('11:15'), work(null)]);
      expect(times(d)).toEqual([
        ['work', '09:00', '10:00'],
        ['work', '10:00', '11:00'],
        ['break', '11:00', '11:15'],
        ['work', '11:15', null],
      ]);
      expect(d.summary.open).toBe(true);
    });

    it('a bad row 2 saves nothing and says "Row 2:"', async () => {
      const err = await batch([work('10:00'), work('11:00', null), work('12:00')]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toBe(
        'Row 2: Remark is compulsory when Start and Stop are filled',
      );
      const day = await service.getDay({ date: MON }, owner(), at(MON, '13:00'));
      expect(day.entries).toHaveLength(0);
    });

    it('an Open row that is not the last is refused', async () => {
      await expect(batch([work('10:00'), work(null), work('12:00')])).rejects.toThrow(
        'Row 2: Give a Stop time — only the last row may be left Open',
      );
    });

    it('breaks count across the batch; a Stop later than now names its row', async () => {
      await expect(
        batch([work('10:00'), brk('10:40'), work('11:00'), brk('11:30')]),
      ).rejects.toThrow(/^Row 4: Breaks would add up to 70 minutes/);
      await expect(batch([work('10:00'), work('13:30')])).rejects.toThrow(
        'Row 2: Stop 01:30 PM is later than now (01:00 PM)',
      );
      const day = await service.getDay({ date: MON }, owner(), at(MON, '13:00'));
      expect(day.entries).toHaveLength(0);
    });

    it('a batch while an entry is Open is refused at row 1', async () => {
      await add(MON, at(MON, '10:00'), { startTime: '09:00', description: 'GRN' });
      await expect(batch([work('12:00')])).rejects.toThrow(
        'Row 1: Stop GRN (since 09:00 AM) first',
      );
    });
  });
}
