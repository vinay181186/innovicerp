// AL-020 — Instruments calibration due (store). ADR-193 phase 4a.
// Register rows (not Lost / Scrapped) whose Calibration Due falls within the
// next 7 days or has passed. An overdue instrument cannot be issued (P16).
// (The legacy AL-020 "Pending Op Entry" was never ported — ADR-024 carve-out —
// so the code is free.)

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

const WINDOW_DAYS = 7;

export const al020InstrumentsCalibrationDue: RegisteredAlert = {
  definition: {
    code: 'AL-020',
    dept: 'store',
    name: 'Instruments calibration due',
    description: `Instruments whose Calibration Due is within ${WINDOW_DAYS} days or already past (an overdue one cannot be issued).`,
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'serial_no', label: 'Instrument Serial No.', type: 'text' },
      { key: 'instrument_status', label: 'Instrument Status', type: 'text' },
      { key: 'calibration_due_on', label: 'Calibration Due', type: 'date' },
      { key: 'days_left', label: 'Days Left', type: 'number' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    // Today in IST, not the database's UTC date.
    const result = await tx.execute(sql`
      SELECT i.id AS item_id, i.code AS item_code, ins.serial_no,
             CASE ins.status WHEN 'in_store' THEN 'In Store' WHEN 'issued' THEN 'Issued'
                  WHEN 'at_calibration' THEN 'At Calibration' ELSE ins.status END AS instrument_status,
             ins.calibration_due_on,
             (ins.calibration_due_on - (now() AT TIME ZONE 'Asia/Kolkata')::date) AS days_left
      FROM public.instruments ins
      JOIN public.items i ON i.id = ins.item_id
      WHERE ins.company_id = ${companyId}::uuid
        AND ins.deleted_at IS NULL
        AND ins.status NOT IN ('lost', 'scrapped')
        AND ins.calibration_due_on IS NOT NULL
        AND ins.calibration_due_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date + ${WINDOW_DAYS}::int
      ORDER BY ins.calibration_due_on, i.code, lower(ins.serial_no)
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      navPage: docNavPage('item', String(r['item_id'])),
      item_code: (r['item_code'] as string) ?? '',
      serial_no: (r['serial_no'] as string) ?? '',
      instrument_status: (r['instrument_status'] as string) ?? '',
      calibration_due_on:
        r['calibration_due_on'] instanceof Date
          ? r['calibration_due_on'].toISOString().slice(0, 10)
          : String(r['calibration_due_on'] ?? ''),
      days_left: Number(r['days_left'] ?? 0),
    }));
    return { records: rows };
  },
};
