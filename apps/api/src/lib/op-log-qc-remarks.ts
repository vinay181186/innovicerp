// THE "QC Remarks" read of an op_log row aliased `ol`. A reversal row
// (reversal_of_id set by op-entry/reverse-op-log.ts) stores its own auto text
// ("Reversal of <log>: <reason>") in remarks — that is not what an inspector
// wrote, so it reads as NULL. The row itself is still listed as before.

import { sql } from 'drizzle-orm';

export const OP_LOG_QC_REMARKS = sql`(CASE WHEN ol.reversal_of_id IS NULL THEN ol.remarks END)`;
