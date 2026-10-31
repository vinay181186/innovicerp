// ADR-252 Dossier — right pane with the ORDER selected: one row per POL, one
// column per report seen on the order (✓ n / missing / ⏳ / — not a step).
// A row click opens that POL.

import type { QcDossierFolder, QcDossierLine, QcDossierResponse } from '@innovic/shared';
import { useMemo } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { Badge } from '@/ui/core';
import { DataTable, dynamicColumns, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { folderFiles, onlyOptionalMissing } from './dossier-model';
import { polLabel } from './dossier-tree';

/** Report names in the order they first appear on the order's lines. */
export function reportColumns(lines: QcDossierLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const f of l.folders) {
      if ((f.isStep || folderFiles(f).length > 0) && !out.includes(f.reportName)) {
        out.push(f.reportName);
      }
    }
  }
  return out;
}

function ReportCell({ folder }: { folder: QcDossierFolder | undefined }): React.JSX.Element {
  const n = folder ? folderFiles(folder).length : 0;
  if (!folder || (!folder.isStep && n === 0)) {
    return <span className="text3">— not a step</span>;
  }
  if (folder.state === 'report_missing' && onlyOptionalMissing([folder])) {
    return (
      <Badge tone="orange" className="qd-chip" title="Report not uploaded (optional)">
        {n > 0 ? `${n} · optional` : 'optional'}
      </Badge>
    );
  }
  if (folder.state === 'report_missing') {
    return (
      <Badge tone="red" className="qd-chip">
        {n > 0 ? `${n} · missing` : 'missing'}
      </Badge>
    );
  }
  if (folder.state === 'qc_not_done' && n === 0) {
    return (
      <Badge tone="grey" className="qd-chip" title="QC not done yet">
        ⏳
      </Badge>
    );
  }
  return (
    <Badge tone={n > 0 ? 'green' : 'grey'} className="qd-chip">
      {n > 0 ? `✓ ${n}` : '0'}
    </Badge>
  );
}

export function DossierSummary({
  dossier,
  lines,
  onOpenLine,
}: {
  dossier: QcDossierResponse;
  lines: QcDossierLine[];
  onOpenLine: (lineId: string) => void;
}): React.JSX.Element {
  const { order } = dossier;
  const reports = useMemo(() => reportColumns(dossier.lines), [dossier.lines]);
  const columns = useMemo<DataTableColumn<QcDossierLine>[]>(
    () => [
      {
        id: 'pol',
        header: 'POL',
        nowrap: true,
        className: 'mono fw-700',
        render: (l) => polLabel(l),
      },
      {
        id: 'item_code',
        kind: 'code',
        header: 'Item Code',
        nowrap: true,
        className: 'td-code mono fw-700',
        render: (l) => itemCodeWithRev(l.itemCode, l.itemRevision),
      },
      {
        id: 'item_name',
        header: 'Item Name',
        align: 'left',
        ellipsis: true,
        render: (l) => l.itemName ?? '',
        title: (l) => l.itemName ?? '',
      },
      {
        id: 'order_qty',
        kind: 'num',
        header: 'Order Qty',
        align: 'right',
        className: 'mono',
        render: (l) => l.orderQty,
      },
      ...dynamicColumns<string, QcDossierLine>('report', reports, (name) => ({
        idSeed: name,
        header: name,
        kind: 'badge',
        nowrap: true,
        render: (l) => <ReportCell folder={l.folders.find((f) => f.reportName === name)} />,
      })),
      {
        id: 'files',
        kind: 'num',
        header: 'Files',
        align: 'right',
        className: 'mono',
        render: (l) => l.fileCount,
      },
    ],
    [reports],
  );

  return (
    <>
      <div className="qd-head">
        <span className="qd-t qd-code">{soNoWithInternal(order.code, order.internalSoNo)}</span>
        {order.customerName ? (
          <span className="qd-kv">
            Customer <b>{order.customerName}</b>
          </span>
        ) : null}
        {order.clientPoNo ? (
          <span className="qd-kv">
            Client PO No. <b>{order.clientPoNo}</b>
          </span>
        ) : null}
      </div>
      <DataTable
        tableKey={TABLE_KEYS.qcDocsDossier}
        columns={columns}
        rows={lines}
        rowKey={(l) => l.lineId}
        sortFilter={false}
        emptyText={dossier.lines.length === 0 ? 'No lines on this order.' : 'No POL matches.'}
        onRowClick={(l) => onOpenLine(l.lineId)}
      />
    </>
  );
}
