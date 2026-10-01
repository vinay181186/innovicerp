// Design Projects list — the fit table's columns, row tint, status badge and the
// ▸ expand panel (ADR-199 table standard 2026-10-01). Split out of
// routes/list.tsx so that file stays under the 400-line ceiling and the sheet is
// defined in one place.
//
// One row per project, every fact its own one-line column (the retired card's
// stacked name / code / SO / customer block is gone). The first column (Project
// No.) is always pinned and carries the fit table's ▸ — the row's one expand
// control — so no chevron is drawn here. Labels: Due Date per docs/NAMING.md
// row 54 (the brief's "Due" is listed there as a variant to avoid).

import type { DesignProjectListItem, DesignProjectStatus } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { ProgressBar, ROW_TINT } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';

/** Overdue = past its Due Date and not yet Released — the same test the retired
 *  card used, so the row wash and the Due Date column agree. */
function isOverdue(p: DesignProjectListItem, today: string): boolean {
  return p.targetDate < today && p.status !== 'Released';
}

/**
 * Whole-row wash by the REAL project-status enum (ADR-199 ROW_TINT):
 *   Released                 → done    (green)
 *   past Due Date, not done  → late    (red)
 *   On Hold                  → pending (amber, waiting)
 *   Design Active / In Review → no wash
 */
export function designProjectRowTint(p: DesignProjectListItem, today: string): string | undefined {
  if (p.status === 'Released') return ROW_TINT.done;
  if (isOverdue(p, today)) return ROW_TINT.late;
  if (p.status === 'On Hold') return ROW_TINT.pending;
  return undefined;
}

/** Design Active / In Review = under way (amber); Released = done (green);
 *  On Hold = waiting (grey). Badge classes only — no hand-mixed colours. */
export function DesignProjectStatusBadge({
  status,
}: {
  status: DesignProjectStatus;
}): React.JSX.Element {
  const cls: Record<DesignProjectStatus, string> = {
    'Design Active': 'b-amber',
    'In Review': 'b-amber',
    Released: 'b-green',
    'On Hold': 'b-grey',
  };
  return <span className={`badge ${cls[status] ?? 'b-grey'}`}>{status}</span>;
}

/** Task-progress bar colour: green once every task is done, blue while under way. */
function progressColor(pct: number): string {
  return pct >= 100 ? 'var(--green)' : 'var(--blue)';
}

export function designProjectColumns(opts: {
  /** IST yyyy-mm-dd for the overdue check — computed once by the route. */
  today: string;
}): DataTableColumn<DesignProjectListItem>[] {
  const { today } = opts;
  return [
    {
      id: 'project_no',
      header: 'Project No.',
      nowrap: true,
      // The row's ▸ (fit engine) opens the detail panel; the Project No. link
      // opens the full project page. stopPropagation on the link only, so the
      // rest of the cell still opens the row.
      render: (p) => (
        <Link
          to="/design-projects/$id"
          params={{ id: p.id }}
          className="td-code"
          title="Open the Design Project"
          onClick={(e) => e.stopPropagation()}
        >
          {p.code}
        </Link>
      ),
    },
    {
      id: 'name',
      kind: 'text',
      header: 'Name',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (p) => p.projectName,
      title: (p) => p.projectName,
    },
    {
      id: 'so_no',
      kind: 'code',
      header: 'SO No.',
      className: 'mono text2',
      nowrap: true,
      render: (p) => p.soCodeText ?? '—',
    },
    {
      id: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      render: (p) => p.clientText ?? '—',
      title: (p) => p.clientText ?? '',
    },
    {
      id: 'lead',
      kind: 'text',
      header: 'Lead',
      align: 'left',
      ellipsis: true,
      render: (p) => p.leadText ?? '—',
      title: (p) => p.leadText ?? '',
    },
    {
      id: 'due_date',
      kind: 'date',
      header: 'Due Date',
      className: 'mono',
      nowrap: true,
      filterValue: (p) => p.targetDate,
      render: (p) => {
        const overdue = isOverdue(p, today);
        return (
          <span
            style={{
              color: overdue ? 'var(--red)' : 'var(--text2)',
              fontWeight: overdue ? 700 : undefined,
            }}
          >
            {fmtDate(p.targetDate)}
            {overdue ? ' ⚠' : ''}
          </span>
        );
      },
    },
    {
      id: 'status',
      kind: 'badge',
      header: 'Project Status',
      nowrap: true,
      render: (p) => <DesignProjectStatusBadge status={p.status} />,
    },
    {
      id: 'tasks',
      header: 'Tasks',
      align: 'right',
      className: 'mono',
      nowrap: true,
      filterValue: (p) => p.taskDone,
      render: (p) => `${p.taskDone}/${p.taskTotal}`,
    },
    {
      id: 'progress',
      minWidth: 150,
      header: 'Progress %',
      filterValue: (p) => p.taskProgressPct,
      // Bar and figure side by side on ONE line (ADR-199), mirroring Job Cards.
      render: (p) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            whiteSpace: 'nowrap',
          }}
        >
          <ProgressBar
            value={p.taskProgressPct}
            color={progressColor(p.taskProgressPct)}
            label={`${p.taskDone} of ${p.taskTotal} tasks done`}
            style={{ width: 48, flex: '0 0 48px' }}
          />
          <span className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>
            {p.taskProgressPct}%
          </span>
        </span>
      ),
    },
    {
      id: 'open_issues',
      header: 'Open Issues',
      align: 'right',
      className: 'mono fw-700',
      headColor: 'var(--red)',
      nowrap: true,
      filterValue: (p) => p.openIssuesCount,
      render: (p) => (
        <span style={{ color: p.openIssuesCount > 0 ? 'var(--red2)' : 'var(--text3)' }}>
          {p.openIssuesCount}
        </span>
      ),
    },
  ];
}

/** The ▸ detail row: the facts that do not earn their own column — Description,
 *  Start Date and the full engineer list. */
export function DesignProjectExpand({
  project,
}: {
  project: DesignProjectListItem;
}): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)', padding: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)', fontSize: 12 }}>
        <span>
          <span className="text3">Start Date: </span>
          <span className="mono">{fmtDate(project.startDate)}</span>
        </span>
        <span>
          <span className="text3">Engineers: </span>
          <span>{project.engineers.length > 0 ? project.engineers.join(', ') : '—'}</span>
        </span>
      </div>
      <div style={{ fontSize: 12 }}>
        <span className="text3">Description: </span>
        <span className="text2">{project.description?.trim() || '—'}</span>
      </div>
    </div>
  );
}
