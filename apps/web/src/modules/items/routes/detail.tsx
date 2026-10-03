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
//  - The detail grid carries itemType / hsnCode / description, which legacy's
//    modal has no counterpart for. Kept — dropping live fields to reach parity
//    would lose working behaviour.
//  - NO Revision, Drawing no. or Drawing File (user decision 2026-09-21, plan
//    v3 Step 4 #7): all three belong to the SO / JWSO line, not the item. The
//    old item columns stay in the DB with their data; no screen shows them.
//  - The header is the shared <ItemBadge> at its 96 px size: product image
//    (3D render), code, name. Click the picture to see it large.
//
// Legacy sections with no data source in the port (reported, NOT stubbed):
// the drawing thumbnail (L11775), the 4-tile stat grid (L11777-11798), the
// Route Card table (L11799-11802) and Job Card History (L11803-11806) all need
// route-card / job-card / running-op reads this page does not have.

import {
  ITEM_PROCUREMENT_TYPE_LABEL,
  type DocumentEditChange,
  type Item,
  itemTypeLabel,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Package, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { DocumentHistory } from '@/components/shared/document-history';
import { ItemBadge } from '@/components/shared/item-badge';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useItemBalance, useStoreTransactionsList } from '@/modules/store-transactions/api';
import { TxnTypeBadge } from '@/modules/store-transactions/components/txn-type-badge';
import { STORE_TXN_SOURCE_LABELS } from '@/modules/store-transactions/lib/txn-labels';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItem, useSoftDeleteItem } from '../api';
import { TrashReasonDialog } from '../components/trash-reason-dialog';

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
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'item_create');
  const softDelete = useSoftDeleteItem();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // ADR-202 — the edit(s) staged against this item and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('Item', item?.id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Items. Ask an admin.
      </div>
    );
  }

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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Item not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  // mutateAsync: ConfirmDialog keeps its buttons disabled while this runs and
  // shows a rejection in the dialog instead of closing it.
  const onDelete = async (reason: string): Promise<void> => {
    await softDelete.mutateAsync({ id: item.id, reason });
    setConfirmDelete(false);
    await navigate({ to: '/items', replace: true });
  };

  // Tier-driven, per department (Store). Was admin/manager for Edit and
  // admin-only for Delete.
  const canEdit = perms.edit;
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve. L3 has
  // edit without approve; L4 has approve without edit. Admin-only was locking
  // out the tier meant to run the department.
  const canDelete = perms.edit && perms.approve;
  // "Raise PR" opens a new Purchase Request for this item — gated on the PR's
  // own entry right, the same gate /purchase-requests/new enforces.
  const canRaisePr = effectiveFormPerms(eff, 'pr_create').entry;

  return (
    <div>
      <Link to="/items" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Item Master
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          {/* Bare code — an item has no revision of its own (see header). */}
          <ItemBadge
            size="page"
            code={item.code}
            name={item.name}
            imagePath={item.imagePath}
            codeColor="var(--text)"
          >
            <div
              style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
            >
              <OnHandBadge itemId={item.id} />
              {/* ADR-202 — staged change to the item name, shown by the item name. */}
              <Chip changes={pendingChanges} field="name" />
            </div>
          </ItemBadge>
          <div style={{ display: 'flex', gap: 6 }}>
            {canRaisePr ? (
              <Link
                to="/purchase-requests/new"
                search={{ itemId: item.id }}
                className="btn btn-primary btn-sm"
                title="Raise a Purchase Request for this item"
              >
                Raise PR
              </Link>
            ) : null}
            {canEdit ? (
              <Link to="/items/$id/edit" params={{ id: item.id }} className="btn btn-ghost btn-sm">
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} /> Delete
              </button>
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          <DetailGrid item={item} pendingChanges={pendingChanges} />
        </div>
      </div>

      <StockHistoryCard itemId={item.id} />

      {/* ADR-197 — who created / edited / deleted this item, with Before → After. */}
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">History</div>
        </div>
        <DocumentHistory entity="Item" entityId={item.id} refId={item.code} />
      </div>

      {confirmDelete ? (
        <TrashReasonDialog
          title={`Move Item ${item.code} to Trash?`}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
      {/* Open PRs, POs and GRNs for this item (ADR-190). Hides when empty. */}
      <RelatedDocsPanel module="items" id={item.id} />
    </div>
  );
}

function OnHandBadge(props: { itemId: string }): React.JSX.Element {
  const { data, isLoading, isError } = useItemBalance(props.itemId);
  if (isLoading) {
    return (
      <span className="badge b-grey" title="Loading stock…">
        <Loader2 size={11} className="animate-spin" style={{ marginRight: 4 }} /> stock…
      </span>
    );
  }
  if (isError) {
    return (
      <span className="badge b-grey" title="You do not have access to store stock">
        <Package size={11} style={{ marginRight: 4 }} /> stock not shown
      </span>
    );
  }
  const onHand = data?.onHand ?? 0;
  return (
    <span
      className={`badge ${onHand > 0 ? 'b-green' : 'b-grey'}`}
      title="Physical: stock on the shelf now"
    >
      <Package size={11} style={{ marginRight: 4 }} />
      Physical:{' '}
      <span className="mono" style={{ marginLeft: 4 }}>
        {onHand}
      </span>
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
        <Link to="/store-inventory" className="btn btn-ghost btn-sm">
          View full ledger →
        </Link>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Movement Date</th>
              <th>Movement Type</th>
              <th>Source</th>
              <th>Ref No.</th>
              <th className="th-num">Movement Qty</th>
              <th className="th-num">Stock Before → After</th>
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
                <td colSpan={7} className="empty-state" style={{ color: 'var(--red2)' }}>
                  Could not load stock history. Try again.
                </td>
              </tr>
            ) : (data?.items.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  No stock movements yet.
                </td>
              </tr>
            ) : (
              data!.items.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {fmtDate(r.txnDate)}
                  </td>
                  <td>
                    <TxnTypeBadge type={r.txnType} />
                  </td>
                  <td className="text2" style={{ fontSize: 11 }}>
                    {STORE_TXN_SOURCE_LABELS[r.sourceType]}
                  </td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
                    {r.sourceRef}
                  </td>
                  {/* Same +/− colours as the Stock Ledger tab. */}
                  <td
                    className="mono fw-700 td-num"
                    style={
                      r.txnType === 'in'
                        ? { color: 'var(--green2)' }
                        : r.txnType === 'out'
                          ? { color: 'var(--red2)' }
                          : undefined
                    }
                  >
                    {r.txnType === 'in' ? '+' : r.txnType === 'out' ? '-' : ''}
                    {r.qty}
                  </td>
                  <td className="mono td-num" style={{ fontSize: 11 }}>
                    {r.stockBefore} → <b>{r.stockAfter}</b>
                  </td>
                  <td className="text3" style={{ fontSize: 11 }}>
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

function DetailGrid(props: {
  item: Item;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { item, pendingChanges } = props;
  return (
    <div className="form-grid">
      <Pair
        label="Item Type"
        value={itemTypeLabel(item.itemType)}
        chip={<Chip changes={pendingChanges} field="itemType" />}
      />
      <div className="form-grp">
        <span className="form-label">Make / Buy</span>
        <div>
          <span className={`badge ${item.procurementType === 'buy' ? 'b-blue' : 'b-grey'}`}>
            {ITEM_PROCUREMENT_TYPE_LABEL[item.procurementType]}
          </span>
          <Chip changes={pendingChanges} field="procurementType" />
        </div>
      </div>
      <Pair label="UOM" value={item.uom} chip={<Chip changes={pendingChanges} field="uom" />} />
      <Pair
        label="Material"
        value={item.material ?? '—'}
        chip={<Chip changes={pendingChanges} field="material" />}
      />
      <Pair
        label="HSN Code"
        value={item.hsnCode ?? '—'}
        chip={<Chip changes={pendingChanges} field="hsnCode" />}
      />
      <div className="form-grp form-full">
        <span className="form-label">Description</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {item.description ?? '—'}
          <Chip changes={pendingChanges} field="description" />
        </div>
      </div>
    </div>
  );
}

function Pair(props: {
  label: string;
  value: string;
  chip?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>
        {props.value}
        {props.chip}
      </div>
    </div>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the Item edit diff's field key (ITEM_FIELDS).
 *  Renders nothing when no edit is pending for that field. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}
