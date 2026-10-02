// Instrument register reads (ADR-193 phase 4a): list, one instrument with its
// calibration history, and the per-item "received but not registered" count.

import type {
  CalibrationResult,
  InstrumentCalibration,
  InstrumentDetail,
  InstrumentListItem,
  InstrumentStatus,
  ListInstrumentsQuery,
  ListInstrumentsResponse,
  UnregisteredCount,
} from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { NotFoundError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { roundQty } from '../../lib/stock-ledger';
import { addDays, dateOut, requireCompany, todayIst } from './common';
import { INSTRUMENT_SF_COLUMNS } from './sf-columns';

// Holder of an Issued instrument = the latest issue it went out on.
const SELECT = sql`
  SELECT ins.id, ins.item_id, i.code AS item_code, i.name AS item_name,
         ins.serial_no, ins.status, ins.calibration_interval_days,
         ins.last_calibrated_on, ins.calibration_due_on, ins.location, ins.remarks,
         h.holder, h.tool_issue_code,
         EXISTS (
           SELECT 1 FROM public.tool_writeoffs w
           WHERE w.instrument_id = ins.id AND w.status = 'pending' AND w.deleted_at IS NULL
         ) AS writeoff_pending
  FROM public.instruments ins
  JOIN public.items i ON i.id = ins.item_id
  LEFT JOIN LATERAL (
    SELECT ti.issued_to AS holder, ti.code AS tool_issue_code
    FROM public.tool_issue_instruments l
    JOIN public.tool_issues ti ON ti.id = l.tool_issue_id AND ti.deleted_at IS NULL
    WHERE l.instrument_id = ins.id AND l.deleted_at IS NULL AND ins.status = 'issued'
    ORDER BY l.created_at DESC
    LIMIT 1
  ) h ON true`;

function toListItem(r: Record<string, unknown>, today: string): InstrumentListItem {
  const due = dateOut(r['calibration_due_on']);
  const status = r['status'] as InstrumentStatus;
  return {
    id: String(r['id']),
    itemId: String(r['item_id']),
    itemCode: String(r['item_code'] ?? ''),
    itemName: (r['item_name'] as string | null) ?? null,
    serialNo: String(r['serial_no']),
    status,
    calibrationIntervalDays:
      r['calibration_interval_days'] == null ? null : Number(r['calibration_interval_days']),
    lastCalibratedOn: dateOut(r['last_calibrated_on']),
    calibrationDueOn: due,
    isCalibrationOverdue: due !== null && due < today && status !== 'lost' && status !== 'scrapped',
    location: (r['location'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    heldBy: (r['holder'] as string | null) ?? null,
    toolIssueCode: (r['tool_issue_code'] as string | null) ?? null,
    writeoffPending: Boolean(r['writeoff_pending']),
  };
}

/** One instrument as the list shows it — for callers inside a transaction. */
export async function readInstrument(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<InstrumentListItem> {
  const rows = (await tx.execute(sql`
    ${SELECT}
    WHERE ins.id = ${id}::uuid AND ins.company_id = ${companyId}::uuid AND ins.deleted_at IS NULL
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) throw new NotFoundError('Instrument not found.');
  return toListItem(rows[0], todayIst());
}

export async function listInstruments(
  q: ListInstrumentsQuery,
  user: AuthContext,
): Promise<ListInstrumentsResponse> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  const today = todayIst();
  return withUserContext(user, async (tx) => {
    const term = q.search ? `%${q.search}%` : null;
    const parts: SQL[] = [sql`ins.company_id = ${companyId}::uuid AND ins.deleted_at IS NULL`];
    if (term) {
      parts.push(
        sql`(ins.serial_no ILIKE ${term} OR i.code ILIKE ${term} OR i.name ILIKE ${term} OR ins.location ILIKE ${term})`,
      );
    }
    if (q.itemId) parts.push(sql`ins.item_id = ${q.itemId}::uuid`);
    if (q.status) parts.push(sql`ins.status = ${q.status}`);
    if (q.due) {
      const limit =
        q.due === 'overdue' ? sql`< ${today}::date` : sql`<= ${addDays(today, 7)}::date`;
      parts.push(sql`ins.status NOT IN ('lost', 'scrapped') AND ins.calibration_due_on ${limit}`);
    }
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to list AND count.
    const sf = readSf(q.sf);
    const where = sql`${sql.join(parts, sql` AND `)} ${sfWhere(INSTRUMENT_SF_COLUMNS, sf)}`;
    const orderBy = sfOrderBy(INSTRUMENT_SF_COLUMNS, sf, sql`i.code, lower(ins.serial_no)`);
    const rows = (await tx.execute(sql`
      ${SELECT}
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    // Counted over the very SELECT the page reads, so the holder lateral (the
    // Held By filter) is there too.
    const totals = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM (${SELECT} WHERE ${where}) z
    `)) as unknown as Array<{ total: number }>;
    return {
      items: rows.map((r) => toListItem(r, today)),
      total: Number(totals[0]?.total ?? 0),
      limit: q.limit,
      offset: q.offset,
    };
  });
}

export async function getInstrument(id: string, user: AuthContext): Promise<InstrumentDetail> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const head = await readInstrument(tx, companyId, id);
    const rows = (await tx.execute(sql`
      SELECT c.id, c.calibrated_on, c.result, c.certificate_no, c.agency, c.next_due_on,
             c.remarks, u.full_name AS recorded_by_name
      FROM public.instrument_calibrations c
      LEFT JOIN public.users u ON u.id = c.created_by
      WHERE c.instrument_id = ${id}::uuid AND c.company_id = ${companyId}::uuid
        AND c.deleted_at IS NULL
      ORDER BY c.calibrated_on DESC, c.created_at DESC
    `)) as unknown as Array<Record<string, unknown>>;
    const calibrations: InstrumentCalibration[] = rows.map((r) => ({
      id: String(r['id']),
      calibratedOn: dateOut(r['calibrated_on']) ?? '',
      result: r['result'] as CalibrationResult,
      certificateNo: (r['certificate_no'] as string | null) ?? null,
      agency: (r['agency'] as string | null) ?? null,
      nextDueOn: dateOut(r['next_due_on']),
      remarks: (r['remarks'] as string | null) ?? null,
      recordedByName: (r['recorded_by_name'] as string | null) ?? null,
    }));
    return { ...head, calibrations };
  });
}

/** Serial items with pieces received (On Hand) but not yet in the register. */
export async function listUnregistered(user: AuthContext): Promise<UnregisteredCount[]> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT i.id AS item_id, i.code AS item_code,
             COALESCE(b.on_hand_qty, 0) AS on_hand_qty,
             (SELECT COUNT(*) FROM public.instruments ins
              WHERE ins.item_id = i.id AND ins.deleted_at IS NULL
                AND ins.status IN ('in_store', 'at_calibration')) AS registered
      FROM public.items i
      LEFT JOIN public.item_stock_balances b
        ON b.item_id = i.id AND b.company_id = i.company_id
      WHERE i.company_id = ${companyId}::uuid AND i.deleted_at IS NULL
        AND i.item_type = 'tool' AND i.track_serial = true
      ORDER BY i.code
    `)) as unknown as Array<Record<string, unknown>>;
    return rows
      .map((r) => {
        const onHandQty = roundQty(Number(r['on_hand_qty'] ?? 0));
        const registeredInStoreQty = Number(r['registered'] ?? 0);
        return {
          itemId: String(r['item_id']),
          itemCode: String(r['item_code']),
          onHandQty,
          registeredInStoreQty,
          unregisteredQty: roundQty(onHandQty - registeredInStoreQty),
        };
      })
      .filter((r) => r.unregisteredQty > 0);
  });
}
