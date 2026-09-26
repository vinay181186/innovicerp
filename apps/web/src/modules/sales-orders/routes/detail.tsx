// Sales Order detail (UI-003-05).
//
// THE REFERENCE DOCUMENT-DETAIL SCREEN. The other nine document details
// (purchase-orders, purchase-requests, job-work-orders, goods-receipt-notes,
// delivery-challans, bom-master, route-cards, plans, so-costing) copy this
// composition, which is the canonical one from design-ref/README.md:
//
//   DetailHeader (+ ReadGrid of ReadFields)
//     -> Panel(s)  — documents bar, line items as a DataTable, delivery schedule
//     -> RelatedDocs (+ Timeline)
//
// Nothing about the data, the permissions or the routes changed in the Phase-4
// migration: same `useSalesOrder`, same `so_create` access matrix, same
// soft-delete mutation, same preview modal, same POL and CODE/REV on every
// line. What changed is that this screen no longer draws its own panels,
// tables, badges, buttons, empty states or delete confirmation.

import type { DrawingSource, SalesOrderDetail, SalesOrderLine } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { AssignTaskModal } from '@/modules/tasks/components/task-modals';
import { uploadSoDocFile, useCreateSoDocument, useSoDocDetail } from '@/modules/so-documents/api';
import { ItemBadge } from '@/components/shared/item-badge';
import { useSession } from '@/lib/session';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { SoDocumentsSection } from '@/modules/so-documents/components/so-documents-section';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, QtyStrip, type DataTableColumn } from '@/ui/data';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { ActionMenu, DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { SoDrawingHistory, useSoDrawingHistory } from '../components/so-drawing-history';
import { salesOrdersKeys, useSalesOrder, useSoftDeleteSalesOrder } from '../api';
import { fmtIstDateTime } from '../lib/format';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';

/** ₹ with Indian grouping, to the paise — the SO totals strip. */
function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The file the user asked to look at, or null when nothing is open.
 *
 *  Every 📎 on this page used to `window.open` a signed URL, which let the
 *  browser decide — and Chrome's "download PDFs instead of opening them"
 *  setting turned a look into a silent save. Now the click only records WHICH
 *  file, and FilePreviewModal shows it inside the app; saving is a separate,
 *  deliberate press of the modal's own Download button.
 *
 *  Spread straight into the modal (`{...preview}`) so the optional keys stay
 *  absent rather than explicitly undefined (exactOptionalPropertyTypes). */
type PreviewFile = {
  storagePath: string;
  fileName?: string;
  fileType?: string | null;
  /** `drawing` for the per-line drawings: the server mints those links, logs
   *  every open, and hides Download from anyone without the tick. The client PO
   *  and the email references are ordinary files and leave this unset, so they
   *  keep the behaviour they have always had. */
  kind?: 'file' | 'drawing';
  source?: DrawingSource;
  refCode?: string;
};

export const salesOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id',
  component: SalesOrderDetailPage,
});

