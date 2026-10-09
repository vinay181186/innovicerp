// Multi-Level Plan detail (ADR-225 phase 3): DetailHeader (MLP No. · status ·
// Edit + Actions) with the header facts, then ONE tab strip — Plan · Orders ·
// History. Same composition as the Multi-Level BOM detail page. Phase 4 adds
// Raise Orders (Draft / Released, mlplan_create entry) and the Orders tab.

import { ML_PLAN_STATUS_LABEL } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDateTime } from '@/lib/date';
import { useDocumentHistory } from '@/modules/activity-log/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { ActionMenu, DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { TabStrip, type TabStripTab } from '@/ui/navigation';
import { useMlBom } from '@/modules/ml-bom/api';
import { useMlPlan, useRefreshMlPlan } from '../api';
import { CancelMlPlanDialog } from '../components/cancel-ml-plan-dialog';
import { MlPlanNodesTable } from '../components/ml-plan-nodes-table';
import { MlPlanOrdersTable } from '../components/ml-plan-orders-table';
import { RaiseOrdersModal } from '../components/raise-orders-modal';

export const mlPlanDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-plans/$id',
  component: MlPlanDetailPage,
});

type TabKey = 'plan' | 'orders' | 'history';

function MlPlanDetailPage(): React.JSX.Element {
  const { id } = mlPlanDetailRoute.useParams();
  const { data: detail, isLoading, isError, error } = useMlPlan(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlplan_create');
  const refresh = useRefreshMlPlan();
  const [tab, setTab] = useState<TabKey>('plan');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The BOM's current BOM Rev, read only when the copy is out of date.
  const currentBom = useMlBom(detail?.bomChanged ? detail.mlBomId : undefined);
  const history = useDocumentHistory({
    entity: 'MlPlan',
    entityId: detail?.id,
    refId: detail?.code,
  });

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }
  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading plan…" />;
  }
  if (isError || !detail) {
    return (
      <div>
        <Link
          to="/ml-plans"
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 'var(--sp-2)' }}
        >
          <Icon name="arrow-left" size={14} /> Back
        </Link>
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Plan not found.'}
        />
      </div>
    );
  }

  const isDraft = detail.status === 'draft';
  // Raise Orders: Draft or Released, Planning entry, and a row left to raise.
  const canRaise =
    perms.entry &&
    (detail.status === 'draft' || detail.status === 'released') &&
    detail.nodes.some((n) => Number(n.toRaiseQty) > 0);
  const onRefresh = (): void => {
    setActionError(null);
    refresh.mutate(
      { id: detail.id, expectedUpdatedAt: detail.updatedAt },
      { onError: (e) => setActionError(e.message) },
    );
  };

  const tabs: TabStripTab[] = [
    { key: 'plan', label: 'Plan', count: detail.nodes.length },
    { key: 'orders', label: 'Orders', count: detail.orders.length },
    { key: 'history', label: 'History', count: history.data?.rows.length ?? null },
  ];

  return (
    <div>
      <DetailHeader
        backTo="/ml-plans"
        renderLink={(p) => <Link {...p} />}
        code={detail.code}
        name={detail.itemName ?? undefined}
        badges={
          <StatusBadge
            kind="doc"
            status={detail.status}
            label={ML_PLAN_STATUS_LABEL[detail.status]}
          />
        }
        actions={
          <>
            {perms.edit && isDraft ? (
              <Link
                to="/ml-plans/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-primary btn-sm"
              >
                <Icon name="pencil" size={13} /> Edit
              </Link>
            ) : null}
            <ActionMenu
              items={[
                {
                  label: 'Raise Orders',
                  hidden: !canRaise,
                  onClick: () => setRaiseOpen(true),
                },
                {
                  label: 'Refresh',
                  hidden: !perms.edit || !isDraft,
                  disabled: refresh.isPending,
                  onClick: onRefresh,
                },
                {
                  label: 'Cancel',
                  danger: true,
                  hidden: !perms.edit || detail.status === 'cancelled',
                  onClick: () => setConfirmCancel(true),
                },
              ]}
            />
          </>
        }
      >
        {detail.bomChanged ? (
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <Banner tone="warn" flush>
              {isDraft
                ? currentBom.data
                  ? `BOM changed since this plan — Refresh to use BOM Rev ${currentBom.data.revision}`
                  : 'BOM changed since this plan — Refresh to use the current BOM'
                : 'BOM changed since this plan'}
            </Banner>
          </div>
        ) : null}
        <ReadGrid>
          <ReadField label="MLP No." size="sm" mono value={detail.code} />
          <ReadField
            label="SO No."
            size="sm"
            value={
              <Link
                to="/sales-orders/$id"
                params={{ id: detail.salesOrderId }}
                className="mono"
                style={{ color: 'var(--blue)', textDecoration: 'none' }}
              >
                {detail.soCode}
              </Link>
            }
          />
          <ReadField label="Internal SO No." size="sm" mono value={detail.soInternalNo} />
          <ReadField label="POL" size="sm" mono value={detail.clientPoLineNo} />
          <ReadField
            label="Item Code"
            size="sm"
            value={
              detail.itemCode ? (
                <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                  {detail.itemCode}
                </span>
              ) : null
            }
          />
          <ReadField label="Item Name" size="lg" value={detail.itemName} />
          <ReadField label="Order Qty" size="sm" mono value={detail.orderQty} />
          <ReadField label="Plan Qty" size="sm" mono value={detail.planQty} />
          <ReadField
            label="BOM No."
            size="sm"
            value={
              <Link to="/ml-boms/$id" params={{ id: detail.mlBomId }} className="td-code">
                {detail.mlBomCode}
              </Link>
            }
          />
          <ReadField label="BOM Rev" size="sm" mono value={detail.mlBomRevision} />
          <ReadField label="Snapshot At" size="sm" mono value={fmtDateTime(detail.snapshotAt)} />
          <ReadField label="Remarks" size="full" pre value={detail.remarks} />
        </ReadGrid>
        {actionError ? (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <Banner tone="error" role="alert" flush onDismiss={() => setActionError(null)}>
              {actionError}
            </Banner>
          </div>
        ) : null}
      </DetailHeader>

      <TabStrip
        tabs={tabs}
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        label="Multi-Level Plan"
      />
      <Panel bodyPadding="none">
        {tab === 'plan' ? (
          <>
            {canRaise ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  padding: 'var(--sp-2) var(--sp-3)',
                }}
              >
                <Button variant="primary" size="sm" onClick={() => setRaiseOpen(true)}>
                  Raise Orders
                </Button>
              </div>
            ) : null}
            <MlPlanNodesTable nodes={detail.nodes} />
          </>
        ) : null}
        {tab === 'orders' ? (
          <MlPlanOrdersTable orders={detail.orders} nodes={detail.nodes} />
        ) : null}
        {tab === 'history' ? (
          <DocumentHistory entity="MlPlan" entityId={detail.id} refId={detail.code} />
        ) : null}
      </Panel>

      {raiseOpen ? <RaiseOrdersModal detail={detail} onClose={() => setRaiseOpen(false)} /> : null}
      {confirmCancel ? (
        <CancelMlPlanDialog
          plan={detail}
          onDone={() => setConfirmCancel(false)}
          onCancel={() => setConfirmCancel(false)}
        />
      ) : null}
    </div>
  );
}
