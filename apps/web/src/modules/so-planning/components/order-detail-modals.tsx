// The modal cascade for the per-order Planning detail (PL-4b): Create Plan /
// Raise PR / Allocate / Release / Equipment & Assembly BOM planning. Split out
// of routes/workflow.tsx (ADR-199 table standard) so the detail view stays under
// the 400-line rule — this is the plan-create cascade, left exactly as it was.

import type { PlanDerivedStatus, PlanningDetailResponse } from '@innovic/shared';
import { BomPlanningModal } from './bom-planning-modal';
import { CreatePlanModal } from './create-plan-modal';
import { RaisePrModal } from './raise-pr-modal';
import { AllocateStockModal, ReleaseStockModal, lineFacts } from './reservation-modals';
import type { ModalState } from './planning-shared';

export interface SavedPlanNote {
  id: string;
  code: string;
  where: string;
  derivedStatus: PlanDerivedStatus | null;
  itemId: string | null;
  itemCode: string;
  itemName: string;
}

export interface StockNote {
  what: string;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
}

export function OrderDetailModals({
  so,
  modal,
  setModal,
  refresh,
  setSavedPlan,
  setStockNote,
}: {
  so: PlanningDetailResponse;
  modal: ModalState;
  setModal: (m: ModalState) => void;
  refresh: () => void;
  setSavedPlan: (n: SavedPlanNote) => void;
  setStockNote: (n: StockNote) => void;
}): JSX.Element {
  return (
    <>
      {modal.kind === 'create' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <CreatePlanModal
              so={so}
              line={targetLine}
              onClose={() => setModal({ kind: 'none' })}
              onCreated={(plan) => {
                // The plan is complete as saved (route-card flow) — no edit
                // modal to chain into. Close, refresh the lines and offer the
                // next step (Create Production Order →) in a banner.
                setSavedPlan({
                  id: plan.id,
                  code: plan.code,
                  where: `${so.soCode} Ln ${targetLine.lineNo}`,
                  derivedStatus: plan.derivedStatus ?? null,
                  itemId: plan.itemId ?? null,
                  itemCode: plan.itemCodeText ?? '',
                  itemName: plan.itemNameText ?? '',
                });
                setModal({ kind: 'none' });
                refresh();
              }}
            />
          );
        })()}

      {modal.kind === 'raise-pr' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <RaisePrModal
              so={so}
              line={targetLine}
              onClose={() => setModal({ kind: 'none' })}
              onRaised={() => {
                // The PR is a Purchase document from here on; the refreshed
                // line shows it as a chip.
                setModal({ kind: 'none' });
                refresh();
              }}
            />
          );
        })()}

      {/* ADR-180 — Allocate / Release. Both read the post-action Physical /
          Reserved / Available straight off the response, so the strip under
          the header shows the new position without waiting for a refetch. */}
      {modal.kind === 'allocate' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <AllocateStockModal
              facts={lineFacts(so.soCode, targetLine)}
              onClose={() => setModal({ kind: 'none' })}
              onDone={(result) => {
                setModal({ kind: 'none' });
                setStockNote({
                  what: `Allocated ${result.qtyMoved} pcs to Ln ${targetLine.lineNo}`,
                  physicalQty: result.physicalQty,
                  reservedQty: result.reservedQty,
                  availableQty: result.availableQty,
                });
                refresh();
              }}
            />
          );
        })()}

      {modal.kind === 'release' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <ReleaseStockModal
              facts={lineFacts(so.soCode, targetLine)}
              onClose={() => setModal({ kind: 'none' })}
              onDone={(result) => {
                setModal({ kind: 'none' });
                setStockNote({
                  what: `Released ${result.qtyMoved} pcs from Ln ${targetLine.lineNo}`,
                  physicalQty: result.physicalQty,
                  reservedQty: result.reservedQty,
                  availableQty: result.availableQty,
                });
                refresh();
              }}
            />
          );
        })()}

      {modal.kind === 'equip-bom' && (
        <BomPlanningModal
          mode="equipment"
          soId={so.soId}
          soCode={so.soCode}
          soLineId={modal.soLineId}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refresh();
          }}
        />
      )}

      {modal.kind === 'assembly-bom' && (
        <BomPlanningModal
          mode="assembly"
          soId={so.soId}
          soCode={so.soCode}
          soLineId={modal.soLineId}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refresh();
          }}
        />
      )}
    </>
  );
}
