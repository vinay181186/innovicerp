// The Multi-Level BOM detail page's Cost tab (ADR-225 phase 6): GET
// /ml-boms/:id/cost?qty= — a StatStrip of the totals, a warning when rows have
// no rate, then the tree indented by depth exactly as the Tree tab. Money is
// right-aligned, ₹ with 2 decimals (inrFormat, as every money column).

import {
  BOM_LINE_TYPE_LABEL,
  ML_BOM_RATE_SOURCE_LABEL,
  type MlBomCostResponse,
  type MlBomCostRow,
} from '@innovic/shared';
import { ApiError } from '@/lib/api';
import { inrFormat } from '@/lib/print/doc-print';
import { DataTable, type DataTableColumn, StatStrip } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { PageState } from '@/ui/layout';
import { sheetQty } from '../lib/ml-sheet-print';

const dash = <span className="text3">—</span>;

/** THE money format of this tab: numeric string → ₹1,23,456.00; null when
 *  there is no figure. */
const inr = (v: string | null): string | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? `₹${inrFormat(n)}` : null;
};

const moneyCol = (
  header: string,
  pick: (r: MlBomCostRow) => string | null,
  strong = false,
): DataTableColumn<MlBomCostRow> => ({
  header,
  align: 'right',
  nowrap: true,
  className: strong ? 'mono fw-700' : 'mono',
  render: (r) => inr(pick(r)) ?? dash,
});

const COLUMNS: DataTableColumn<MlBomCostRow>[] = [
  { header: 'Level', align: 'right', className: 'mono', render: (r) => r.depth },
  {
    header: 'Item Code',
    align: 'left',
    nowrap: true,
    render: (r) => (
      <span style={{ paddingLeft: r.depth * 18 }}>
        {r.depth > 0 ? <span className="text3">└ </span> : null}
        {r.itemCode ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {r.itemCode}
          </span>
        ) : (
          dash
        )}
      </span>
    ),
  },
  {
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    render: (r) => r.itemName ?? dash,
    title: (r) => r.itemName ?? '',
  },
  {
    header: 'Line Type',
    nowrap: true,
    render: (r) => (r.bomType ? BOM_LINE_TYPE_LABEL[r.bomType] : dash),
  },
  {
    header: 'Exploded Qty',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (r) => sheetQty(r.explodedQty),
  },
  moneyCol('Material Rate', (r) => r.materialRate),
  moneyCol('Operation Rate', (r) => r.operationRate),
  moneyCol('Unit Cost', (r) => r.unitCost),
  moneyCol('Amount', (r) => r.amount, true),
  {
    header: 'Rate Source',
    nowrap: true,
    render: (r) =>
      r.rateSource === 'none' ? (
        <span style={{ color: 'var(--amber2)' }}>{ML_BOM_RATE_SOURCE_LABEL.none}</span>
      ) : (
        ML_BOM_RATE_SOURCE_LABEL[r.rateSource]
      ),
  },
  {
    header: 'Rate Ref',
    nowrap: true,
    className: 'mono',
    render: (r) => r.rateRef ?? dash,
  },
];

interface CostTabProps {
  cost: MlBomCostResponse | undefined;
  loading: boolean;
  error: Error | null;
}

export function MlBomCostTab({ cost, loading, error }: CostTabProps): React.JSX.Element {
  if (error) {
    const noAccess = error instanceof ApiError && error.status === 403;
    return (
      <PageState
        as="inline"
        state={noAccess ? 'noaccess' : 'error'}
        message={noAccess ? 'No access to prices.' : error.message}
      />
    );
  }
  const noRate = cost?.noRateCount ?? 0;
  return (
    <div>
      {cost ? (
        <div style={{ padding: 'var(--sp-2) var(--sp-3) 0' }}>
          <StatStrip
            items={[
              { key: 'total', label: 'Total Cost', count: inr(cost.totalCost) ?? '—' },
              { key: 'material', label: 'Material', count: inr(cost.materialCost) ?? '—' },
              { key: 'operations', label: 'Operations', count: inr(cost.operationCost) ?? '—' },
              {
                key: 'no-rate',
                label: 'No Rate',
                count: noRate,
                color: noRate > 0 ? 'var(--amber)' : undefined,
              },
            ]}
          />
          {noRate > 0 ? (
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <Banner tone="warn" flush>
                {noRate === 1
                  ? '1 row has no rate — Total Cost is a floor.'
                  : `${noRate} rows have no rate — Total Cost is a floor.`}
              </Banner>
            </div>
          ) : null}
        </div>
      ) : null}
      <DataTable
        columns={COLUMNS}
        rows={cost?.rows ?? []}
        rowKey={(r) => r.key}
        loading={loading && !cost}
        density="compact"
        autoWidth
        emptyText="No lines."
      />
    </div>
  );
}