function SalesOrderDetailPage(): React.JSX.Element {
  const { id } = salesOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useSalesOrder(id);
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'so_create');
  const softDelete = useSoftDeleteSalesOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // One preview slot for the whole page — the client PO bar, the email
  // references and the per-line drawings all feed the same modal.
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  // Fetched HERE, not inside the tab, because the tab strip needs the count to
  // decide whether to show 📐 Drawing History at all. <SoDrawingHistory /> calls
  // the same hook, and the shared query key means TanStack Query serves it from
  // cache rather than firing a second request.
  const { data: drawingHistory } = useSoDrawingHistory(id);

  if (isLoading) {
    return <PageState state="loading" message="Loading sales order…" />;
  }
  if (isError || !detail) {
    return (
      <>
        <Link to="/sales-orders" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={14} /> Back to Sales Orders
        </Link>
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Sales order not found'}
        />
      </>
    );
  }

  // Hide-page: VIEW removed for SO Master → no-access panel, not the detail.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  // Access matrix (so_create) replaces the old admin/manager role flags.
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  // Money hidden for L1 Viewers: the API nulls the SO's GST % and every line
  // rate together, so a null GST % is the single signal to drop ₹ here.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = detail.priceVisible === false;
  const totalValue = detail.lines.reduce((s, l) => s + l.orderQty * Number(l.rate ?? 0), 0);
  // Still to ship = ordered − already dispatched, per line (never below zero).
  // Drives whether "Dispatch" is offered as the next step.
  const pendingDispatchQty = detail.lines.reduce(
    (s, l) => s + Math.max(0, l.orderQty - l.dispatchedQty),
    0,
  );

  return (
    <div>
      <DetailHeader
        backTo="/sales-orders"
        backLabel="Back to Sales Orders"
        renderLink={(p) => <Link {...p} />}
        code={detail.code}
        name={detail.customerName ?? 'Untitled customer'}
        badges={
          <StatusBadge kind="so" status={detail.status} label={SO_STATUS_LABEL[detail.status]} />
        }
        actions={
          /* ONE primary next step (Dispatch, while anything is left to ship),
             Plan as a quiet link, and everything else in the Actions menu —
             Delete last, in red. Same permission gates as before. */
          <>
            <Link
              to="/planning"
              search={{ soId: detail.id }}
              className="btn btn-ghost"
              title="Open this SO in Planning"
            >
              Plan
            </Link>
            <ActionMenu
              items={[
                { label: 'Assign Task', onClick: () => setAssignOpen(true) },
                {
                  label: 'Status',
                  title: 'Open SO Status Review',
                  onClick: () =>
                    void navigate({ to: '/sales-orders/$id/status', params: { id: detail.id } }),
                },
                {
                  label: 'Edit',
                  hidden: !canEdit,
                  onClick: () =>
                    void navigate({ to: '/sales-orders/$id/edit', params: { id: detail.id } }),
                },
                {
                  label: 'Delete',
                  danger: true,
                  hidden: !canDelete,
                  onClick: () => setConfirmDelete(true),
                },
              ]}
            />
            {pendingDispatchQty > 0 ? (
              <Link
                to="/customer-dispatches/new"
                search={{ so: detail.id }}
                className="btn btn-primary"
                title={`${pendingDispatchQty} still to dispatch on this SO`}
              >
                Dispatch
              </Link>
            ) : null}
          </>
        }
      >
        <SoReadGrid detail={detail} />
        {/* ADR-189 — the SO's money, summed on the server. Null when this
            user's access hides prices, and then the strip is not shown. */}
        {detail.totals ? (
          <QtyStrip
            style={{ marginTop: 'var(--sp-3)' }}
            items={[
              { label: 'Subtotal', value: fmtInr(detail.totals.subtotal) },
              {
                label: `GST ${detail.totals.gstPercent}%`,
                value: fmtInr(detail.totals.gstAmount),
              },
              { label: 'Grand Total', value: fmtInr(detail.totals.grandTotal) },
            ]}
          />
        ) : null}
      </DetailHeader>

      <SoFilesPanel
        detail={detail}
        canEdit={canEdit}
        companyId={me?.companyId ?? null}
        onPreview={setPreview}
      />

      <Panel
        title={`Line Items (${detail.lines.length})`}
        bodyPadding="none"
        actions={
          <QtyStrip
            items={[
              { label: 'Total Qty', value: totalQty },
              ...(!priceHidden && totalValue > 0
                ? [{ label: 'Value', value: `₹${totalValue.toFixed(2)}` }]
                : []),
            ]}
          />
        }
      >
        <DataTable<SalesOrderLine>
          columns={lineColumns({ priceHidden, soCode: detail.code, onPreview: setPreview })}
          rows={detail.lines}
          empty="No lines on this SO yet."
        />
      </Panel>

      {detail.milestones.length > 0 ? (
        <Panel title={`📅 Delivery Schedule (${detail.milestones.length})`} bodyPadding="none">
          <DataTable
            columns={MILESTONE_COLUMNS}
            rows={detail.milestones}
            empty="No delivery lots scheduled."
          />
        </Panel>
      ) : null}

      <RelatedDocsTabs
        module="sales-orders"
        id={detail.id}
        extraTabs={[
          {
            key: 'drawing-history',
            title: 'Drawing History',
            icon: '📐',
            // Zero hides the tab, so an SO whose lines never carried a drawing
            // looks exactly as it did before.
            count: drawingHistory?.lines.length ?? 0,
            render: () => <SoDrawingHistory salesOrderId={detail.id} soCode={detail.code} />,
          },
        ]}
      />

      {/* SO Documents — file store folded in from the former standalone screen. */}
      <div className="section-hdr" style={{ marginTop: 'var(--sp-5)' }}>
        📁 SO Documents
      </div>
      <SoDocumentsSection soId={detail.id} />

      {preview ? <FilePreviewModal {...preview} onClose={() => setPreview(null)} /> : null}

      {assignOpen ? (
        <AssignTaskModal
          linkedRef={{
            type: 'sales_order',
            id: detail.id,
            display: `SO ${detail.code}`,
            navPage: `/sales-orders/${detail.id}`,
          }}
          suggestedTitle={`Follow up on SO ${detail.code}`}
          onClose={() => setAssignOpen(false)}
        />
      ) : null}

      {/* Delete goes through the ONE confirm dialog — never an inline
          "Delete? [Confirm][Cancel]" swap, never window.confirm. A failed
          delete is shown INSIDE the dialog and the question stays open, so the
          user does not lose it along with the error. */}
      <ConfirmDialog
        open={confirmDelete}
        title={`Move SO ${detail.code} to Trash?`}
        message={`${detail.code} and its ${detail.lines.length} line${
          detail.lines.length === 1 ? '' : 's'
        } will be removed from the Sales Order list. You can restore it from Trash.`}
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await softDelete.mutateAsync(detail.id);
          void navigate({ to: '/sales-orders', replace: true });
        }}
      />
    </div>
  );
}

