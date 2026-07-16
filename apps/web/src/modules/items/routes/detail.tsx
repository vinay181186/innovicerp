// Item detail page (UI-003-01).
// Ports legacy viewItemDetail (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L11743-11811, incl. _stockLedgerHtml L11815-11833) to the Innovic .panel /
// .form-grid chrome. Legacy renders this as a modal (showModalLg L11810); the
// port is a route — same content, real URL.
//
// Legacy deltas kept deliberately:
//  - Stock Ledger keeps our Type badge + Source + Qty + "Stock before → after"
//    instead of legacy's Type / IN / OUT / Balance split. Legacy derives IN vs
//    OUT from `isIn = t.type==='IN'` (L11823), so anything not IN is rendered as
//    an outward move — our ledger has a third type (`adjust`) that this would
//    misreport. Legacy's Balance is a browser-side running total (L11821) which
//    would be wrong on a capped, newest-first list; stockBefore/stockAfter come
//    from the server per row, so we show those.
//  - Dates render as the raw ISO txnDate. Legacy's fmt() (L1484) is "15-Jul-26";
//    the shared fmtDate() is dd-MM-yyyy. Neither matches the other, so rather
//    than approximate we leave the sortable ISO value and log the divergence.
//  - The detail grid carries itemType / hsnCode / description / drawing-file
//    actions, which legacy's modal has no counterpart for. Kept — dropping live
//    fields to reach parity would lose working behaviour.
//
// Legacy sections with no data source in the port (reported, NOT stubbed):
// the drawing thumbnail (L11775), the 4-tile stat grid (L11777-11798), the
// Route Card table (L11799-11802) and Job Card History (L11803-11806) all need
// route-card / job-card / running-op reads this page does not have.

import type { Company, Item } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Package, Pencil, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { signedUrl } from '@/lib/storage';
import { useMyCompany } from '@/modules/settings/api';
import { useItemBalance, useStoreTransactionsList } from '@/modules/store-transactions/api';
import { TxnTypeBadge } from '@/modules/store-transactions/components/txn-type-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItem, useSoftDeleteItem } from '../api';
import { printItemDrawing } from '../lib/print-drawing';

// Rows pulled for the ledger sub-panel. The panel discloses the cap against the
// server's `total` whenever there are more (legacy lists every txn, L11816).
const LEDGER_LIMIT = 20;

export const itemDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items/$id',
  component: ItemDetailPage,
});

function ItemDetailPage(): React.JSX.Element {
  const { id } = itemDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, isError, error } = useItem(id);
  const { data: me } = useSession();
  const { data: company } = useMyCompany();
  const softDelete = useSoftDeleteItem();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading item…
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/items" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Item not found'}
          </div>
        </div>
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(item.id, {
      onSuccess: () => {
        void navigate({ to: '/items', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

  return (
    <div>
      <Link to="/items" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Item Master
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--purple)', fontSize: 16, fontWeight: 700 }}
            >
              {item.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {item.name}
              <OnHandBadge itemId={item.id} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canEdit ? (
              <Link
                to="/items/$id/edit"
                params={{ id: item.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {isAdmin ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
                    Delete?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={onDelete}
                    disabled={softDelete.isPending}
                  >
                    {softDelete.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={softDelete.isPending}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Failed to delete item.'}
            </div>
          ) : null}
          <DetailGrid item={item} company={company} />
        </div>
      </div>

      <StockHistoryCard itemId={item.id} />
    </div>
  );
}

function OnHandBadge(props: { itemId: string }): React.JSX.Element {
  const { data, isLoading } = useItemBalance(props.itemId);
  if (isLoading) {
    return (
      <span className="badge b-grey" title="Loading stock from v_item_stock">
        <Loader2 size={11} className="animate-spin" style={{ marginRight: 4 }} /> stock…
      </span>
    );
  }
  const onHand = data?.onHand ?? 0;
  return (
    <span
      className={`badge ${onHand > 0 ? 'b-green' : 'b-grey'}`}
      title="On-hand from v_item_stock — sum of in/out/adjust txns"
    >
      <Package size={11} style={{ marginRight: 4 }} />
      On hand: <span className="mono" style={{ marginLeft: 4 }}>{onHand}</span>
    </span>
  );
}

function StockHistoryCard(props: { itemId: string }): React.JSX.Element {
  const { data, isLoading, isError } = useStoreTransactionsList({
    itemId: props.itemId,
    limit: LEDGER_LIMIT,
    offset: 0,
  });
  // `total` is the server's count across the whole filter set (no LIMIT), so the
  // cap notice below is truthful without any browser-side counting.
  const total = data?.total ?? 0;
  const capped = total > LEDGER_LIMIT;
  return (
    <div className="panel">
      <div className="panel-hdr">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="panel-title">Stock Ledger</div>
          {capped ? (
            <span className="text3" style={{ fontSize: 11 }}>
              Showing latest {LEDGER_LIMIT} of {total}
            </span>
          ) : null}
        </div>
        <Link to="/store-transactions" className="btn btn-ghost btn-sm">
          View full ledger →
        </Link>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Source</th>
              <th>Ref No.</th>
              <th className="td-right">Qty</th>
              <th>Stock before → after</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading stock history…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={7} className="empty-state" style={{ color: 'var(--red)' }}>
                  Failed to load stock history.
                </td>
              </tr>
            ) : (data?.items.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  No stock transactions recorded
                </td>
              </tr>
            ) : (
              data!.items.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {r.txnDate}
                  </td>
                  <td>
                    <TxnTypeBadge type={r.txnType} />
                  </td>
                  <td className="text2" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    {r.sourceType.replaceAll('_', ' ')}
                  </td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
                    {r.sourceRef}
                  </td>
                  <td className="td-right mono fw-700">{r.qty}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {r.stockBefore} → <b>{r.stockAfter}</b>
                  </td>
                  <td className="text3" style={{ fontSize: 10 }}>
                    {r.remarks ?? ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailGrid(props: { item: Item; company: Company | undefined }): React.JSX.Element {
  const { item, company } = props;
  return (
    <div className="form-grid">
      <Pair label="Item type" value={item.itemType} />
      <Pair label="UOM" value={item.uom} />
      <Pair label="Revision" value={item.revision} />
      <Pair label="Drawing no." value={item.drawingNo ?? '—'} />
      <DrawingFilePair item={item} company={company} />
      <Pair label="Material" value={item.material ?? '—'} />
      <Pair label="HSN code" value={item.hsnCode ?? '—'} />
      <div className="form-grp form-full">
        <span className="form-label">Description</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{item.description ?? '—'}</div>
      </div>
    </div>
  );
}

function Pair(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}

function DrawingFilePair({
  item,
  company,
}: {
  item: Item;
  company: Company | undefined;
}): React.JSX.Element {
  const path = item.drawingFilePath;
  async function view(): Promise<void> {
    if (!path) return;
    try {
      const url = await signedUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not open file');
    }
  }
  async function print(): Promise<void> {
    if (!path) return;
    try {
      const ok = await printItemDrawing({ item, company });
      if (!ok) window.alert('Allow popups to print.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not open drawing for printing');
    }
  }
  return (
    <div className="form-grp">
      <span className="form-label">Drawing file</span>
      <div style={{ fontWeight: 600, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {path ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void view()}>
              📎 View drawing
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void print()}>
              <Printer size={13} /> Print drawing
            </button>
          </>
        ) : (
          '—'
        )}
      </div>
    </div>
  );
}
