// Sales Order status + BOM-link rules on the server (fix wave 2, step 2b — S8).
//
// ERPNext checks every status change in validate(); before this the SO API
// took any status on create and any line status on edit, and "only an Active
// BOM can be linked" lived only in the web form's BOM list. The maps are in
// packages/shared lib/status-moves.ts, so the web shows the same moves.
import {
  BOM_LINKABLE_STATUS,
  canMoveStatus,
  SO_CREATE_STATUSES,
  SO_STATUS_MOVES,
  type SoStatus,
  statusMoveRefusal,
} from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { bomMasters } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';

/** Screen words (same as apps/web sales-orders/lib/so-status-label.ts). */
const SO_STATUS_WORDS: Record<SoStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

const BOM_STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  obsolete: 'Obsolete',
};

/** A new SO / SO line may start only as Draft or Open. */
export function assertSoCreateStatus(status: SoStatus, what: string): void {
  if (!SO_CREATE_STATUSES.includes(status)) {
    throw new ConflictError(
      `${what} cannot be created as ${SO_STATUS_WORDS[status]} — save it as Draft or Open.`,
    );
  }
}

/** A hand-made status change (edit) must be one SO_STATUS_MOVES allows. */
export function assertSoStatusMove(what: string, from: SoStatus, to: SoStatus): void {
  if (!canMoveStatus(SO_STATUS_MOVES, from, to)) {
    const extra =
      to === 'closed' || to === 'dispatched'
        ? ' Closed and Dispatched are set by the system from dispatches and the Close action.'
        : '';
    throw new ConflictError(statusMoveRefusal(what, from, to, SO_STATUS_WORDS) + extra);
  }
}

/** '' / null / undefined → null; otherwise the id. */
export function normBomId(id: string | null | undefined): string | null {
  const v = id?.trim();
  return v ? v : null;
}

/** Only an ACTIVE, live BOM of this company may be linked to a Sales Order.
 *  Called only when the link is being SET or CHANGED — an SO keeps a link it
 *  already has even if that BOM was later made Obsolete. */
export async function assertBomLinkable(
  tx: DbTransaction,
  companyId: string,
  bomId: string,
): Promise<void> {
  const rows = await tx
    .select({ bomNo: bomMasters.bomNo, status: bomMasters.status })
    .from(bomMasters)
    .where(
      and(
        eq(bomMasters.id, bomId),
        eq(bomMasters.companyId, companyId),
        isNull(bomMasters.deletedAt),
      ),
    )
    .limit(1);
  const bom = rows[0];
  if (!bom) {
    throw new ValidationError(
      'BOM not found. It may have been moved to Trash — pick the BOM again.',
    );
  }
  if (bom.status !== BOM_LINKABLE_STATUS) {
    throw new ConflictError(
      `BOM ${bom.bomNo} is ${BOM_STATUS_WORDS[bom.status] ?? bom.status} — only an Active BOM can be linked to a Sales Order. Make the BOM Active first.`,
    );
  }
}
