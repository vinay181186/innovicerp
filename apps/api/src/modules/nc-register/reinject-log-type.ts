// Which op_log row puts an NC's recovered pieces back on its op (ADR-183).
//
// Use-as-is and every rework/repair recovery re-inject the pieces they clear as
// one op_log row on the NC's op (nc.jc_op_id), marked `LOG-NC-<code>`. The row
// type has to match where the pieces were taken OUT, or v_jc_op_status counts
// them wrong:
//
//   - NC raised at a QC inspection — the pieces were good production that QC
//     refused. They sit in completed_qty already and came out through
//     qc_rejected_qty, so they return as a 'qc' row (qc_accepted_qty). This is
//     what both writers have always done.
//
//   - NC raised at a production entry — the pieces never reached completed_qty;
//     they came out through the 'complete' row's reject_qty (0144). A 'qc' row
//     would be invisible on a plain op (the view ignores qc rows there) and
//     would eat into qc_pending on a qc_required one. They return as a
//     'complete' row instead: output rises by exactly the recovered qty, and
//     0144 nets LOG-NC 'complete' rows back out of `available`, so the op is
//     not charged for the same pieces twice.
//
// The NC's qc_log_id points at the row that raised it (split siblings copy it),
// so its log_type decides.

import { and, eq } from 'drizzle-orm';
import { opLog } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

export async function reinjectLogType(
  tx: DbTransaction,
  nc: { qcLogId: string | null; companyId: string },
): Promise<'qc' | 'complete'> {
  if (!nc.qcLogId) return 'qc';
  const rows = await tx
    .select({ logType: opLog.logType })
    .from(opLog)
    .where(and(eq(opLog.id, nc.qcLogId), eq(opLog.companyId, nc.companyId)))
    .limit(1);
  return rows[0]?.logType === 'complete' ? 'complete' : 'qc';
}
