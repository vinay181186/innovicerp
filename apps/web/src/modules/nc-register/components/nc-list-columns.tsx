// NC Register list — columns, ▸ expanded detail, row tint and the per-row ⋯
// menu for the shared FIT table (ADR-199: <DataTable tableKey=…>). Split out of
// routes/list.tsx so that file stays under the 400-line ceiling.
//
// Columns (first pinned): NC No. · NC Status · Disposition · Item Code ·
// Item Name · Rejected · Reason · NC Date. Centred by the table standard;
// Rejected is the one number column (align 'right' -> the num kind); Item Name
// is the one left-aligned text column that shares the spare width.
//
// ▸ expand (NcExpanded): POL · JC No. · Op · Rework done · CAPA No. — the extra
// facts the retired card showed on its meta line, shown in the fit table's one
// detail row.

import {
  NC_DISPOSITION_LABELS,
  NC_DISPOSITIONS,
  NC_REASON_CATEGORIES,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUSES,
  NC_STATUS_LABELS,
  opSrNo,
  roundQty,
  type NcRegisterListItem,
  type NcStatus,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { ROW_TINT, type DataTableColumn } from '@/ui/data';
import type { RowMenuItem } from '@/ui/data/row-menu-logic';
import { NcDispositionBadge } from './nc-disposition-badge';
import { NcStatusBadge } from './nc-status-badge';

/** Sort & Filter (ADR-200, server mode) tick lists: stored code + label shown. */
const NC_STATUS_OPTIONS = NC_STATUSES.map((value) => ({ value, label: NC_STATUS_LABELS[value] }));
const NC_DISPOSITION_OPTIONS = NC_DISPOSITIONS.map((value) => ({
  value,
  label: NC_DISPOSITION_LABELS[value],
}));
const NC_REASON_OPTIONS = NC_REASON_CATEGORIES.map((value) => ({
  value,
  label: NC_REASON_CATEGORY_LABELS[value],
}));

/** Columns off by default on the NC Register sheet — passed to the DataTable's
 *  `defaultHidden`. They stay reachable in ▸ / the Columns menu. */
export const NC_LIST_HIDDEN_COLUMNS = ['created_on'];

/** NC status → row tint (ADR-199 ROW_TINT), kept in step with NcStatusBadge:
 *  recovery under way (rework / repair / at vendor / QC pending) reads amber
 *  (pending tint); rework completed / closed read green (done tint); a freshly
 *  raised or just-disposed NC — waiting for the next step — stays untinted, the
 *  same way JWSO leaves draft / open untinted. */
export function ncRowTint(status: NcStatus): string | undefined {
  switch (status) {
    case 'under_rework':
    case 'under_repair':
    case 'sent_to_vendor':
    case 'received_qc_pending':
      return ROW_TINT.pending;
    case 'rework_done':
    case 'closed':
      return ROW_TINT.done;
    default:
      // pending (NC Raised), disposed — waiting for the next step.
      return undefined;
  }
}

/** The item code with its drawing revision, or the typed snapshot as a fallback
 *  (read `itemCode ?? itemCodeText`, NAMING.md §A xxxText rule). */
function ncItemCode(nc: NcRegisterListItem): string {
  return nc.itemCode ? itemCodeWithRev(nc.itemCode, nc.itemRevision) : (nc.itemCodeText ?? '');
}

function ncItemName(nc: NcRegisterListItem): string {
  return nc.itemName ?? nc.itemNameText ?? '';
}

/** "Op 3: Milling" from the resolved JC op, the op snapshot or the QC op text —
 *  null when the NC carries no operation at all. */
function ncOpText(nc: NcRegisterListItem): string | null {
  const seq = nc.jcOpSeqResolved ?? nc.opSeq;
  const op = nc.jcOpOperation ?? nc.operationText ?? nc.qcOperationText;
  if (seq == null && !op) return null;
  return `${seq != null ? `Op ${opSrNo(seq)}` : ''}${seq != null && op ? ': ' : ''}${op ?? ''}`;
}

export function ncListColumns(): DataTableColumn<NcRegisterListItem>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'nc_code',
      sortFilterField: 'ncCode',
      header: 'NC No.',
      nowrap: true,
      render: (nc) => (
        <Link
          to="/nc-register/$id"
          params={{ id: nc.id }}
          className="td-code"
          style={{ color: 'var(--red2)', fontWeight: 800 }}
          title="Open the NC detail page"
          onClick={(e) => e.stopPropagation()}
        >
          {nc.code}
        </Link>
      ),
    },
    {
      id: 'nc_status',
      sortFilterField: 'status',
      filterOptions: NC_STATUS_OPTIONS,
      kind: 'badge',
      header: 'NC Status',
      nowrap: true,
      render: (nc) => <NcStatusBadge status={nc.status} />,
    },
    {
      id: 'disposition',
      sortFilterField: 'disposition',
      filterOptions: NC_DISPOSITION_OPTIONS,
      kind: 'badge',
      header: 'Disposition',
      nowrap: true,
      render: (nc) => <NcDispositionBadge disposition={nc.disposition} />,
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      className: 'td-code',
      nowrap: true,
      render: (nc) => (
        <span className="td-code" style={{ color: 'var(--text)' }}>
          {ncItemCode(nc) || '—'}
        </span>
      ),
      filterValue: (nc) => ncItemCode(nc),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (nc) => ncItemName(nc) || '—',
      title: (nc) => ncItemName(nc),
    },
    {
      id: 'rejected_qty',
      sortFilterField: 'rejectedQty',
      filterType: 'num',
      header: 'Rejected',
      headColor: 'var(--red)',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (nc) => (
        <span style={{ color: 'var(--red2)' }}>{roundQty(Number(nc.rejectedQty))}</span>
      ),
      filterValue: (nc) => Number(nc.rejectedQty),
    },
    {
      id: 'reason',
      sortFilterField: 'reasonCategory',
      filterType: 'list',
      filterOptions: NC_REASON_OPTIONS,
      header: 'Reason',
      nowrap: true,
      className: 'text2',
      render: (nc) => NC_REASON_CATEGORY_LABELS[nc.reasonCategory],
      filterValue: (nc) => NC_REASON_CATEGORY_LABELS[nc.reasonCategory],
    },
    {
      id: 'nc_date',
      sortFilterField: 'ncDate',
      kind: 'date',
      header: 'NC Date',
      className: 'mono',
      nowrap: true,
      render: (nc) => fmtDate(nc.ncDate),
    },
    {
      // When the NC record was entered (IST day) — Sort & Filter can pick a
      // range of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono',
      nowrap: true,
      render: (nc) => fmtDate(nc.createdAt),
    },
  ];
}

