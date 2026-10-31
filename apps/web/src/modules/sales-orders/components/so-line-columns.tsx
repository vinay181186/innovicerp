// SO detail's two fit tables (ADR-199): the line items and the delivery
// schedule. Moved out of routes/detail.tsx to keep that file from growing.
// ADR-261: the line table opens with the six lead columns (SO No. · Internal
// SO No. — the page's order — · POL · Created On · Item Code (CODE/REV) · Item
// Name), then Ln and Image; Drawing and SO Status draw their parts side by side.

import type { DrawingSource, SalesOrderDetail, SalesOrderLine, SoStatus } from '@innovic/shared';
import { ItemImageBox } from '@/components/shared/item-badge';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { ItemRevLink } from '@/modules/item-revisions/components/item-rev-link';
import { inrFormat } from '@/lib/print/doc-print';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { leadColumns, type DataTableColumn, type RowMenuItem } from '@/ui/data';
import { SO_STATUS_LABEL } from '../lib/so-status-label';
import { closableQty } from './so-close-modal';
import { SoLineShortClosedBadge } from './so-fulfilment-badge';

/** What the Drawing button asks the page to preview. */
export interface DrawingPreview {
  storagePath: string;
  kind: 'drawing';
  source: DrawingSource;
  refCode: string;
}

/* ── Line items ─────────────────────────────────────────────────────────────
   Built as a column list rather than hand-written <tr>/<td>, so the ruled
   sheet, the sticky header, the centring and the empty row all come from
   <DataTable>. Widths are % and sum to 100 — `table-layout: fixed` needs them
   to, and dropping the Rate column hands its share to the Item cell. */

export function lineColumns(opts: {
  priceHidden: boolean;
  /** Carried down only so the drawing access log reads "IN-SO-26-00521 L3"
   *  instead of a storage path nobody recognises. */
  soCode: string;
  /** ADR-207 — the order's Internal SO No. (lead column 2). */
  internalSoNo: string | null;
  onPreview: (file: DrawingPreview) => void;
}): DataTableColumn<SalesOrderLine>[] {
  const { priceHidden, soCode, internalSoNo, onPreview } = opts;
  return [
    ...leadColumns<SalesOrderLine>({
      soNo: () => soCode,
      internalSoNo: () => internalSoNo,
      pol: (l) => l.clientPoLineNo,
      createdOn: (l) => l.createdAt,
      itemCode: (l) => l.itemCode ?? l.itemCodeText,
      itemRev: (l) => l.revision,
      itemName: (l) => l.partName,
      overrides: {
        // ABC/1 links to its drawing page once the line is in the Item +
        // Drawing Rev register (itemRevisionId); plain text otherwise.
        item_code: {
          render: (l) => (
            <ItemRevLink
              itemRevisionId={l.itemRevisionId}
              label={itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.revision)}
              className=""
            />
          ),
          filterValue: (l) => itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.revision),
        },
        item_name: {
          title: (l) =>
            masterNote(l.partName, l.masterItemName)
              ? `${l.partName ?? ''} — Master: ${l.masterItemName ?? ''}`
              : (l.partName ?? ''),
          render: (l) => {
            const master = masterNote(l.partName, l.masterItemName);
            return (
              <>
                {l.partName ?? '—'}
                {/* The Item Master's own name, as a grey note BESIDE the
                    line's Item Name (NAMING.md) — only when the two differ. */}
                {master ? <span className="text3"> · Master: {master}</span> : null}
              </>
            );
          },
        },
      },
    }),
    {
      id: 'line_no',
      header: 'Ln',
      width: '4%',
      className: 'mono',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--blue)' }}>{l.lineNo}</span>,
    },
    // Image after the lead block (ADR-261). The Rev is the customer's drawing
    // revision, typed on this line; it rides in the Item Code cell (CODE/REV).
    {
      id: 'image',
      header: 'Image',
      minWidth: 48,
      render: (l) => (
        <div
          style={{
            position: 'relative',
            height: 'calc(var(--tbl-row-h, 28px) - 1px)',
            margin: '0 calc(var(--tbl-pad-x, var(--sp-2)) * -1)',
          }}
        >
          <ItemImageBox
            imagePath={l.itemImagePath}
            size="row"
            alt={l.partName ?? l.itemCode ?? l.itemCodeText ?? ''}
            fill
          />
        </div>
      ),
    },
    {
      id: 'material',
      header: 'Material',
      width: '6%',
      className: 'text3',
      ellipsis: true,
      render: (l) => l.material ?? '—',
      title: (l) => l.material ?? '',
    },
    {
      id: 'drawing',
      header: 'Drawing',
      width: '8%',
      className: 'mono',
      render: (l) => {
        const drawingFilePath = l.drawingFilePath ?? null;
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--sp-1)',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{l.drawingNo ?? '—'}</span>
            {/* No Rev line here any more. It is the same value the Item Code cell
              now carries as CODE/REV, and printing one fact twice in one row
              reads as two facts that might disagree. */}
            {drawingFilePath ? (
              <Button
                variant="ghost"
                size="sm"
                title="Preview drawing"
                icon={<Icon name="paperclip" size={11} />}
                style={{ alignSelf: 'center' }}
                onClick={() =>
                  onPreview({
                    storagePath: drawingFilePath,
                    kind: 'drawing',
                    source: 'so_line',
                    refCode: `${soCode} L${l.lineNo}`,
                  })
                }
              >
                Drawing
              </Button>
            ) : null}
          </span>
        );
      },
    },
    {
      header: 'Order Qty',
      key: 'orderQty',
      width: '6%',
      align: 'right',
      className: 'mono',
      nowrap: true,
    },
    {
      id: 'dispatched_qty',
      header: 'Dispatched',
      align: 'right',
      width: '7%',
      headColor: 'var(--green)',
      className: 'mono',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--green2)' }}>{l.dispatchedQty}</span>,
    },
    {
      id: 'billed_qty',
      header: 'Billed',
      align: 'right',
      width: '6%',
      headColor: 'var(--green)',
      className: 'mono',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--green2)' }}>{l.billedQty}</span>,
    },
    {
      // Order − Billed: still to invoice (NAMING.md "To Bill"), not the
      // qty still owed on the order ("Pending"). A line closed short
      // (ADR-196) will ship nothing more, so only its dispatched qty is left
      // to bill.
      id: 'to_bill_qty',
      header: 'To Bill',
      align: 'right',
      width: '7%',
      headColor: 'var(--red)',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => {
        const toBill = Math.max(0, (l.shortClosedAt ? l.dispatchedQty : l.orderQty) - l.billedQty);
        return <span style={{ color: toBill > 0 ? 'var(--red)' : 'var(--green)' }}>{toBill}</span>;
      },
    },
    { header: 'UOM', key: 'uom', width: '5%', nowrap: true },
    ...(priceHidden
      ? []
      : [
          {
            id: 'rate',
            header: 'Rate',
            width: '7%',
            align: 'right' as const,
            className: 'mono',
            nowrap: true,
            render: (l: SalesOrderLine) =>
              Number(l.rate) > 0 ? `₹ ${inrFormat(Number(l.rate))}` : '—',
          },
        ]),
    {
      id: 'due_date',
      kind: 'date',
      header: 'Due Date',
      width: '8%',
      className: 'mono text2',
      nowrap: true,
      render: (l) => fmtDate(l.dueDate),
    },
    {
      // ADR-236: the LINE's own note (the order's note is "SO Remarks" above).
      // Long prose: one line, cut with "…", the full text on hover.
      id: 'remarks',
      header: 'Remarks',
      width: '6%',
      align: 'left',
      ellipsis: true,
      render: (l) => l.remarks ?? '—',
      title: (l) => l.remarks ?? '',
    },
    {
      id: 'status',
      kind: 'badge',
      header: 'SO Status',
      width: '8%',
      render: (l) => (
        // One line (ADR-199): status and closed-short chip side by side.
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            whiteSpace: 'nowrap',
          }}
        >
          <StatusBadge kind="so" status={l.status} label={SO_STATUS_LABEL[l.status]} />
          {/* ADR-196 — closed short: the undelivered qty was dropped. */}
          <SoLineShortClosedBadge
            shortClosedAt={l.shortClosedAt}
            shortCloseReason={l.shortCloseReason}
          />
        </span>
      ),
    },
  ];
}

