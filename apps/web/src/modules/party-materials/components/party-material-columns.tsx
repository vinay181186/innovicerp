// Columns + ▸ detail for the Customer Material master sheet (ADR-199 table
// standard, 2026-10-01). The master table runs on the shared FIT <DataTable>.
//
// Main columns (first pinned = Code): Code · Name · UOM · Customer · In Stock ·
// Issued. The ▸ detail row carries the fields the master line does not show:
// Description, Grade, Recorded By / On — plus Total Received and Returned, kept
// here so the conversion drops no data the old wide table used to show.
//
// Sort & Filter runs on the SERVER (ADR-200): `sortFilterField` names the field
// in api party-materials/sf-columns.ts.

import type { PartyMaterialListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

/** Columns off by default (DataTable `defaultHidden`); Columns ▾ shows them. */
export const PARTY_MATERIAL_HIDDEN_COLUMNS = ['created_on'] as const;

/** The six master columns (+ Created On, off by default). Code is column 0 and
 *  so always pinned. */
export function partyMaterialColumns(): DataTableColumn<PartyMaterialListItem>[] {
  return [
    {
      id: 'code',
      sortFilterField: 'code',
      header: 'Code',
      kind: 'code',
      nowrap: true,
      render: (pm) => (
        <span className="td-code" style={{ color: 'var(--purple)' }}>
          {pm.code}
        </span>
      ),
    },
    {
      id: 'name',
      sortFilterField: 'name',
      header: 'Material Name',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      key: 'name',
      title: (pm) => pm.name,
    },
    {
      id: 'uom',
      sortFilterField: 'uom',
      filterType: 'text',
      header: 'UOM',
      kind: 'badge',
      nowrap: true,
      render: (pm) => (
        <span className="tag" style={{ background: 'var(--bg4)', color: 'var(--text2)' }}>
          {pm.uom}
        </span>
      ),
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      header: 'Customer',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (pm) => pm.clientName ?? pm.clientCodeText ?? '—',
      title: (pm) => pm.clientName ?? pm.clientCodeText ?? '',
    },
    {
      id: 'in_stock',
      sortFilterField: 'stockQty',
      header: 'In Stock',
      kind: 'num',
      nowrap: true,
      headColor: 'var(--green)',
      render: (pm) => (
        <span
          className="mono fw-700"
          style={{ fontSize: 14, color: pm.stockQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {pm.stockQty}
        </span>
      ),
    },
    {
      id: 'issued',
      sortFilterField: 'issuedQty',
      header: 'Issued',
      kind: 'num',
      nowrap: true,
      headColor: 'var(--amber2)',
      render: (pm) => (
        <span className="mono" style={{ color: 'var(--amber2)' }}>
          {pm.issuedQty}
        </span>
      ),
    },
    {
      // When the material was recorded (IST day). Off by default; Columns ▾
      // shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      header: 'Created On',
      kind: 'date',
      nowrap: true,
      render: (pm) => fmtDate(pm.createdAt),
    },
  ];
}

/** The ▸ detail panel for one material. */
export function PartyMaterialDetails({ pm }: { pm: PartyMaterialListItem }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-6)',
        textAlign: 'left',
      }}
    >
      <DetailField label="Description" value={pm.description ?? '—'} />
      <DetailField label="Grade" value={pm.material ?? '—'} />
      <DetailField
        label="Total Received"
        value={String(pm.receivedQty)}
        valueStyle={{ color: 'var(--cyan)' }}
        mono
      />
      <DetailField
        label="Returned"
        value={String(pm.returnedQty)}
        valueStyle={{ color: pm.returnedQty > 0 ? 'var(--purple)' : 'var(--text3)' }}
        mono
      />
      <DetailField label="Recorded By" value={pm.createdBy} mono />
      <DetailField label="Recorded On" value={fmtDate(pm.createdAt)} />
    </div>
  );
}

function DetailField({
  label,
  value,
  valueStyle,
  mono = false,
}: {
  label: string;
  value: string;
  valueStyle?: React.CSSProperties;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <div className="text3" style={{ fontSize: 11, marginBottom: 2 }}>
        {label}
      </div>
      <div className={mono ? 'mono' : undefined} style={{ fontSize: 12, ...valueStyle }}>
        {value}
      </div>
    </div>
  );
}
