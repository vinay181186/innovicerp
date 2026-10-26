// SO Master ⋯ → Preview. The order's header (as on the SO detail page) and,
// per line, every document number with its status — "Pending" where none yet —
// with 🖨 Print · ⬇ Download PDF · Open full detail →. Both fetches run only
// while the box is open. The screen and the print are drawn from ONE model
// (lib/print-so-preview.ts) so they always agree. No money is shown.

import type { SalesOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Download, Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { asDownload } from '@/lib/print/preview-host';
import { soNoWithInternal } from '@/lib/so-number';
import { useLevelMatrix } from '@/modules/flow-views/api';
import { useMyCompany } from '@/modules/settings/api';
import { StatusBadge } from '@/ui/core';
import { Modal } from '@/ui/feedback';
import { ReadField, ReadGrid } from '@/ui/layout';
import { useSalesOrder } from '../api';
import {
  NOTHING_YET_LABELS,
  buildPreviewHeader,
  buildPreviewLines,
  printSoPreview,
  type PreviewDoc,
  type PreviewLine,
  type PreviewRow,
} from '../lib/print-so-preview';

const LINK_STYLE: React.CSSProperties = { color: 'var(--cyan)', textDecoration: 'none' };
const LINK_CLASS = 'mono fw-700';

function DocLink({ d }: { d: PreviewDoc }): React.JSX.Element {
  const p = { params: { id: d.id }, className: LINK_CLASS, style: LINK_STYLE };
  switch (d.kind) {
    case 'route-card':
      return (
        <Link to="/route-cards/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'plan':
      return (
        <Link to="/plans/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'pro':
      return (
        <Link to="/production-orders/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'jc':
      return (
        <Link to="/job-cards/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'pr':
      return (
        <Link to="/purchase-requests/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'po':
      return (
        <Link to="/purchase-orders/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'dc':
      return (
        <Link to="/delivery-challans/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'grn':
      return (
        <Link to="/goods-receipt-notes/$id" {...p}>
          {d.code}
        </Link>
      );
    case 'dispatch':
      return (
        <Link to="/customer-dispatches/$id" {...p}>
          {d.code}
        </Link>
      );
    default:
      return (
        <Link to="/invoices/$id" {...p}>
          {d.code}
        </Link>
      );
  }
}

const Pending = (): React.JSX.Element => <span className="text3">Pending</span>;

function DocChip({ d }: { d: PreviewDoc }): React.JSX.Element {
  return (
    <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {d.arrow ? <span className="text3">→</span> : null}
      {d.tag ? <span className="text3">{d.tag}</span> : null}
      <DocLink d={d} />
      {d.itemCode ? (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {d.itemCode}
        </span>
      ) : null}
      {d.statusLabel ? (
        <StatusBadge kind={d.badgeKind} status={d.status} label={d.statusLabel} />
      ) : null}
      {d.note ? <span className="mono text2">{d.note}</span> : null}
    </span>
  );
}

function RowLine({ r }: { r: PreviewRow }): React.JSX.Element {
  const proWithoutJc =
    r.label === 'PRO' && r.docs.length > 0 && !r.docs.some((d) => d.kind === 'jc');
  return (
    <>
      <span className="text3 fw-700" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
        {r.label}
      </span>
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 14px', minWidth: 0 }}>
        {r.docs.length === 0 ? (
          <Pending />
        ) : (
          r.docs.map((d) => <DocChip key={`${d.kind}-${d.id}`} d={d} />)
        )}
        {proWithoutJc ? (
          <span style={{ whiteSpace: 'nowrap' }}>
            <span className="text3">→ JC</span> <Pending />
          </span>
        ) : null}
      </span>
    </>
  );
}

function LineBlock({ l }: { l: PreviewLine }): React.JSX.Element {
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 'var(--sp-2) 0' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '2px 8px',
          alignItems: 'center',
          fontSize: 'var(--fs-sm)',
          marginBottom: 'var(--sp-1)',
        }}
      >
        <span className="mono" style={{ color: 'var(--blue)' }}>
          Ln {l.lineNo}
        </span>
        <span className="text3">·</span>
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          POL {l.pol ?? '—'}
        </span>
        <span className="text3">·</span>
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {l.itemCode}
        </span>
        <span
          className="text3"
          title={l.partName}
          style={{
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {l.partName}
        </span>
        <span className="text3">·</span>
        <span className="mono">Order {l.orderQty}</span>
        <span className="text3">·</span>
        <span className="mono" style={{ color: 'var(--green2)' }}>
          Disp {l.dispatchedQty}
        </span>
        <span className="text3">·</span>
        <span className="mono">Billed {l.billedQty}</span>
        <StatusBadge kind={l.statusKind} status={l.status} label={l.statusLabel} />
      </div>
      {l.nothingYet ? (
        <div style={{ paddingLeft: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
          {NOTHING_YET_LABELS.map((x, i) => (
            <span key={x}>
              {i > 0 ? <span className="text3"> · </span> : null}
              <span className="text3 fw-700">{x}</span> <Pending />
            </span>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            gap: '4px var(--sp-3)',
            alignItems: 'center',
            paddingLeft: 'var(--sp-3)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {l.rows.map((r, i) => (
            <RowLine key={`${r.label}-${i}`} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SoPreviewModal({
  so,
  onClose,
}: {
  so: SalesOrderListItem;
  onClose: () => void;
}): React.JSX.Element {
  const detailQ = useSalesOrder(so.id);
  const matrixQ = useLevelMatrix(so.id, true);
  const { data: company } = useMyCompany();
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const header = useMemo(
    () => (detailQ.data ? buildPreviewHeader(detailQ.data) : null),
    [detailQ.data],
  );
  const lines = useMemo(
    () => (detailQ.data && matrixQ.data ? buildPreviewLines(detailQ.data, matrixQ.data) : null),
    [detailQ.data, matrixQ.data],
  );
  const ready = header !== null && lines !== null;

  const print = (): boolean =>
    header && lines ? printSoPreview({ header, lines, company, soCode: so.code }) : false;
  const onPrint = (): void => {
    setErr(null);
    if (!print()) setErr('Could not open the print. Try again.');
  };
  const onDownload = (): void => {
    setErr(null);
    setDownloading(true);
    asDownload(print)
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : 'Could not download the PDF. Try again.'),
      )
      .finally(() => setDownloading(false));
  };

  const loadError = detailQ.error ?? matrixQ.error;

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title={
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <span className="mono fw-700">{soNoWithInternal(so.code, so.internalSoNo)}</span>
          <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
            SO Status
          </span>
          <StatusBadge kind="so" status={header?.status ?? so.status} />
        </span>
      }
      footer={
        <>
          {err ? (
            <span style={{ color: 'var(--red2)', fontSize: 'var(--fs-sm)', marginRight: 'auto' }}>
              {err}
            </span>
          ) : null}
          <Link
            to="/sales-orders/$id"
            params={{ id: so.id }}
            className="btn btn-ghost"
            onClick={onClose}
          >
            Open full detail →
          </Link>
          <button type="button" className="btn btn-ghost" disabled={!ready} onClick={onPrint}>
            <Printer className="inline h-3 w-3" /> Print
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!ready || downloading}
            onClick={onDownload}
          >
            {downloading ? (
              <Loader2 className="inline h-3 w-3 animate-spin" />
            ) : (
              <Download className="inline h-3 w-3" />
            )}{' '}
            Download PDF
          </button>
        </>
      }
    >
      {loadError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {loadError instanceof Error ? loadError.message : 'Could not load this SO. Try again.'}
        </div>
      ) : !ready ? (
        <div style={{ padding: 'var(--sp-3)', fontSize: 'var(--fs-sm)', color: 'var(--text3)' }}>
          <Loader2 size={12} className="inline animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <ReadGrid cols={3}>
            <ReadField label="Customer" size="lg" value={header.customer} />
            <ReadField
              label="Client PO No."
              size="sm"
              mono
              value={
                header.clientPoNo ? (
                  <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                    {header.clientPoNo}
                  </span>
                ) : null
              }
            />
            <ReadField label="SO Date" size="sm" mono value={fmtDate(header.soDate)} />
            <ReadField label="Due Date" size="sm" mono value={fmtDate(header.dueDate)} />
            <ReadField label="SO Type" size="md" value={header.type} />
            <ReadField label="Raised By" size="md" value={header.raisedBy} />
          </ReadGrid>
          <div style={{ margin: 'var(--sp-2) 0 var(--sp-3)' }}>
            <ReadField label="SO Remarks" size="full" pre value={header.remarks} />
          </div>
          {lines.length === 0 ? (
            <div className="empty-state">No lines on this SO yet.</div>
          ) : (
            lines.map((l) => <LineBlock key={l.id} l={l} />)
          )}
        </>
      )}
    </Modal>
  );
}