/* ── Line items ─────────────────────────────────────────────────────────────
   Built as a column list rather than hand-written <tr>/<td>, so the ruled
   sheet, the sticky header, the centring and the empty row all come from
   <DataTable>. Widths are % and sum to 100 — `table-layout: fixed` needs them
   to, and dropping the Rate column hands its share to the Item cell. */

function lineColumns(opts: {
  priceHidden: boolean;
  /** Carried down only so the drawing access log reads "IN-SO-26-00521 L3"
   *  instead of a storage path nobody recognises. */
  soCode: string;
  onPreview: (file: PreviewFile) => void;
}): DataTableColumn<SalesOrderLine>[] {
  const { priceHidden, soCode, onPreview } = opts;
  return [
    {
      header: 'Ln',
      width: '4%',
      className: 'mono',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--blue)' }}>{l.lineNo}</span>,
    },
    {
      // The customer's PO line number. It is typed on this line and every
      // downstream document repeats it, so it belongs next to the line number
      // here, where it is authored. Purple, mono, 700 — unchanged.
      header: 'POL',
      width: '5%',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--purple)' }}>{l.clientPoLineNo ?? '—'}</span>,
    },
    {
      // Image · CODE/REV · Part Name in one badge cell (user decision
      // 2026-09-21) — the former separate Part Name column folded in. The Rev
      // is the customer's drawing revision, typed on this line, and it travels
      // with the item code wherever an SO line is shown (the badge formats it
      // via itemCodeWithRev).
      header: 'Item',
      width: priceHidden ? '24%' : '17%',
      align: 'left',
      render: (l) => (
        <ItemBadge
          size="row"
          code={l.itemCode ?? l.itemCodeText}
          name={l.partName}
          revision={l.revision}
          imagePath={l.itemImagePath}
        />
      ),
    },
    {
      header: 'Material',
      width: '8%',
      className: 'text3',
      ellipsis: true,
      render: (l) => l.material ?? '—',
      title: (l) => l.material ?? '',
    },
    {
      header: 'Drawing',
      width: '10%',
      className: 'mono',
      render: (l) => {
        const drawingFilePath = l.drawingFilePath ?? null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-0)' }}>
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
          </div>
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
      header: 'Dispatched',
      align: 'right',
      width: '7%',
      headColor: 'var(--green)',
      className: 'mono',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--green2)' }}>{l.dispatchedQty}</span>,
    },
    {
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
      // qty still owed on the order ("Pending").
      header: 'To Bill',
      align: 'right',
      width: '7%',
      headColor: 'var(--red)',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => (
        <span style={{ color: l.orderQty - l.billedQty > 0 ? 'var(--red)' : 'var(--green)' }}>
          {l.orderQty - l.billedQty}
        </span>
      ),
    },
    { header: 'UOM', key: 'uom', width: '5%', nowrap: true },
    ...(priceHidden
      ? []
      : [
          {
            header: 'Rate',
            width: '7%',
            align: 'right' as const,
            className: 'mono',
            nowrap: true,
            render: (l: SalesOrderLine) =>
              Number(l.rate) > 0 ? `₹${Number(l.rate).toFixed(2)}` : '—',
          },
        ]),
    {
      header: 'Due Date',
      width: '8%',
      className: 'mono text2',
      nowrap: true,
      render: (l) => fmtDate(l.dueDate),
    },
    {
      header: 'SO Status',
      width: '10%',
      render: (l) => <StatusBadge kind="so" status={l.status} label={SO_STATUS_LABEL[l.status]} />,
    },
  ];
}

