// Party GRN detail page (ADR-294, owner: "remove the details opening below the
// line"). A list row now opens this page, like SO / GRN / PO / JW DC, instead
// of expanding the receipt under the row.
//
// What moved here from the old row-expand (party-grn-expand.tsx, removed):
//  - Received By + GRN Remarks + the cancel reason/time → the header facts and
//    the red Cancelled banner;
//  - the "Changes awaiting approval" chips → PartyGrnPendingChanges;
//  - the per-line QC table → the Lines DataTable (party-grn-line-table.tsx);
//  - the receipt's History → the History tab of RelatedDocsTabs.
// The actions are the list row ⋯'s, with the same rules (Edit · Incoming QC ·
// Preview · Download PDF · Cancel Party GRN).
//
// Refresh: 'party-grn' is 'poll' — the detail read polls like the list; every
// mutation already invalidates partyGrnKeys.all, which covers detail(id).

import { Link, createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useHistoryTab } from '@/components/shared/document-history';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterFact, ClusterGrid } from '@/ui/forms';
import { ActionMenu, DetailHeader, PageState } from '@/ui/layout';
import { usePartyGrnDetail } from '../api';
import { EditPartyGrnModal } from '../components/edit-party-grn-modal';
import { isPartyGrnCancelled } from '../components/party-grn-columns';
import { partyGrnLineColumns } from '../components/party-grn-line-table';
import { PartyGrnPendingChanges } from '../components/party-grn-pending-changes';
import { PartyGrnQcModal } from '../components/party-grn-qc-modal';
import { usePartyGrnPrint } from '../components/use-party-grn-print';
import { PGRN_QC_BADGE, pgrnQcLabel, pgrnQcStateOfGrn } from '../lib/qc-state';

export const partyGrnDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-grn/$id',
  component: PartyGrnDetailPage,
});

/** Built once — the lines table's columns never change per render. */
const PARTY_GRN_LINE_COLUMNS = partyGrnLineColumns();

