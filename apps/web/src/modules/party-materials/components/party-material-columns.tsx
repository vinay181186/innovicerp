// Columns + ▸ detail for the Customer Material master sheet (ADR-199 table
// standard, 2026-10-01). The master table runs on the shared FIT <DataTable>.
//
// Main columns: Sr No · Customer RM · (Created On, hidden) · Name · UOM · Customer · In Stock ·
// Issued. The ▸ detail row carries the fields the master line does not show:
// Description, Grade, Recorded By / On — plus Total Received and Returned, kept
// here so the conversion drops no data the old wide table used to show.
//
// Sort & Filter runs on the SERVER (ADR-200): `sortFilterField` names the field
// in api party-materials/sf-columns.ts.

import type { PartyMaterialListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import { createdOnColumn, srNoColumn } from '@/ui/data/lead-columns';

/** Columns off by default (DataTable `defaultHidden`); Columns ▾ shows them. */
export const PARTY_MATERIAL_HIDDEN_COLUMNS = ['created_on'] as const;

/** Sr No (owner 2026-11-15; `firstRowNo` = server offset + 1 so it continues
 *  across pages), then the six master columns, with Created On (off by
 *  default) right after Customer RM. */
export function partyMaterialColumns(firstRowNo: number): DataTableColumn<PartyMaterialListItem>[] {
  return [
    srNoColumn<PartyMaterialListItem>(firstRowNo),
    {
      id: 'code',
      sortFilterField: 'code',
      header: 'Customer RM',
      kind: 'code',
      nowrap: true,
      // The `<item>-RM` item code, never the PM-#### register code (owner 2026-11-17);
      // `code` only for a legacy row with no RM item.
      render: (pm) => (
        <span className="td-code" style={{ color: 'var(--text)' }}>
          {pm.itemCode ?? pm.itemCodeText ?? pm.code}
        </span>
      ),
    },
    // When the material was recorded (IST day, time under it). Off by default
    // (PARTY_MATERIAL_HIDDEN_COLUMNS); Columns ▾ shows it.
    createdOnColumn<PartyMaterialListItem>((pm) => pm.createdAt, {
      sortFilterField: 'createdOn',
    }),
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
          style={{
            fontSize: 'var(--fs-sm)',
            color: pm.stockQty > 0 ? 'var(--green)' : 'var(--text3)',
          }}
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
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-0)' }}>
        {label}
      </div>
      <div
        className={mono ? 'mono' : undefined}
        style={{ fontSize: 'var(--fs-sm)', ...valueStyle }}
      >
        {value}
      </div>
    </div>
  );
}
