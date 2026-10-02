// Activity Log list columns (ADR-199 fit table: one line per row). Moved out
// of routes/list.tsx so the route file stays lean and the table joins the one
// shared DataTable standard.
//
// The columns mirror the data the list endpoint sends (activityLogEntrySchema):
// there is no per-field before→after on a LIST row — those live only on the
// per-document History endpoint (activityHistoryRowSchema.changes). So the ▸
// reveal (ActivityLogExpand) shows the row's full Detail / remarks text, which
// is the one long field the row otherwise clips.

import { activityActionLabel as actionLabel } from '@innovic/shared';
import type { ActivityLogEntry } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import { activityActionBadge } from '../lib/activity-entity';
import { DocRefLink } from './doc-ref-link';

/** The time half of `26-Sep-2026 14:05` (IST). '' when the instant has none. */
function fmtTime(ts: string): string {
  const parts = fmtDateTime(ts).split(' ');
  return parts[1] ?? '';
}

/** Columns off by default (DataTable `defaultHidden`); the Columns menu shows them. */
export const ACTIVITY_LOG_HIDDEN_COLUMNS = ['created_on'] as const;

/**
 * @param actions the action codes present in the log (the list response's
 *   `actions`) — the Action column's Sort & Filter tick list.
 * Each `sortFilterField` is a field of the endpoint's column map
 * (apps/api/src/modules/activity-log/sf-columns.ts, ADR-200).
 */
export function activityLogColumns(
  actions: readonly string[] = [],
): DataTableColumn<ActivityLogEntry>[] {
  const actionOptions = actions.map((a) => ({ value: a, label: actionLabel(a) }));
  return [
    {
      id: 'log_date',
      sortFilterField: 'logDate',
      kind: 'date',
      header: 'Log Date',
      className: 'mono text3',
      render: (e) => fmtDate(e.ts),
      filterValue: (e) => e.ts,
    },
    {
      id: 'log_time',
      sortFilterField: 'logTime',
      filterType: 'text',
      kind: 'code',
      header: 'Log Time',
      className: 'mono text3',
      render: (e) => fmtTime(e.ts),
      filterValue: (e) => e.ts,
    },
    {
      id: 'action',
      sortFilterField: 'action',
      filterOptions: actionOptions,
      kind: 'badge',
      header: 'Action',
      render: (e) => (
        <span className={`badge ${activityActionBadge(e.action)}`}>{actionLabel(e.action)}</span>
      ),
      filterValue: (e) => actionLabel(e.action),
    },
    {
      id: 'entity',
      sortFilterField: 'entity',
      kind: 'code',
      header: 'Document Type',
      className: 'fw-700',
      render: (e) => e.entity,
    },
    {
      id: 'detail',
      sortFilterField: 'detail',
      kind: 'text',
      header: 'Detail',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (e) => e.detail,
      title: (e) => e.detail,
    },
    {
      id: 'ref_id',
      sortFilterField: 'refId',
      kind: 'code',
      header: 'Document No.',
      render: (e) => <DocRefLink entity={e.entity} refId={e.refId} entityId={e.entityId} />,
    },
    {
      id: 'user',
      sortFilterField: 'userName',
      kind: 'text',
      header: 'User',
      align: 'left',
      ellipsis: true,
      className: 'amber',
      render: (e) => (
        <>
          {e.userFullName}
          {e.userId === null ? (
            <span className="text3" style={{ marginLeft: 4 }}>
              (snapshot)
            </span>
          ) : null}
        </>
      ),
      title: (e) => e.userName,
      filterValue: (e) => e.userFullName,
    },
    {
      // When the log row was written (IST day) — Sort & Filter can pick a
      // range of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono text3',
      nowrap: true,
      render: (e) => fmtDate(e.createdAt),
    },
  ];
}

/** ▸ reveal — the row's full Detail / remarks text (the only long field a row
 *  clips). Per-field before→after is not on a list row; it lives on the
 *  per-document History tab. */
export function ActivityLogExpand({ entry }: { entry: ActivityLogEntry }): React.JSX.Element {
  return (
    <div style={{ padding: '10px 16px' }}>
      <div className="text3" style={{ fontSize: 11, marginBottom: 4, textTransform: 'uppercase' }}>
        Detail
      </div>
      <div className="text2" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {entry.detail || '—'}
      </div>
    </div>
  );
}
