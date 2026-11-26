// ADR-292 report 1 — Drawing Rev Register: every Item + Drawing Rev with its
// status (ADR-323 Unverified / Verified / Obsolete), who verified it and when,
// the change note, and how much live work still uses it (open SO / JWSO
// lines, open Job Cards). Same counts as the Drawing Register screen
// (item-revisions/register.ts).

import {
  normalizeRevStatus,
  REV_RELEASE_STATUS_LABELS,
  REV_RELEASE_STATUSES,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { revStatusWords } from '../../../lib/item-revision';
import type { RegisteredReport } from '../registry';
import {
  dateCell,
  enumFilter,
  likeFilter,
  numCell,
  REPORT_ROW_CAP,
  textCell,
  type SqlRow,
} from './report-helpers';

const DONE = sql`('closed', 'dispatched', 'cancelled')`;

export const drawingRevRegisterReport: RegisteredReport = {
  definition: {
    slug: 'drawing-rev-register',
    title: 'Drawing Rev Register',
    description:
      'Every Item + Drawing Rev: status, verified on / by, change note, open order lines and open Job Cards.',
    group: 'Design',
    dept: 'design',
    filters: [
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
      {
        key: 'status',
        label: 'Drawing Rev Status',
        kind: 'enum',
        options: [...REV_RELEASE_STATUSES],
      },
    ],
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'drawing_rev', label: 'Drawing Rev', type: 'text' },
      { key: 'drawing_no', label: 'Drawing No.', type: 'text' },
      { key: 'release_status', label: 'Drawing Rev Status', type: 'text' },
      { key: 'verified_on', label: 'Verified On', type: 'date' },
      { key: 'verified_by', label: 'Verified By', type: 'text' },
      { key: 'change_note', label: 'Change Note', type: 'text' },
      { key: 'open_lines', label: 'Open Order Lines', type: 'number' },
      { key: 'open_job_cards', label: 'Open Job Cards', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const item = likeFilter(filters['item']);
    const status = enumFilter(filters['status'], REV_RELEASE_STATUSES);
    const result = await tx.execute(sql`
      SELECT i.code AS item_code, i.name AS item_name, ir.rev AS drawing_rev,
             ir.drawing_no, ir.release_status,
             (ir.released_at AT TIME ZONE 'Asia/Kolkata')::date::text AS verified_on,
             COALESCE(NULLIF(btrim(ru.full_name), ''), split_part(ru.email, '@', 1)) AS verified_by,
             ir.change_note,
             ((SELECT COUNT(*) FROM public.sales_order_lines l
                 JOIN public.sales_orders h ON h.id = l.sales_order_id
                WHERE l.item_revision_id = ir.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL
                  AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE})
            + (SELECT COUNT(*) FROM public.job_work_order_lines l
                 JOIN public.job_work_orders h ON h.id = l.job_work_order_id
                WHERE l.item_revision_id = ir.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL
                  AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}))::int AS open_lines,
             (SELECT COUNT(*) FROM public.job_cards jc
                LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
               WHERE jc.item_revision_id = ir.id AND jc.deleted_at IS NULL
                 AND COALESCE(js.computed_status, 'open') NOT IN ('complete', 'closed'))::int AS open_job_cards
        FROM public.item_revisions ir
        JOIN public.items i ON i.id = ir.item_id
        LEFT JOIN public.users ru ON ru.id = ir.released_by
       WHERE ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
         ${item ? sql`AND (i.code ILIKE ${item} OR i.name ILIKE ${item})` : sql``}
         ${status ? sql`AND ir.release_status = ANY(${sql.param(revStatusWords(status))}::text[])` : sql``}
       ORDER BY i.code, ir.rev
       LIMIT ${REPORT_ROW_CAP}`);
    const rows = (result as unknown as SqlRow[]).map((r) => ({
      item_code: textCell(r['item_code']),
      item_name: textCell(r['item_name']),
      drawing_rev: textCell(r['drawing_rev']),
      drawing_no: textCell(r['drawing_no']),
      release_status: REV_RELEASE_STATUS_LABELS[normalizeRevStatus(String(r['release_status']))],
      verified_on: dateCell(r['verified_on']),
      verified_by: textCell(r['verified_by']),
      change_note: textCell(r['change_note']),
      open_lines: numCell(r['open_lines']),
      open_job_cards: numCell(r['open_job_cards']),
    }));
    return { columns: drawingRevRegisterReport.definition.columns, rows };
  },
};
