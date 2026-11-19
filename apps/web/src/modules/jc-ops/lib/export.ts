// ADR-310 — the JC Operations list's shared Export (copies the JWSO pilot).
//
// One sheet "JC Operations": the board's own columns as the user sees them
// (Columns ▾ defaults JC_OPS_DEFAULT_HIDDEN). The op-status chip, the
// outsource status (chip + PR / PO ref) and the "1.5h" pending hours get a
// plain `exportValue`. No Lines sheet — every row already is one operation.

import type { JcOpsBoardRow, ListJcOpsBoardQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { OP_STATUS } from '../../job-cards/lib/jc-op-labels';
import { fetchJcOpsBoardPage } from '../api';
import {
  JC_OPS_DEFAULT_HIDDEN,
  OUTSOURCE_STATUS_LABELS,
  isOutsource,
  outsourceStatusOf,
} from '../components/jc-ops-columns';

function outsourceWords(o: JcOpsBoardRow): string | null {
  if (!isOutsource(o)) return null;
  const st = outsourceStatusOf(o);
  const label = OUTSOURCE_STATUS_LABELS[st] ?? st.replace(/_/g, ' ');
  if (st === 'pr_raised' && o.outsourcePrCode) return `${label} · ${o.outsourcePrCode}`;
  if (st === 'po_created' && o.outsourcePoCode) return `${label} · ${o.outsourcePoCode}`;
  if (st === 'sent') return `${label} (${o.sentQty} pcs)`;
  return label;
}

export function withJcOpsExportValues(
  columns: DataTableColumn<JcOpsBoardRow>[],
): DataTableColumn<JcOpsBoardRow>[] {
  const values: Record<string, (o: JcOpsBoardRow) => string | number | null> = {
    op_status: (o) => OP_STATUS[o.status.toLowerCase()]?.label ?? o.status.replace(/_/g, ' '),
    outsource_status: outsourceWords,
    pending_hrs: (o) => Number(o.pendingHrs.toFixed(1)),
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface JcOpsExportArgs {
  columns: DataTableColumn<JcOpsBoardRow>[];
  tableKey: string;
  jcCode: string | undefined;
  search: string | undefined;
  sfParam: string | undefined;
}

export function jcOpsExportSpec(a: JcOpsExportArgs): ListExportSpec<JcOpsBoardRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.jcCode ? `JC No. ${a.jcCode}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListJcOpsBoardQuery, 'limit' | 'offset'> = {
    jcCode: a.jcCode,
    search: a.search,
    sf: a.sfParam,
  };
  return {
    fileName: 'JC Operations',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: JC_OPS_DEFAULT_HIDDEN,
    rowKey: (o) => o.jcOpId,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchJcOpsBoardPage({ ...base, limit, offset }),
  };
}