function PartyGrnDetailPage(): React.JSX.Element {
  const { id } = partyGrnDetailRoute.useParams();
  // Every hook sits above the early returns (CLAUDE.md §23).
  const [editOpen, setEditOpen] = useState(false);
  const [qcOpen, setQcOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // The 60 s poll pauses while the Edit / QC popup is open (they read the same
  // query), so a refresh never re-seeds a form under the user's typing — as on
  // the list, where the popups open with no poll on this key.
  const {
    data: g,
    isLoading,
    isError,
    error,
  } = usePartyGrnDetail(id, {
    poll: !editOpen && !qcOpen,
  });
  const { data: eff } = useMyAccess();
  // The same rights as the list row ⋯ (routes/list.tsx).
  const perms = effectiveFormPerms(eff, 'party_create');
  const qcPerms = effectiveFormPerms(eff, 'qc_incoming');
  const partyGrnPrint = usePartyGrnPrint();
  // ADR-197 — this receipt's own History (create + compulsory QC).
  const historyTab = useHistoryTab({ entity: 'PartyGrn', entityId: g?.id, refId: g?.code });

  // PAGE_ACCESS '/party-grn/$id': Party GRN view OR Incoming QC view. `eff`
  // is undefined only while access loads — never block then.
  if (eff && !perms.view && !qcPerms.view) return <PageState as="page" state="noaccess" />;
  if (isLoading) return <PageState as="page" state="loading" message="Loading Party GRN…" />;
  if (isError || !g) {
    return (
      <PageState
        as="page"
        state="error"
        message={error instanceof Error ? error.message : 'Party GRN not found.'}
        action={
          <Link to="/party-grn" className="btn btn-ghost btn-sm">
            ← Back to Party GRN list
          </Link>
        }
      />
    );
  }

  const cancelled = isPartyGrnCancelled(g);
  const waiting = g.qcPendingLines > 0 && !cancelled;
  const canEdit = perms.edit && waiting;
  const canQc = qcPerms.entry && waiting;
  const canCancel = !cancelled && (perms.edit || perms.approve);
  const printTarget = { ...g, cancelled };
  const qcState = pgrnQcStateOfGrn(g);
  const customer = g.clientName ?? g.clientCodeText ?? '—';
  // Already in line order (loadPartyGrnDetail orders by line_no).
  const lines = g.lines;

  return (
    <div>
      <DetailHeader
        backTo="/party-grn"
        backLabel="Back to Party GRN list"
        renderLink={(p) => <Link {...p} />}
        code={g.code}
        name={customer}
        badges={
          cancelled ? (
            <span className="badge b-red">Cancelled</span>
          ) : (
            <span className={`badge ${PGRN_QC_BADGE[qcState]}`}>
              {pgrnQcLabel(qcState, g.totalQcPendingQty)}
            </span>
          )
        }
        actions={
          <ActionMenu
            items={[
              // Edit right, a line still waiting for Incoming QC, not Cancelled.
              { label: 'Edit', icon: 'pencil', hidden: !canEdit, onClick: () => setEditOpen(true) },
              // ADR-203 (owner D4): qc_incoming · entry, only while a line waits.
              {
                label: 'Incoming QC',
                icon: 'check',
                hidden: !canQc,
                onClick: () => setQcOpen(true),
              },
              {
                label: 'Preview',
                icon: 'eye',
                onClick: () => void partyGrnPrint('preview', printTarget),
              },
              {
                label: 'Download PDF',
                icon: 'download',
                onClick: () => void partyGrnPrint('download', printTarget),
              },
              // ADR-235 — the ONE standard Cancel: Edit requests, Approve decides.
              {
                label: 'Cancel Party GRN',
                icon: 'x',
                danger: true,
                hidden: !canCancel,
                onClick: () => setCancelOpen(true),
              },
            ]}
          />
        }
      >
        <ClusterGrid stack>
          <Cluster name="Receipt">
            <ClusterFact num label="GRN No." value={g.code} />
            <ClusterFact num label="GRN Date" value={fmtDate(g.grnDate)} />
            <ClusterFact
              num
              label="JWSO No."
              empty={!g.jwCodeText}
              value={
                g.jobWorkOrderId && g.jwCodeText ? (
                  <Link
                    to="/job-work-orders/$id"
                    params={{ id: g.jobWorkOrderId }}
                    className="fw-700"
                  >
                    {g.jwCodeText}
                  </Link>
                ) : (
                  (g.jwCodeText ?? '—')
                )
              }
            />
            <ClusterFact label="Customer" title={customer} value={customer} />
          </Cluster>
          <Cluster name="Customer Papers">
            <ClusterFact
              num
              label="Client PO No."
              empty={!g.clientPoNo}
              value={g.clientPoNo ?? '—'}
            />
            <ClusterFact num label="Customer Challan No." empty={!g.dcNo} value={g.dcNo ?? '—'} />
            <ClusterFact
              label="Received By"
              empty={!g.receivedByText}
              value={g.receivedByText ?? '—'}
            />
            <ClusterFact wrap label="GRN Remarks" empty={!g.remarks} value={g.remarks ?? '—'} />
          </Cluster>
        </ClusterGrid>
      </DetailHeader>

      {/* ADR-235 — an open Cancel Request (orange), or the Cancelled mark (red). */}
      <CancelPendingBanner
        docType="party_grn"
        docId={g.id}
        cancelled={cancelled}
        {...(canCancel ? { onOpen: () => setCancelOpen(true) } : {})}
      />
      {cancelled ? (
        <div className="mb-2">
          <Banner tone="error" accent title="Cancelled — this Party GRN is void">
            <div>
              Reason: <b>{g.cancelReason ?? '—'}</b>
              {g.cancelledAt ? ` · ${fmtDateTime(g.cancelledAt)}` : ''}
            </div>
          </Banner>
        </div>
      ) : null}

      {/* ADR-202 — changes staged against this receipt, waiting for approval. */}
      <PartyGrnPendingChanges grnId={g.id} lines={lines} />

      <Panel title={`Lines (${lines.length})`} bodyPadding="none">
        <DataTable
          columns={PARTY_GRN_LINE_COLUMNS}
          rows={lines}
          rowKey={(l) => l.id}
          emptyText="No lines on this Party GRN."
        />
      </Panel>

      <RelatedDocsTabs module="party-grn" id={g.id} extraTabs={[historyTab]} />

      {/* Once open, a popup stays open even if the GRN changes underneath (as on
          the list): the server refuses a stale save and says why. */}
      {editOpen ? <EditPartyGrnModal row={g} onClose={() => setEditOpen(false)} /> : null}
      {qcOpen ? <PartyGrnQcModal row={g} onClose={() => setQcOpen(false)} /> : null}
      {cancelOpen ? (
        <CancelDocDialog
          docType="party_grn"
          docId={g.id}
          docCode={g.code}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
    </div>
  );
}
