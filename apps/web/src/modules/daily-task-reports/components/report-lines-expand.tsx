// The ▸ reveal under a Daily Task Report row (ADR-199): the report's task lines
// with their Detail (description), Ref, Hours, per-line Status and Remarks. The
// list row carries only the summary (task count, hours), so the lines are
// fetched on open — a collapsed row never fires the request.

import type { DailyReportLineStatus, DailyTaskReportLine } from '@innovic/shared';
import { DAILY_REPORT_LINE_STATUS_LABELS } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { useDailyReportDetail } from '../api';

const LINE_STATUS_BADGE: Record<DailyReportLineStatus, string> = {
  completed: 'badge b-green',
  in_progress: 'badge b-amber',
  pending: 'badge b-grey',
  blocked: 'badge b-red',
};

const lineColumns: DataTableColumn<DailyTaskReportLine>[] = [
  {
    id: 'line_no',
    header: '#',
    align: 'right',
    className: 'mono',
    nowrap: true,
    render: (l) => l.lineNo,
  },
  {
    id: 'detail',
    header: 'Detail',
    kind: 'text',
    align: 'left',
    className: 'fw-700',
    ellipsis: true,
    render: (l) => l.description,
    title: (l) => l.description,
  },
  {
    id: 'ref',
    header: 'Ref',
    className: 'mono',
    nowrap: true,
    render: (l) => l.ref ?? '—',
  },
  {
    id: 'hours',
    header: 'Hours',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    render: (l) => `${l.hours.toFixed(1)}h`,
  },
  {
    id: 'status',
    kind: 'badge',
    header: 'Status',
    nowrap: true,
    render: (l) => (
      <span className={LINE_STATUS_BADGE[l.status]}>
        {DAILY_REPORT_LINE_STATUS_LABELS[l.status]}
      </span>
    ),
  },
  {
    id: 'remarks',
    header: 'Remarks',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    render: (l) => l.remarks ?? '—',
    title: (l) => l.remarks ?? '',
  },
];

export function ReportLinesExpand({ id }: { id: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useDailyReportDetail(id);

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 16, fontSize: 12 }}>
        <Loader2 className="inline h-3 w-3 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 16, fontSize: 12, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load this report. Try again.'}
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      <DataTable<DailyTaskReportLine>
        columns={lineColumns}
        rows={data.lines}
        density="compact"
        empty="No task lines."
      />
    </div>
  );
}