/* ── Delivery schedule ─────────────────────────────────────────────────── */

type Milestone = SalesOrderDetail['milestones'][number];

const MILESTONE_COLUMNS: DataTableColumn<Milestone>[] = [
  { header: 'Lot No.', key: 'lotNo', width: '18%', className: 'mono fw-700', nowrap: true },
  { header: 'Qty', key: 'qty', width: '14%', align: 'right', className: 'mono', nowrap: true },
  {
    header: 'Due Date',
    width: '20%',
    className: 'mono',
    nowrap: true,
    render: (m) => fmtDate(m.dueDate),
  },
  {
    header: 'Remarks',
    width: '48%',
    align: 'left',
    ellipsis: true,
    render: (m) => m.remarks ?? '—',
    title: (m) => m.remarks ?? '',
  },
];

/* ── Client PO + email reference ────────────────────────────────────────────
   Client-PO document bar (ISSUE-013). Stores the client PO file in the unified
   file_registry (category 'client_po') via the SO Documents producer, then
   refreshes this SO's detail so the 📎 link + SO Master paperclip light up. */

function SoFilesPanel({
  detail,
  canEdit,
  companyId,
  onPreview,
}: {
  detail: SalesOrderDetail;
  canEdit: boolean;
  companyId: string | null;
  onPreview: (file: PreviewFile) => void;
}): React.JSX.Element {
  const createDoc = useCreateSoDocument();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clientPoPath = detail.clientPoFilePath;

  // Email reference(s) attached to this SO (uploaded on create / SO Documents).
  const docDetail = useSoDocDetail(detail.id);
  const emailRefs = (docDetail.data?.files ?? []).filter(
    (f) => f.category === 'email_reference' && f.status !== 'archived',
  );

  async function onPick(file: File): Promise<void> {
    if (!companyId) {
      setErr('No company on session — cannot upload.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const storagePath = await uploadSoDocFile(file, companyId);
      await createDoc.mutateAsync({
        salesOrderId: detail.id,
        soCodeText: detail.code,
        category: 'client_po',
        docType: 'Client PO',
        fileName: file.name,
        storagePath,
        fileSize: file.size,
        fileType: file.type || undefined,
      });
      await qc.invalidateQueries({ queryKey: salesOrdersKeys.detail(detail.id) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not upload file. Try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Panel bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
        }}
      >
        <span className="form-label">📎 Client PO Document</span>
        {clientPoPath ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="eye" size={13} />}
            title="Preview Client PO Document"
            // Only the path is on the SO record; the modal derives a display
            // name from it.
            onClick={() => onPreview({ storagePath: clientPoPath })}
          >
            View
          </Button>
        ) : (
          <span className="text3" style={{ fontSize: 'var(--fs-sm)' }}>
            None uploaded
          </span>
        )}
        {canEdit ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              icon={<Icon name="upload" size={13} />}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Uploading…' : clientPoPath ? 'Replace' : 'Upload'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPick(f);
              }}
            />
          </>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
        }}
      >
        <span className="form-label">📧 Email Reference</span>
        {emailRefs.length > 0 ? (
          emailRefs.map((f) => (
            <Button
              key={f.id}
              variant="ghost"
              size="sm"
              icon={<Icon name="eye" size={13} />}
              title={f.fileName}
              onClick={() =>
                onPreview({
                  storagePath: f.storagePath,
                  fileName: f.fileName,
                  fileType: f.fileType,
                })
              }
            >
              View
              <span
                className="text3"
                style={{
                  maxWidth: 'var(--field-md)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginLeft: 'var(--sp-1)',
                  fontSize: 'var(--fs-xs)',
                }}
              >
                {f.fileName}
              </span>
            </Button>
          ))
        ) : (
          <span className="text3" style={{ fontSize: 'var(--fs-sm)' }}>
            None attached
          </span>
        )}
      </div>

      {err ? (
        <Banner tone="error" flush>
          {err}
        </Banner>
      ) : null}
    </Panel>
  );
}

