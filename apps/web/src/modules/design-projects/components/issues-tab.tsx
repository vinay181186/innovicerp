// Design Project — Issues tab. The register now renders on the shared FIT table
// (DataTable, tableKey designProjectIssues). ADR-199. Split out of detail.tsx.

import { type DesignIssue, type DesignProjectDetail } from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { DataTable, ROW_TINT, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Badge } from './detail-shared';
import { IssueFormModal, ViewIssueModal } from './issue-modals';

function ageOf(issue: DesignIssue): number {
  const ageMs = Date.now() - new Date(issue.raisedDate).getTime();
  return Math.max(0, Math.round(ageMs / 86400000));
}
function isStale(issue: DesignIssue): boolean {
  return ageOf(issue) > 5 && issue.status !== 'Resolved' && issue.status !== 'Closed';
}

export function IssuesTab({ detail }: { detail: DesignProjectDetail }): React.JSX.Element {
  // Design Issues have their own access form (dsnissue_create).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnissue_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const [showAdd, setShowAdd] = useState(false);
  const [editIssue, setEditIssue] = useState<DesignIssue | null>(null);
  const [viewIssue, setViewIssue] = useState<DesignIssue | null>(null);

  const columns = useMemo<DataTableColumn<DesignIssue>[]>(
    () => [
      {
        id: 'title',
        header: 'Issue',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        className: 'fw-700',
        render: (i) => i.title,
        title: (i) => i.title,
      },
      {
        id: 'part_name',
        header: 'Item Name',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        render: (i) => i.partText ?? '—',
        title: (i) => i.partText ?? '',
      },
      {
        id: 'severity',
        header: 'Severity',
        kind: 'badge',
        render: (i) => <Badge value={i.severity} />,
      },
      {
        id: 'status',
        header: 'Issue Status',
        kind: 'badge',
        render: (i) => <Badge value={i.status} kind="status" />,
      },
      {
        id: 'raised_by',
        header: 'Raised By',
        kind: 'text',
        render: (i) => i.raisedByText ?? '',
      },
      {
        id: 'assigned_to',
        header: 'Assigned To',
        kind: 'text',
        className: 'fw-600',
        render: (i) => i.assignedToText ?? '',
      },
      {
        id: 'raised_date',
        header: 'Raised Date',
        kind: 'date',
        render: (i) => fmtDate(i.raisedDate),
      },
      {
        id: 'days_open',
        header: 'Days Open',
        kind: 'num',
        className: 'mono fw-700',
        render: (i) => (
          <span style={{ color: isStale(i) ? 'var(--red)' : 'var(--text3)' }}>{ageOf(i)}d</span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div className="section-hdr m-0">Design Issues</div>
        {canAdd ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
            <Plus size={12} /> Raise Issue
          </button>
        ) : null}
      </div>
      <DataTable
        tableKey={TABLE_KEYS.designProjectIssues}
        columns={columns}
        rows={detail.issues}
        rowKey={(i) => i.id}
        emptyText="No Issues yet."
        onRowClick={(i) => setViewIssue(i)}
        rowClassName={(i) =>
          i.status === 'Resolved' || i.status === 'Closed'
            ? ROW_TINT.done
            : isStale(i)
              ? ROW_TINT.late
              : undefined
        }
        rowMenu={(i) => [
          {
            key: 'edit',
            label: 'Edit',
            icon: 'pencil',
            hidden: !canEdit,
            onSelect: () => setEditIssue(i),
          },
        ]}
      />

      {showAdd ? (
        <IssueFormModal
          projectId={detail.project.id}
          tasks={detail.tasks}
          mode="add"
          onClose={() => setShowAdd(false)}
        />
      ) : null}
      {editIssue ? (
        <IssueFormModal
          projectId={detail.project.id}
          tasks={detail.tasks}
          mode="edit"
          issue={editIssue}
          onClose={() => setEditIssue(null)}
        />
      ) : null}
      {viewIssue ? <ViewIssueModal issue={viewIssue} onClose={() => setViewIssue(null)} /> : null}
    </div>
  );
}
