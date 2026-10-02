// Sort & Filter (ADR-200) — the Instrument Register's sortable / filterable
// fields. Each expression is the SAME one listInstruments SELECTs for that
// column (same aliases `ins`, `i`, `h`; its count query runs over the same
// SELECT), so what the user filters is what the row shows.
//   heldBy — the holder's name off the latest issue (h.holder); the Tool
//            Issue No. printed beside it is not filtered here.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const INSTRUMENT_SF_COLUMNS: SfColumnMap = {
  serialNo: { sql: sql`ins.serial_no`, type: 'text' },
  itemCode: { sql: sql`i.code`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  status: { sql: sql`ins.status`, type: 'list' },
  calibrationDueOn: { sql: sql`ins.calibration_due_on`, type: 'date' },
  lastCalibratedOn: { sql: sql`ins.last_calibrated_on`, type: 'date' },
  location: { sql: sql`ins.location`, type: 'text' },
  heldBy: { sql: sql`h.holder`, type: 'text' },
};