/* ── Header data ────────────────────────────────────────────────────────── */

function SoReadGrid(props: { detail: SalesOrderDetail }): React.JSX.Element {
  const { detail } = props;
  // Remarks can be long; collapse to one line with a "more"/"less" toggle so the
  // grid stays one compact band. Presentation only — no data change.
  const [showAllRemarks, setShowAllRemarks] = useState(false);
  const remarks = detail.remarks ?? '';
  const remarksLong = remarks.length > 80;
  const toggleStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    marginLeft: 'var(--sp-1)',
    color: 'var(--blue)',
    cursor: 'pointer',
    fontSize: 'var(--fs-sm)',
    fontWeight: 600,
  };

  return (
    <ReadGrid>
      <ReadField label="SO Type" size="md" value={SO_TYPE_LABEL[detail.type]} />
      <ReadField label="SO Date" size="sm" mono value={fmtDate(detail.soDate)} />
      <ReadField
        label="Client PO No."
        size="sm"
        mono
        value={
          detail.clientPoNo ? (
            <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{detail.clientPoNo}</span>
          ) : null
        }
      />
      {detail.gstPercent == null ? null : (
        <ReadField
          label="GST %"
          size="xs"
          value={
            <span style={{ color: 'var(--green2)', fontWeight: 700 }}>{detail.gstPercent}%</span>
          }
        />
      )}
      <ReadField label="Cost Centre" size="md" value={detail.costCenter} />
      {detail.type === 'component_manufacturing' ? null : (
        <ReadField
          label="BOM"
          size="md"
          value={
            detail.bomMasterId ? (
              <>
                <Link
                  to="/bom-masters/$id"
                  params={{ id: detail.bomMasterId }}
                  className="td-code"
                  style={{ color: 'var(--blue)' }}
                >
                  {detail.bomMasterCode ?? detail.bomMasterId}
                </Link>
                {detail.bomStatus ? (
                  <span
                    className="text3"
                    style={{ marginLeft: 'var(--sp-1)', fontSize: 'var(--fs-xs)' }}
                  >
                    ({detail.bomStatus})
                  </span>
                ) : null}
              </>
            ) : null
          }
        />
      )}
      <ReadField
        label="Raised By"
        size="md"
        value={
          (detail.createdByName ?? '—') +
          (detail.createdAt ? ` · ${fmtIstDateTime(detail.createdAt)}` : '')
        }
      />
      <ReadField
        label="Remarks"
        size="full"
        pre
        value={
          remarks === '' ? null : remarksLong && !showAllRemarks ? (
            <>
              {`${remarks.slice(0, 80).trimEnd()}…`}
              <button type="button" style={toggleStyle} onClick={() => setShowAllRemarks(true)}>
                more
              </button>
            </>
          ) : (
            <>
              {remarks}
              {remarksLong ? (
                <button type="button" style={toggleStyle} onClick={() => setShowAllRemarks(false)}>
                  less
                </button>
              ) : null}
            </>
          )
        }
      />
    </ReadGrid>
  );
}
