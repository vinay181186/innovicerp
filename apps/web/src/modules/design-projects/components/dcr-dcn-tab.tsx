// Design Project — DCR / DCN tab. Both registers now render on the shared FIT
// table (DataTable, tableKeys designProjectDcr / designProjectDcn). ADR-199.
// Split out of detail.tsx. The StatStrip, the sub-tab switch and the status
// filter are all preserved.

import {
  DESIGN_DCN_STATUSES,
  DESIGN_DCR_STATUSES,
  type DesignDcn,
  type DesignDcr,
  type DesignProjectDetail,
} from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { DataTable, ROW_TINT, StatStrip, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Badge } from './detail-shared';
import { DcnFormModal, DcrFormModal } from './dcr-dcn-modals';

function dcrAge(d: DesignDcr): number {
  const ageMs = Date.now() - new Date(d.requestDate).getTime();
  return Math.max(0, Math.round(ageMs / 86400000));
}

export function DcrDcnTab({ detail }: { detail: DesignProjectDetail }): React.JSX.Element {
  // DCR/DCN carry their own Design form key now (gap fix).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsndcr_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const [subTab, setSubTab] = useState<'dcr' | 'dcn'>('dcr');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAddDcr, setShowAddDcr] = useState(false);
  const [showAddDcn, setShowAddDcn] = useState(false);
  const [editDcr, setEditDcr] = useState<DesignDcr | null>(null);
  const [editDcn, setEditDcn] = useState<DesignDcn | null>(null);

  const dcrs = detail.dcrs;
  const dcns = detail.dcns;
  const pendingDcrs = dcrs.filter(
    (d) => d.status === 'Submitted' || d.status === 'Under Review',
  ).length;
  const acceptedDcrs = dcrs.filter((d) => d.status === 'Accepted').length;
  const activeDcns = dcns.filter((d) => d.status !== 'Released').length;
  // Legacy filters the table rows but leaves the sub-tab counts + tiles on the
  // unfiltered lists (L8084-8085 vs L8094/L8116).
  const fDcrs = dcrs.filter((d) => statusFilter === 'all' || d.status === statusFilter);
  const fDcns = dcns.filter((d) => statusFilter === 'all' || d.status === statusFilter);

  const dcrColumns = useMemo<DataTableColumn<DesignDcr>[]>(
    () => [
      {
        id: 'dcr_code',
        header: 'DCR No.',
        kind: 'code',
        className: 'mono fw-700',
        nowrap: true,
        render: (d) => <span style={{ color: 'var(--cyan)' }}>{d.code}</span>,
        title: (d) => d.code,
      },
      {
        id: 'title',
        header: 'Title',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        className: 'fw-600',
        render: (d) => d.title,
        title: (d) => d.title,
      },
      {
        id: 'change_type',
        header: 'Change Type',
        kind: 'badge',
        render: (d) => <Badge value={d.changeType} />,
      },
      {
        id: 'part_name',
        header: 'Item Name',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        render: (d) => d.partAffected ?? '',
        title: (d) => d.partAffected ?? '',
      },
      {
        id: 'priority',
        header: 'Priority',
        kind: 'badge',
        render: (d) => <Badge value={d.priority} />,
      },
      {
        id: 'status',
        header: 'DCR Status',
        kind: 'badge',
        render: (d) => <Badge value={d.status} kind="status" />,
      },
      {
        id: 'requested_by',
        header: 'Requested By',
        kind: 'text',
        render: (d) => d.requestedByText ?? '',
      },
      {
        id: 'request_date',
        header: 'Request Date',
        kind: 'date',
        className: 'mono',
        render: (d) => fmtDate(d.requestDate),
      },
      {
        id: 'age',
        header: 'Age',
        kind: 'num',
        className: 'mono fw-700',
        render: (d) => {
          const age = dcrAge(d);
          const hot = age > 5 && d.status !== 'Accepted' && d.status !== 'Rejected';
          return <span style={{ color: hot ? 'var(--red)' : 'var(--text3)' }}>{age}d</span>;
        },
      },
      {
        id: 'dcn',
        header: 'DCN',
        kind: 'code',
        render: (d) => {
          const linked = dcns.find((n) => n.linkedDcrId === d.id);
          return linked ? (
            <span style={{ color: 'var(--green2)', fontWeight: 700 }}>✔ {linked.code}</span>
          ) : (
            '—'
          );
        },
      },
    ],
    [dcns],
  );

  const dcnColumns = useMemo<DataTableColumn<DesignDcn>[]>(
    () => [
      {
        id: 'dcn_code',
        header: 'DCN No.',
        kind: 'code',
        className: 'mono fw-700',
        nowrap: true,
        render: (d) => <span style={{ color: 'var(--purple)' }}>{d.code}</span>,
        title: (d) => d.code,
      },
      {
        id: 'title',
        header: 'Title',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        className: 'fw-600',
        render: (d) => d.title,
        title: (d) => d.title,
      },
      {
        id: 'linked_dcr',
        header: 'Linked DCR',
        kind: 'code',
        className: 'fw-700',
        render: (d) => {
          const linked = dcrs.find((x) => x.id === d.linkedDcrId);
          return <span style={{ color: 'var(--cyan)' }}>{linked?.code ?? '—'}</span>;
        },
      },
      {
        id: 'status',
        header: 'DCN Status',
        kind: 'badge',
        render: (d) => <Badge value={d.status} kind="status" />,
      },
      {
        id: 'released_date',
        header: 'Released Date',
        kind: 'date',
        render: (d) => fmtDate(d.releasedDate),
      },
    ],
    [dcrs],
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <StatStrip
          items={[
            { key: 'dcrs', label: 'Total DCRs', count: dcrs.length },
            { key: 'pending', label: 'Pending', count: pendingDcrs, color: 'var(--blue)' },
            { key: 'accepted', label: 'Accepted', count: acceptedDcrs, color: 'var(--green2)' },
            { key: 'dcns', label: 'Active DCNs', count: activeDcns, color: 'var(--amber2)' },
          ]}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className={`btn btn-sm ${subTab === 'dcr' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontWeight: 700 }}
            onClick={() => setSubTab('dcr')}
          >
            DCR Register ({dcrs.length})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${subTab === 'dcn' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontWeight: 700 }}
            onClick={() => setSubTab('dcn')}
          >
            DCN Register ({dcns.length})
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            style={{
              padding: '5px 8px',
              fontSize: 11,
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
            }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            {(subTab === 'dcr' ? DESIGN_DCR_STATUSES : DESIGN_DCN_STATUSES).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {canAdd ? (
            subTab === 'dcr' ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowAddDcr(true)}
              >
                <Plus size={12} /> New DCR
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowAddDcn(true)}
              >
                <Plus size={12} /> New DCN
              </button>
            )
          ) : null}
        </div>
      </div>

      {subTab === 'dcr' ? (
        <DataTable
          tableKey={TABLE_KEYS.designProjectDcr}
          columns={dcrColumns}
          rows={fDcrs}
          rowKey={(d) => d.id}
          empty="No DCRs yet."
          // DCR rows open the edit form ONLY when the user may edit.
          onRowClick={(d) => setEditDcr(d)}
          isRowClickable={() => canEdit}
          rowClassName={(d) =>
            d.status === 'Accepted'
              ? ROW_TINT.done
              : d.status === 'Rejected'
                ? ROW_TINT.cancelled
                : undefined
          }
          rowMenu={(d) => [
            {
              key: 'edit',
              label: 'Edit',
              icon: 'pencil',
              hidden: !canEdit,
              onSelect: () => setEditDcr(d),
            },
          ]}
        />
      ) : (
        <DataTable
          tableKey={TABLE_KEYS.designProjectDcn}
          columns={dcnColumns}
          rows={fDcns}
          rowKey={(d) => d.id}
          empty="No DCNs yet. Create from an accepted DCR."
          onRowClick={(d) => setEditDcn(d)}
          isRowClickable={() => canEdit}
          rowClassName={(d) => (d.status === 'Released' ? ROW_TINT.done : undefined)}
          rowMenu={(d) => [
            {
              key: 'edit',
              label: 'Edit',
              icon: 'pencil',
              hidden: !canEdit,
              onSelect: () => setEditDcn(d),
            },
          ]}
        />
      )}

      {showAddDcr ? (
        <DcrFormModal
          projectId={detail.project.id}
          mode="add"
          onClose={() => setShowAddDcr(false)}
        />
      ) : null}
      {editDcr ? (
        <DcrFormModal
          projectId={detail.project.id}
          mode="edit"
          dcr={editDcr}
          onClose={() => setEditDcr(null)}
        />
      ) : null}
      {showAddDcn ? (
        <DcnFormModal
          projectId={detail.project.id}
          dcrs={dcrs}
          mode="add"
          onClose={() => setShowAddDcn(false)}
        />
      ) : null}
      {editDcn ? (
        <DcnFormModal
          projectId={detail.project.id}
          dcrs={dcrs}
          mode="edit"
          dcn={editDcn}
          onClose={() => setEditDcn(null)}
        />
      ) : null}
    </div>
  );
}