/**
 * ADR-196 — the line's ⋯ menu: "Close line" (closed short: the qty not yet
 * dispatched is dropped). Hidden without so_create advance + approve (ADR-231);
 * greyed with the reason the server would refuse it (SO status, line state).
 */
export function lineRowMenu(
  l: SalesOrderLine,
  opts: {
    /** so_create advance + approve. */
    canClose: boolean;
    soStatus: SoStatus;
    onCloseLine: (line: SalesOrderLine) => void;
  },
): RowMenuItem[] {
  const { canClose, soStatus, onCloseLine } = opts;
  const why =
    soStatus === 'draft'
      ? 'SO is draft'
      : soStatus === 'cancelled'
        ? 'SO is cancelled'
        : l.shortClosedAt
          ? 'Already Short Closed'
          : l.status === 'cancelled'
            ? 'Line cancelled'
            : closableQty(l) === 0
              ? 'Fully dispatched'
              : undefined;
  return [
    {
      key: 'close-line',
      label: 'Close line',
      icon: 'x',
      hidden: !canClose,
      disabledReason: why,
      onSelect: () => onCloseLine(l),
    },
  ];
}

/** The Item Master's name when it differs from the line's own Item Name. */
function masterNote(
  lineName: string | null | undefined,
  masterItemName: string | null | undefined,
): string | null {
  const master = masterItemName?.trim() ?? '';
  return master === '' || master === (lineName ?? '').trim() ? null : master;
}

/* ── Delivery schedule ─────────────────────────────────────────────────── */

type Milestone = SalesOrderDetail['milestones'][number];

export const MILESTONE_COLUMNS: DataTableColumn<Milestone>[] = [
  { header: 'Lot No.', key: 'lotNo', width: '18%', className: 'mono fw-700', nowrap: true },
  { header: 'Qty', key: 'qty', width: '14%', align: 'right', className: 'mono', nowrap: true },
  {
    id: 'due_date',
    kind: 'date',
    header: 'Due Date',
    width: '20%',
    className: 'mono',
    nowrap: true,
    render: (m) => fmtDate(m.dueDate),
  },
  {
    id: 'remarks',
    header: 'Remarks',
    width: '48%',
    align: 'left',
    ellipsis: true,
    render: (m) => m.remarks ?? '—',
    title: (m) => m.remarks ?? '',
  },
];
