// Multi-Level BOM detail (ADR-225): DetailHeader (BOM No. · Default · Edit +
// Actions) with the header facts, then ONE tab strip — Lines · Tree ·
// Exploded Items · Cost · Used In · History. Cost (phase 6) shows only to a
// user who may see prices on mlbom_create (the web twin of canSeeFormPrice);
// Actions → Print (phase 5) prints the tree for the Qty on the Tree tab.
//
// The tabs use <TabStrip> directly, not RelatedDocsTabs: that wrapper reads
// GET /<module>/:id/related, which this document does not have, and hides
// itself entirely when the request fails.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useDocumentHistory } from '@/modules/activity-log/api';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { Panel } from '@/ui/data';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { ActionMenu, DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { TabStrip, type TabStripTab } from '@/ui/navigation';
import {
  fetchMlBomTree,
  useDeleteMlBom,
  useMakeDefaultMlBom,
  useMlBom,
  useMlBomCost,
  useMlBomTree,
} from '../api';
import { MlBomCostTab } from '../components/ml-bom-cost-tab';
import {
  MlBomExplodedTab,
  MlBomLinesTab,
  MlBomTreeTab,
  MlBomUsedInTab,
} from '../components/ml-bom-detail-tabs';
import { openMlPrintWindow } from '../lib/ml-sheet-print';
import { printMlBom } from '../lib/print-ml-bom';

export const mlBomDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-boms/$id',
  component: MlBomDetailPage,
});

type TabKey = 'lines' | 'tree' | 'exploded' | 'cost' | 'used-in' | 'history';
const MAX_TREE_QTY = 1_000_000;