/** ▸ detail row (fit table) — the extra facts the card's meta line carried:
 *  POL, JC No., Op, Rework done, CAPA No. */
export function NcExpanded({
  nc,
  onOpenCapa,
}: {
  nc: NcRegisterListItem;
  onOpenCapa: (capaCode: string) => void;
}): React.JSX.Element {
  const opText = ncOpText(nc);
  const reworkDone =
    nc.disposition === 'rework' && Number(nc.reworkDoneQty) > 0
      ? `${Number(nc.reworkDoneQty)} of ${Number(nc.rejectedQty)} completed`
      : '—';
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 24px',
        padding: '4px 2px',
        fontSize: 12,
      }}
    >
      <Field label="POL">
        {nc.clientPoLineNo ? (
          <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
            {nc.clientPoLineNo}
          </span>
        ) : (
          '—'
        )}
      </Field>
      <Field label="JC No.">
        {nc.jcCode ? (
          <span className="mono" style={{ color: 'var(--cyan)' }}>
            {nc.jcCode}
          </span>
        ) : (
          '—'
        )}
      </Field>
      <Field label="Op">{opText ?? '—'}</Field>
      <Field label="Rework done">{reworkDone}</Field>
      <Field label="CAPA No.">
        {nc.linkedCapaCode ? (
          <button
            type="button"
            className="mono"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--purple)',
              fontWeight: 700,
            }}
            title={`Open CAPA ${nc.linkedCapaCode}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenCapa(nc.linkedCapaCode as string);
            }}
          >
            {nc.linkedCapaCode}
          </button>
        ) : (
          '—'
        )}
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span>
      <span className="text3" style={{ marginRight: 6 }}>
        {label}
      </span>
      <span className="text2">{children}</span>
    </span>
  );
}

/** Per-row ⋯ menu items — the same handlers and gates the retired card used,
 *  all living on the NC detail page (they link there), plus Assign Task. The
 *  workflow action follows the card's exact precedence so a row shows the one
 *  it showed before: Dispose (pending) → Close Rework (disposed + rework) →
 *  CAPA (disposed/… with no CAPA yet). Assign shows for any open NC. */
export function ncRowMenu(
  nc: NcRegisterListItem,
  opts: {
    canDispose: boolean;
    canCreateCapa: boolean;
    onAssign: (nc: NcRegisterListItem) => void;
  },
): RowMenuItem[] {
  const items: RowMenuItem[] = [];
  const to = `/nc-register/${nc.id}`;

  if (opts.canDispose && nc.status === 'pending') {
    items.push({ key: 'dispose', label: 'Dispose', icon: 'pencil', group: 'workflow', to });
  } else if (opts.canDispose && nc.status === 'disposed' && nc.disposition === 'rework') {
    items.push({
      key: 'close-rework',
      label: 'Close Rework',
      icon: 'check',
      group: 'workflow',
      to,
    });
  } else if (opts.canCreateCapa && nc.status !== 'pending' && !nc.linkedCapaCode) {
    items.push({ key: 'capa', label: 'Create CAPA', icon: 'activity', group: 'workflow', to });
  }

  if (nc.status !== 'closed') {
    items.push({
      key: 'assign',
      label: 'Assign Task',
      icon: 'user-round',
      group: 'assign',
      onSelect: () => opts.onAssign(nc),
    });
  }

  return items;
}
