// Route Card detail page. Mirrors legacy viewRouteCard modal (L10143).
//
// 2026-10-06 layout (owner-approved mock-up pro-routecard-detail-mockup.html,
// "Route Card detail"): the whole page fits one 1440×810 screen with no page
// scroll. Top to bottom:
//   header      ← Back · code · Route Card · Rev chip … Print · ⋯ (Delete) · Edit / Revise
//   identity    which item this route belongs to (DocIdent)
//   facts       Route · Material · Notes, one line each (ClusterGrid — the Plan
//               screens method, ADR-214)
//   tab panel   Operation Sequence | Revision History | History — the one block
//               that takes the height left (`page-fill rc-detail` + <Panel fill>); its
//               table scrolls inside with the header row held.
// Data, permissions, print and delete are unchanged from the stacked-panel page.

import type { RouteCardDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Printer } from 'lucide-react';
import { useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { useDocumentHistory } from '@/modules/activity-log/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { ConfirmDialog } from '@/ui/feedback';
import { Cluster, ClusterFact, ClusterGrid, DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { ActionMenu } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useItem } from '../../items/api';
import { useMyCompany } from '../../settings/api';
import { useDeleteRouteCard, useRouteCard } from '../api';
import { RouteCardOpsTable } from '../components/route-card-ops-table';
import { RouteCardRevisionHistory } from '../components/route-card-revision-history';
import { printRouteCard } from '../lib/print-route-card';
import '../components/rc-detail.css';

export const routeCardDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards/$id',
  component: RouteCardDetailPage,
});

type TabKey = 'ops' | 'revisions' | 'history';

function RouteCardDetailPage(): React.JSX.Element {
  const { id } = routeCardDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useRouteCard(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'routecard_create');
  const { data: item } = useItem(detail?.itemId);
  const { data: company } = useMyCompany();
  // The History tab's count. Same query key DocumentHistory reads, so the tab
  // body and its count are ONE request.
  const { data: history } = useDocumentHistory({
    entity: 'RouteCard',
    entityId: detail?.id,
    refId: detail?.code,
  });
  const del = useDeleteRouteCard();
  // Print failure (popup blocked) shows in place — never window.alert.
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [tab, setTab] = useState<TabKey>('ops');

  const onPrint = (): void => {
    if (!detail) return;
    setNotice(null);
    if (!printRouteCard({ rc: detail, item, company })) {
      setNotice('Allow popups to print.');
    }
  };

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Route Cards. Ask an admin.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading route card…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/route-cards" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Route Card not found.'}
          </div>
        </div>
      </div>
    );
  }

  // The Operations split, counted from the rows the Operation Sequence tab
  // shows — process = in-house, outsource = OSP, qc = QC.
  const inHouse = detail.ops.filter((o) => o.opType === 'process').length;
  const osp = detail.ops.filter((o) => o.opType === 'outsource').length;
  const qc = detail.ops.filter((o) => o.opType === 'qc').length;

  return (
    <div className="page-fill rc-detail">
      {/* Header: the number, its revision, and the next step (Edit / Revise)
          as the one primary button. Delete folds into the ⋯ menu. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--panel-gap)',
        }}
      >
        <Link to="/route-cards" className="btn btn-ghost">
          <ArrowLeft size={14} /> Back
        </Link>
        <span className="td-code" style={{ color: 'var(--blue)', fontSize: 'var(--fs-md)' }}>
          {detail.code}
        </span>
        <span className="panel-title">Route Card</span>
        <span className="badge b-blue">Route Card Rev {detail.currentRevision}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" onClick={onPrint}>
          <Printer size={13} /> Print
        </button>
        <ActionMenu
          label="⋯"
          items={[
            {
              label: 'Delete',
              danger: true,
              hidden: !(perms.edit && perms.approve),
              disabled: del.isPending,
              title: 'Move this Route Card to Trash',
              onClick: () => {
                setDeleteReason('');
                setConfirmDelete(true);
              },
            },
          ]}
        />
        {perms.edit && (
          <Link to="/route-cards/$id/edit" params={{ id: detail.id }} className="btn btn-primary">
            <Pencil size={13} /> Edit / Revise
          </Link>
        )}
      </div>

      <Panel>
        {/* WHICH item this route belongs to — identity, not a fact about the
            route, so it heads the block instead of taking grid cells. */}
        <DocIdent>
          <IdentCode>{detail.code}</IdentCode>
          <IdentSep />
          <IdentCode>{detail.itemCode ?? '—'}</IdentCode>
          <span>{detail.itemName ?? '— unknown item —'}</span>
        </DocIdent>

        <ClusterGrid>
          {/* How the item is made, and how many steps of each kind. */}
          <Cluster name="Route">
            <PlanTypeFact planType={detail.planType} />
            <ClusterFact
              span={2}
              label="Operations"
              value={
                <>
                  <span className="mono fw-700">{detail.ops.length}</span>
                  {detail.ops.length > 0 ? (
                    <span
                      className="mono text3"
                      style={{ fontSize: 'var(--fs-xs)', fontWeight: 400, marginLeft: 8 }}
                    >
                      {inHouse} in-house · {osp} OSP · {qc} QC
                    </span>
                  ) : null}
                </>
              }
            />
            <ClusterFact num label="Last Updated" value={fmtDate(detail.updatedAt)} />
          </Cluster>

          {/* WHAT the part is cut from — the same four cells, in the same
              order, as the Production Order's Material row. Blank fields show
              as dashes, because a missing grade is a gap worth seeing. */}
          <Cluster name="Material">
            <ClusterFact
              num
              label="RM Item"
              empty={!detail.rawMaterialItemCode}
              title={detail.rawMaterialItemCode ?? undefined}
              value={detail.rawMaterialItemCode ?? '—'}
            />
            <ClusterFact
              num
              label="RM Grade"
              empty={!detail.rawMaterialGradeText}
              title={detail.rawMaterialGradeText ?? undefined}
              value={detail.rawMaterialGradeText ?? '—'}
            />
            <ClusterFact
              num
              label="RM Size"
              empty={!detail.rawMaterialSizeText}
              title={detail.rawMaterialSizeText ?? undefined}
              value={detail.rawMaterialSizeText ?? '—'}
            />
            <ClusterFact
              num
              label="RM Qty per piece"
              empty={detail.rmQtyPerPiece == null}
              value={detail.rmQtyPerPiece == null ? '—' : String(detail.rmQtyPerPiece)}
            />
          </Cluster>

          <Cluster name="Notes">
            <ClusterFact
              span={4}
              wrap
              label="Route Card Remarks"
              empty={!detail.notes}
              value={detail.notes ?? '—'}
            />
          </Cluster>
        </ClusterGrid>

        {notice ? (
          <div
            style={{
              marginTop: 8,
              color: 'var(--red2)',
              background: 'var(--red3)',
              border: '1px solid var(--red2)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            {notice}
          </div>
        ) : null}
      </Panel>

      <TabStrip
        label="Route Card lists"
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: 'ops', label: 'Operation Sequence', count: detail.ops.length },
          { key: 'revisions', label: 'Revision History', count: detail.revisions.length },
          // null while loading — a count still in flight is not a 0.
          { key: 'history', label: 'History', count: history ? history.rows.length : null },
        ]}
      />

      {/* The one block that takes the height left on the page; the table in
          it is what scrolls, with its header row held at the top. */}
      <Panel fill bodyPadding="none">
        {tab === 'ops' ? <RouteCardOpsTable ops={detail.ops} /> : null}
        {tab === 'revisions' ? <RouteCardRevisionHistory revisions={detail.revisions} /> : null}
        {/* ADR-197 — who did what to this card, with before → after and reasons. */}
        {tab === 'history' ? (
          <DocumentHistory entity="RouteCard" entityId={detail.id} refId={detail.code} />
        ) : null}
      </Panel>

      <ConfirmDialog
        open={confirmDelete}
        title={`Move Route Card ${detail.code} to Trash?`}
        message={
          <>
            You can restore it from Trash.
            <textarea
              className="innovic-input"
              aria-label="Reason"
              placeholder="Reason (required)"
              rows={2}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 8 }}
            />
          </>
        }
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const reason = deleteReason.trim();
          // Thrown, not returned: the ConfirmDialog shows it and stays open.
          if (!reason) throw new Error('Enter a reason to move this Route Card to Trash.');
          await del.mutateAsync({ id: detail.id, reason });
          void navigate({ to: '/route-cards' });
        }}
      />
    </div>
  );
}

