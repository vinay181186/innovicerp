// Day Log — ONE SHEET (POST /day-logs/entries/batch, owner 2026-10-27), TEST
// database. Registered by service.test.ts (sheetCases()) so it shares that
// file's fixture and runs in the same file, one test after another.
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../lib/errors';
import * as service from './service';
import { MON, add, at, batch, owner, times } from './test-fixture';

export function sheetCases(): void {
  describe('Day Log — one sheet (batch)', () => {
    it('rows with their own Start / Stop save together, in any order given', async () => {
      await add(MON, at(MON, '13:00'), { startTime: '09:00', stopTime: '10:00' });
      const d = await batch(MON, at(MON, '13:00'), [
        { startTime: '11:30', stopTime: '12:30', description: 'later' },
        { startTime: '10:00', stopTime: '11:00', description: 'earlier' },
      ]);
      expect(times(d)).toEqual([
        ['09:00', '10:00'],
        ['10:00', '11:00'],
        ['11:30', '12:30'],
      ]);
      expect(d.entries.every((e) => e.kind === 'work' && e.pending === null)).toBe(true);
    });

    it('all or nothing: a bad row 2 saves nothing and says "Row 2:"', async () => {
      const err = await batch(MON, at(MON, '13:00'), [
        { startTime: '09:00', stopTime: '10:00' },
        { startTime: '09:30', stopTime: '10:30', description: 'clash' },
        { startTime: '11:00', stopTime: '12:00' },
      ]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toMatch(/^Row 2: Overlaps 09:00 AM – 10:00 AM/);
      const day = await service.getDay({ date: MON }, owner(), at(MON, '13:00'));
      expect(day.entries).toHaveLength(0);
    });

    it('a Stop later than now names its row; an earlier saved row counts too', async () => {
      await expect(
        batch(MON, at(MON, '13:00'), [
          { startTime: '09:00', stopTime: '10:00' },
          { startTime: '12:00', stopTime: '13:30' },
        ]),
      ).rejects.toThrow('Row 2: Stop 01:30 PM is later than now (01:00 PM)');
      await add(MON, at(MON, '13:00'), { startTime: '11:00', stopTime: '12:00' });
      await expect(
        batch(MON, at(MON, '13:00'), [{ startTime: '11:45', stopTime: '12:15' }]),
      ).rejects.toThrow(/^Row 1: Overlaps 11:00 AM – 12:00 PM/);
    });
  });
}
