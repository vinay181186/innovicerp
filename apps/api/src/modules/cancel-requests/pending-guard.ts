// ADR-235 — while a Cancel Request is pending the document must not change
// under the approver. The edit / payment paths of every enrolled document call
// this inside their own transaction, after locking the document row (the
// request path locks the same row first, so the two serialise).
//
// Kept apart from service.ts on purpose: the document modules import this, and
// service.ts imports the document modules' cancel handlers — one file each way
// would be an import cycle.

import type { CancelDocType } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';

export async function assertNoPendingCancel(
  tx: DbTransaction,
  docType: CancelDocType,
  docId: string,
): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT doc_code AS "docCode"
    FROM public.cancel_requests
    WHERE doc_type = ${docType} AND doc_id = ${docId}::uuid
      AND status = 'pending' AND deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ docCode: string }>;
  const hit = rows[0];
  if (hit) {
    throw new ConflictError(`${hit.docCode} has a cancel request pending — decide it first.`);
  }
}