/** Plan Type is how the item is normally made — the same choice SO Planning
 *  asks per plan, so it reads in Planning's colours.
 *
 *  Built from ClusterFact's own classes rather than ClusterFact itself for ONE
 *  reason: an old Buy card carries a note under the value, and ClusterFact has
 *  no slot that can wrap — its value is one clipped line and its `after` chip
 *  never shrinks, so a 50-character note there would spill out of the cell.
 *  The third child takes the full cell width (the cell is `flex-wrap`) and
 *  wraps inside it. */
function PlanTypeFact({ planType }: { planType: RouteCardDetail['planType'] }): React.JSX.Element {
  const color =
    planType === 'full_outsource'
      ? 'var(--purple)'
      : planType === 'direct_purchase'
        ? 'var(--green)'
        : 'var(--cyan)';
  const label =
    planType === 'full_outsource'
      ? '📦 Full Outsource'
      : planType === 'direct_purchase'
        ? '🛒 Buy'
        : '🏭 Manufacture';
  return (
    <div className="cl-fact">
      <span className="cl-fact-k">Plan Type</span>
      <span className="cl-fact-v" style={{ color, fontWeight: 700 }}>
        {label}
      </span>
      {planType === 'direct_purchase' ? (
        // ADR-171: the tile is gone from the form; the value survives on old
        // cards so the user knows where the flag now lives.
        <span
          className="text3"
          style={{ flexBasis: '100%', fontSize: 'var(--fs-xs)', textAlign: 'right' }}
        >
          Old setting — set the item&apos;s Source to Buy instead.
        </span>
      ) : null}
    </div>
  );
}