function MlBomDetailPage(): React.JSX.Element {
  const { id } = mlBomDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useMlBom(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlbom_create');
  const makeDefault = useMakeDefaultMlBom();
  const del = useDeleteMlBom();
  const [tab, setTab] = useState<TabKey>('lines');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // ADR-197: a delete carries a reason — it is the Reason on the History row.
  const [deleteReason, setDeleteReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Tree qty: the box shows each keystroke; the query follows 300ms later.
  const [qtyInput, setQtyInput] = useState('1');
  const [qty, setQty] = useState(1);
  useEffect(() => {
    const n = Number(qtyInput);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_TREE_QTY) return;
    const t = window.setTimeout(() => setQty(n), 300);
    return () => window.clearTimeout(t);
  }, [qtyInput]);
  const qtyBad = (() => {
    const n = Number(qtyInput);
    return !Number.isFinite(n) || n <= 0 || n > MAX_TREE_QTY;
  })();

  const canSeePrice = perms.price;
  const costOpen = tab === 'cost' && canSeePrice;
  const treeOpen = tab === 'tree' || tab === 'exploded';
  const [printing, setPrinting] = useState(false);
  const tree = useMlBomTree(detail?.id, qty, treeOpen);
  const cost = useMlBomCost(detail?.id, qty, costOpen);
  const { data: company } = useMyCompany();
  const queryClient = useQueryClient();
  const history = useDocumentHistory({
    entity: 'MlBom',
    entityId: detail?.id,
    refId: detail?.code,
  });

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }
  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading BOM…" />;
  }
  if (isError || !detail) {
    return (
      <div>
        <Link
          to="/ml-boms"
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 'var(--sp-2)' }}
        >
          <Icon name="arrow-left" size={14} /> Back
        </Link>
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'BOM not found.'}
        />
      </div>
    );
  }

  const onMakeDefault = (): void => {
    setActionError(null);
    makeDefault.mutate(
      { id: detail.id, expectedUpdatedAt: detail.updatedAt },
      { onError: (e) => setActionError(e.message) },
    );
  };

  // Print the Qty shown in the box, exactly. The window opens here, inside
  // the click, so no pop-up blocker stops it; the tree is then asked fresh
  // and written into it. A failure closes it and shows in the Banner.
  const onPrint = (): void => {
    setActionError(null);
    if (qtyBad) {
      setActionError('Fix Qty first.');
      return;
    }
    const printQty = Number(qtyInput);
    const w = openMlPrintWindow();
    if (!w) {
      setActionError('Allow popups to print.');
      return;
    }
    setPrinting(true);
    fetchMlBomTree(queryClient, detail.id, printQty)
      .then((data) => {
        if (!printMlBom({ detail, tree: data, company, target: w })) {
          w.close();
          setActionError('Allow popups to print.');
        }
      })
      .catch((e: unknown) => {
        w.close();
        setActionError(e instanceof Error ? e.message : 'Could not load the BOM tree.');
      })
      .finally(() => setPrinting(false));
  };

  const onDelete = async (): Promise<void> => {
    const reason = deleteReason.trim();
    // Thrown, so ConfirmDialog shows it inside the dialog and stays open.
    if (!reason) throw new Error('Reason is required.');
    await del.mutateAsync({ id: detail.id, reason });
    setConfirmDelete(false);
    void navigate({ to: '/ml-boms', replace: true });
  };

  const tabs: TabStripTab[] = [
    { key: 'lines', label: 'Lines', count: detail.lines.length },
    { key: 'tree', label: 'Tree', count: null },
    { key: 'exploded', label: 'Exploded Items', count: tree.data?.exploded.length ?? null },
    ...(canSeePrice ? [{ key: 'cost', label: 'Cost', count: null }] : []),
    { key: 'used-in', label: 'Used In', count: detail.usedIn.length },
    { key: 'history', label: 'History', count: history.data?.rows.length ?? null },
  ];
  const treeProps = {
    tree: tree.data,
    loading: tree.isLoading || tree.isFetching,
    error: tree.error,
  };

  return (
    <div>
      <DetailHeader
        backTo="/ml-boms"
        renderLink={(p) => <Link {...p} />}
        code={detail.code}
        name={detail.itemName ?? undefined}
        badges={
          <>
            {detail.isDefault ? <span className="badge b-green">Default</span> : null}
            <span className="badge b-grey">BOM Rev {detail.revision}</span>
          </>
        }
        actions={
          <>
            {perms.edit ? (
              <Link
                to="/ml-boms/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-primary btn-sm"
              >
                <Icon name="pencil" size={13} /> Edit
              </Link>
            ) : null}
            <ActionMenu
              items={[
                {
                  label: 'Print',
                  disabled: printing,
                  onClick: onPrint,
                },
                {
                  label: 'Make Default',
                  hidden: !perms.edit || detail.isDefault,
                  disabled: makeDefault.isPending,
                  onClick: onMakeDefault,
                },
                {
                  label: 'Delete',
                  danger: true,
                  hidden: !(perms.edit && perms.approve),
                  disabled: del.isPending,
                  onClick: () => {
                    setDeleteReason('');
                    setConfirmDelete(true);
                  },
                },
              ]}
            />
          </>
        }
      >
        {/* Two rows of 12: 3+3+6 · 3+3+6. */}
        <ReadGrid>
          <ReadField label="BOM No." size="sm" mono value={detail.code} />
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
          <ReadField label="Default" size="sm" value={detail.isDefault ? '✓' : null} />
          <ReadField label="BOM Rev" size="sm" mono value={detail.revision} />
          <ReadField label="Remarks" size="lg" pre value={detail.remarks} />
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
        label="Multi-Level BOM"
      />
      <Panel
        bodyPadding="none"
        {...(treeOpen || costOpen
          ? {
              actions: (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <span className="form-label" style={{ margin: 0 }}>
                    Qty
                  </span>
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    max={MAX_TREE_QTY}
                    className={`innovic-input mono cl-num cl-cap${qtyBad ? ' is-bad' : ''}`}
                    aria-label="Qty"
                    title={qtyBad ? `Qty must be more than 0, at most ${MAX_TREE_QTY}` : undefined}
                    value={qtyInput}
                    onChange={(e) => setQtyInput(e.target.value)}
                  />
                </label>
              ),
            }
          : {})}
      >
        {tab === 'lines' ? <MlBomLinesTab detail={detail} /> : null}
        {tab === 'tree' ? <MlBomTreeTab {...treeProps} /> : null}
        {tab === 'exploded' ? <MlBomExplodedTab {...treeProps} /> : null}
        {costOpen ? (
          <MlBomCostTab cost={cost.data} loading={cost.isLoading} error={cost.error} />
        ) : null}
        {tab === 'used-in' ? <MlBomUsedInTab detail={detail} /> : null}
        {tab === 'history' ? (
          <DocumentHistory entity="MlBom" entityId={detail.id} refId={detail.code} />
        ) : null}
      </Panel>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move BOM ${detail.code} to Trash?`}
          message={
            <>
              You can restore it from Trash.
              <span className="form-grp" style={{ display: 'block', marginTop: 10 }}>
                <label className="form-label" htmlFor="mlbom-delete-reason">
                  Reason <span className="req">★</span>
                </label>
                <textarea
                  id="mlbom-delete-reason"
                  className="innovic-input"
                  rows={3}
                  maxLength={500}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                />
              </span>
            </>
          }
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
