// ADR-292 report 6 — who viewed, downloaded or printed a drawing (and who was
// refused), from the activity log rows drawing-files/service.ts writes.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import {
  enumFilter,
  isoDateFilter,
  likeFilter,
  REPORT_ROW_CAP,
  textCell,
  type SqlRow,
} from './report-helpers';

const ACTIONS = [
  'drawing_view',
  'drawing_download',
  'drawing_download_refused',
  'drawing_print',
  'drawing_print_refused',
] as const;
type DrawingAction = (typeof ACTIONS)[number];
const ACTION_LABELS: Record<DrawingAction, string> = {
  drawing_view: 'Viewed',
  drawing_download: 'Downloaded',
  drawing_download_refused: 'Download refused',
  drawing_print: 'Printed',
  drawing_print_refused: 'Print refused',
};
const UUID_RE = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export const drawingPrintDownloadHistoryReport: RegisteredReport = {
  definition: {
    slug: 'drawing-print-download-history',
    title: 'Drawing Print / Download History',
    description:
      'Every drawing viewed, downloaded or printed — and every refused download or print — with the user, the Drawing Rev and the time.',
    group: 'Design',
    dept: 'design',
    filters: [
      { key: 'from', label: 'From Date', kind: 'date' },
      { key: 'to', label: 'To Date', kind: 'date' },
      { key: 'user', label: 'User', kind: 'text', placeholder: 'User name' },
      { key: 'action', label: 'Drawing Action', kind: 'enum', options: [...ACTIONS] },
    ],
    columns: [
      { key: 'logged_at', label: 'Logged At', type: 'datetime' },
      { key: 'user_name', label: 'User', type: 'text' },
      { key: 'drawing_action', label: 'Drawing Action', type: 'text' },
      { key: 'drawing_rev', label: 'Item / Drawing Rev', type: 'text' },
      { key: 'document', label: 'Document', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const from = isoDateFilter(filters['from']);
    const to = isoDateFilter(filters['to']);
    const user = likeFilter(filters['user']);
    const action = enumFilter(filters['action'], ACTIONS);
    const result = await tx.execute(sql`
      SELECT to_char(a.ts AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS logged_at,
             a.user_name, a.action,
             CASE WHEN ir.id IS NOT NULL THEN i.code || '/' || ir.rev END AS drawing_rev,
             CASE WHEN ir.id IS NULL THEN a.ref_id END AS document,
             a.detail
        FROM public.activity_log a
        LEFT JOIN public.item_revisions ir
          ON a.ref_id ~* ${UUID_RE}
         AND ir.id = (CASE WHEN a.ref_id ~* ${UUID_RE} THEN a.ref_id END)::uuid
        LEFT JOIN public.items i ON i.id = ir.item_id
       WHERE a.company_id = ${companyId}::uuid
         AND a.action = ANY(${sql.param([...ACTIONS])}::text[])
         ${action ? sql`AND a.action = ${action}` : sql``}
         ${from ? sql`AND (a.ts AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date` : sql``}
         ${to ? sql`AND (a.ts AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date` : sql``}
         ${user ? sql`AND a.user_name ILIKE ${user}` : sql``}
       ORDER BY a.ts DESC, a.id
       LIMIT ${REPORT_ROW_CAP}`);
    const rows = (result as unknown as SqlRow[]).map((r) => ({
      logged_at: textCell(r['logged_at']),
      user_name: textCell(r['user_name']),
      drawing_action: ACTION_LABELS[r['action'] as DrawingAction] ?? textCell(r['action']),
      drawing_rev: textCell(r['drawing_rev']),
      document: textCell(r['document']),
      detail: textCell(r['detail']),
    }));
    return { columns: drawingPrintDownloadHistoryReport.definition.columns, rows };
  },
};
