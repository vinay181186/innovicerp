// JC Status — the VIEW body, laid out to the owner-approved mock-up
// jobcard-detail-mockup.html (frame 1, 2026-10-06): one 1440×810 screen, no
// page scroll.
//
//   header     ← Back · JC No. · Job Card · JC status badge ·
//              Print · Edit · ⋯ (Download Excel) · ▶ Production Entry
//   banners    short-closed Production Order stop (ADR-182) · rework / repair
//              child note — both null on an ordinary card, both unchanged
//   facts      picture frame (Photo | Drawing) + identity line + ClusterGrid:
//              ORDER · QUANTITY · MATERIAL · NOTES (jc-fact-block.tsx)
//   tabs       ONE tab strip + ONE filling panel, "Current Op" at its right:
//              Operations (JcOpsTable — the old op cards, Route / Operation
//              Flow strip and Op Qty Flow panel in one table) · Documents &
//              Quality (+ Rework Tree) · Material · Related Records · History
//
// Same data hooks and permission gates as before (useJobCard, useJcOpsEnriched,
// useOpLog, useJobCardStatusExtras, useJobCardEditModel for the live drawing,
// useMyCompany for the print, useProductionOrderForJobCard for the stop rule,
// jc_create.edit for Edit). The Quantity cluster reads the server's Job Card
// check (useOpFlow — the same query the Operations table reads, so one
// request). EDIT mode is untouched — it lives in jc-status-content.tsx.
import type { OpLog } from '@innovic/shared';
import { isProductionOrderStopped } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useOpFlow } from '@/modules/flow-views/api';
import { ReworkTreePanel } from '@/modules/flow-views/components/jc-flow-panels';
import { JcMaterialPanel } from '@/modules/material/components/jc-material-panel';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { useProductionOrderForJobCard } from '@/modules/production-orders/api';
import { useMyCompany } from '@/modules/settings/api';
import { Panel } from '@/ui/data';
import { ActionMenu, DetailHeader } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useJobCard, useJobCardEditModel, useJobCardStatusExtras } from '../api';
import { useJcDrawing } from '../lib/jc-drawing';
import { exportJobCardExcel } from '../lib/export-job-card-excel';
import { printJobCard } from '../lib/print-job-card';
import { JcFactBlock } from './jc-fact-block';
import { JcHistoryTable } from './jc-history-table';
import { JcOpsTable } from './jc-ops-table';
import { RecoveryBanner } from './jc-recovery-banner';
import { JcStatusBadge } from './jc-status-badge';
import { JcStoppedBanner } from './jc-stopped-banner';
import { JcCurrentOpMeta } from './jc-view-summary';
import { JcDocumentsTab } from './jc-view-tabs';
import './jc-detail.css';

type TabKey = 'ops' | 'docs' | 'material' | 'related' | 'history';
const TAB_KEYS: readonly TabKey[] = ['ops', 'docs', 'material', 'related', 'history'];

export function JcStatusViewContent({ id }: { id: string }): React.JSX.Element {
  const navigate = useNavigate();
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  // `opsLoading` gates the Print button: the ops come from their own query, so
  // a click landing between "job card loaded" and "ops loaded" printed a Job
  // Card whose Operation Routing table said "No operations".
  const { data: opsData, isLoading: opsLoading } = useJcOpsEnriched(
    { jobCardId: id },
    { enabled: Boolean(id) },
  );
  const ops = useMemo(() => opsData ?? [], [opsData]);
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 300 }, { enabled: Boolean(id) });
  // Server-computed extras: QC docs, per-op machine name + tool details, and the
  // merged completion feed (op_log ∪ NC ∪ OSP) with a real total (ISSUE-174).
  const { data: extras } = useJobCardStatusExtras(id);
  const { data: company } = useMyCompany();
  // ADR-212 — the server's reconciled per-op figures and the Job Card check
  // (ordered = finished + pending + in QC + at vendor + deviated open +
  // rejected). The Quantity cluster reads ONLY this; the Operations table reads
  // the same query (same key), so it is one request.
  const opFlow = useOpFlow(id);
  // ADR-182 — the Production Order that built this card. Two things come off
  // it: whether it was SHORT CLOSED (which freezes the card, so every work
  // button here goes away — the server refuses them anyway) and the `Actual
  // Size` the store really cut. A rework / repair child carries no
  // production_order_id of its own, so the hook walks up the parent chain the
  // same way the server-side stop guard does. Null only on a hand-raised card
  // or a pre-ADR-170 card.
  const { order: productionOrder } = useProductionOrderForJobCard(id);
  const stopped = productionOrder ? isProductionOrderStopped(productionOrder.status) : false;
  // Edit button uses the SAME key as the page it opens (/job-cards/$id/edit →
  // jc_create edit). Hidden until the access matrix has loaded.
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;

  // ADR-202 — the edit(s) staged against this Job Card and still waiting for a
  // decision. Their per-field changes drive the amber chips on the facts.
  const pendingEdit = usePendingEditForDoc('JobCard', id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);

  const [tab, setTab] = useState<TabKey>('ops');
  const [drawingPreviewOpen, setDrawingPreviewOpen] = useState(false);

  // WHICH DRAWING THIS SCREEN SHOWS — SO line's drawing, else the JWSO line's,
  // else this card's own upload (first that exists; no item-master fallback —
  // items carry a product image, not a drawing). Resolved LIVE off the source
  // line by the edit model, so a corrected print uploaded against the order is
  // what the floor sees on the next refresh. Resolution + thumbnail live in
  // useJcDrawing so the EDIT screen shows exactly the same drawing.
  const { data: model } = useJobCardEditModel(id);
  const { drawing, drawingRef } = useJcDrawing(jc, model);

  const sortedOps = useMemo(() => [...ops].sort((a, b) => a.opSeq - b.opSeq), [ops]);
  const logsByOp = useMemo(() => {
    const m = new Map<string, OpLog[]>();
    for (const l of logs) {
      const arr = m.get(l.jcOpId) ?? [];
      arr.push(l);
      m.set(l.jcOpId, arr);
    }
    // Latest first — by date, then by the time on that date.
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          b.logDate.localeCompare(a.logDate) ||
          (b.startTime ?? '').localeCompare(a.startTime ?? ''),
      );
    }
    return m;
  }, [logs]);

  if (isLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || !jc) {
    return (
      <div className="empty-state" style={{ color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Job Card not found.'}
      </div>
    );
  }

  const openOpEntry = (): void => void navigate({ to: '/op-entry', search: { jc: jc.code } });
  const openDrawing = (): void => setDrawingPreviewOpen(true);

  return (
    <div className="page-fill jc-detail">
      <DetailHeader
        backLabel="Back"
        backTo="/job-cards"
        renderLink={(p) => <Link {...p} />}
        code={jc.code}
        // One header line: code · document name · status (as the Production
        // Order page draws it — DetailHeader's `name` would take a 2nd line).
        badges={
          <>
            <span className="panel-title">Job Card</span>
            <JcStatusBadge status={jc.computedStatus} />
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={opsLoading}
              title="Print Job Card"
              onClick={() => {
                if (
                  !printJobCard({
                    jc,
                    ops,
                    company,
                    actualSize: productionOrder?.actualSize ?? null,
                  })
                )
                  window.alert('Allow popups to print.');
              }}
            >
              Print
            </button>
            {/* ADR-182 — a stopped order's card takes no more edits. The
                server refuses them anyway. */}
            {canWrite && !stopped ? (
              <Link
                to="/job-cards/$id/edit"
                params={{ id }}
                className="btn btn-ghost btn-sm"
                title="Edit Job Card"
              >
                Edit
              </Link>
            ) : null}
            <ActionMenu
              label="⋯"
              items={[
                {
                  label: 'Download Excel',
                  title: 'Download Excel (with production log)',
                  onClick: () => exportJobCardExcel({ jc, ops, logs }),
                },
              ]}
            />
            {/* ADR-182 — no more work on a stopped order's card. */}
            {!stopped ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={openOpEntry}>
                ▶ Production Entry
              </button>
            ) : null}
          </>
        }
      >
        {/* Banners — the short-closed Production Order stop (ADR-182) and the
            rework / repair child note. Both null on an ordinary card. */}
        <JcStoppedBanner order={productionOrder} />
        <RecoveryBanner jc={jc} />
        <JcFactBlock
          jc={jc}
          productionOrder={productionOrder}
          drawing={drawingRef}
          onOpenDrawing={openDrawing}
          pendingChanges={pendingChanges}
          check={opFlow.data?.jobCardCheck}
          checkError={opFlow.isError}
        />
      </DetailHeader>
      {drawingPreviewOpen && drawing ? (
        <FilePreviewModal
          storagePath={drawing.path}
          kind="drawing"
          source={drawing.source}
          refCode={jc.code}
          onClose={() => setDrawingPreviewOpen(false)}
        />
      ) : null}

      {/* The one panel that takes the height left on screen. */}
      <div className="jc-tabs">
        <TabStrip
          label="Job Card lists"
          activeKey={tab}
          onChange={(k) => setTab(TAB_KEYS.find((t) => t === k) ?? 'ops')}
          tabs={[
            { key: 'ops', label: 'Operations', count: opsData ? sortedOps.length : null },
            { key: 'docs', label: 'Documents & Quality' },
            { key: 'material', label: 'Material' },
            { key: 'related', label: 'Related Records' },
            {
              key: 'history',
              label: 'History',
              count: extras ? extras.completionLog.total : null,
            },
          ]}
        />
        <span className="jc-tabs-meta">
          <span>
            <JcCurrentOpMeta sortedOps={sortedOps} />
          </span>
        </span>
      </div>
      <Panel fill bodyPadding="none">
        {tab === 'ops' ? (
          <JcOpsTable
            jobCardId={id}
            jc={jc}
            ops={sortedOps}
            logsByOp={logsByOp}
            stopped={stopped}
            productionOrder={productionOrder}
          />
        ) : tab === 'docs' ? (
          <div className="jc-tab-pad">
            <JcDocumentsTab jc={jc} ops={ops} extras={extras} stopped={stopped} />
            {/* Rework Tree — moved here from under the Op Qty Flow panel.
                Renders nothing on a plain card with no NC and no child. */}
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <ReworkTreePanel jobCardId={id} />
            </div>
          </div>
        ) : tab === 'material' ? (
          <div className="jc-tab-pad">
            <JcMaterialPanel jobCardId={jc.id} stopped={stopped} />
          </div>
        ) : tab === 'related' ? (
          <div className="jc-tab-pad">
            <RelatedDocsPanel module="job-cards" id={jc.id} />
          </div>
        ) : (
          <JcHistoryTable jobCardId={id} />
        )}
      </Panel>
    </div>
  );
}
