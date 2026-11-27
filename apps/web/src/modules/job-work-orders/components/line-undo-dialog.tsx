// ADR-324 — the Undo list of ONE JWSO line, opened from the trash button of an
// in-use line on JWSO edit. One screen to undo everything still holding a line
// that was entered by mistake (owner-approved mockup, 2026-11-26).
//
//   1. "How did this happen?" — Entered by mistake (undo here) / Work was real
//      (keep the history: Short-close on the JWSO page; nothing is undone here).
//      → line-undo-choice.tsx
//   2. Mistake → the server's list, newest step first. One Reason for every
//      step. Only the FIRST step can run, and only while it is "To do"; a step
//      waiting for approval or one that must be done on its own screen pauses
//      everything below it. "Undo all I can ▶" runs step 1, re-reads the list
//      and repeats until it is empty, paused, or a call fails.
//      → line-undo-steps.tsx draws it; THIS file owns the state and the run loop.
//   3. Empty list → "Remove Ln N" takes the line off the form; the user Saves
//      the JWSO as today.
//
// The screen decides nothing: whether the caller may undo (`canUndo`), the
// order, each step's approval and blockers are the server's. Every step still
// runs through that document's own service.
//
// Double-click (CLAUDE.md §20): a ref flips the instant a run starts, every
// button is disabled while it runs, and each call carries its own Idempotency
// key (useSaveKey + withSaveKey, which rotates the key after each answer).
//
// Refresh (§22.4): a step touches other modules' data, so the roots of every
// screen that shows it are refreshed HERE, through their factories. This file
// is a leaf: no api.ts imports it, so these imports cannot form a load cycle.

import type { JwLineUndoList } from '@innovic/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { approvalsKeys } from '@/modules/approvals/api';
import { cancelKeys } from '@/modules/cancel-requests/api';
import { dashboardKeys } from '@/modules/dashboard/api';
import { jcOpsBoardKeys } from '@/modules/jc-ops/api';
import { jobCardsKeys } from '@/modules/job-cards/api';
import { ncRegisterKeys } from '@/modules/nc-register/api';
import { opEntryKeys } from '@/modules/op-entry/api';
import { opLogKeys } from '@/modules/op-log/api';
import { partyGrnKeys } from '@/modules/party-grn/api';
import { partyMaterialIssuesKeys } from '@/modules/party-material-issues/api';
import { partyMaterialsKeys } from '@/modules/party-materials/api';
import { partyStockLedgerKeys } from '@/modules/party-stock-ledger/api';
import { plansKeys } from '@/modules/plans/api';
import { productionOrdersKeys } from '@/modules/production-orders/api';
import { Banner, Modal, useToast } from '@/ui/feedback';
import { useJwLineUndoList, useRunLineUndoStep } from '../api';
import { LINE_UNDO_TEXT, LineUndoChoice, LineUndoWorkWasReal } from './line-undo-choice';
import { type DoneStep, DoneNowList, LineUndoSteps } from './line-undo-steps';

/** The roots of every screen a step can change: the Op Log entry and its Job
 *  Card / operation / PRO / Plan, a Customer Material Issue and the customer
 *  material register, a Party GRN line, an NC decision, a Cancel Request and
 *  the Approvals queue (the JWSO's own roots are refreshed by the hook). */
function invalidateTouched(qc: QueryClient): void {
  for (const queryKey of [
    opLogKeys.all,
    opEntryKeys.all,
    jcOpsBoardKeys.all,
    jobCardsKeys.all,
    productionOrdersKeys.all,
    plansKeys.all,
    partyMaterialIssuesKeys.all,
    partyMaterialsKeys.all,
    partyStockLedgerKeys.all,
    partyGrnKeys.all,
    ncRegisterKeys.all,
    cancelKeys.all,
    approvalsKeys.all,
    dashboardKeys.all,
  ]) {
    void qc.invalidateQueries({ queryKey });
  }
}

export interface LineUndoDialogProps {
  jobWorkOrderId: string;
  /** JWSO No., for the title "Undo Ln <n> — <JW No.>" (NAMING.md). */
  jwCode: string;
  /** The SAVED line's id (the form value `id`, not react-hook-form's row key). */
  lineId: string;
  lineNo: number;
  /** Nothing holds the line any more: take it off the form (Save as today). */
  onRemovable: () => void;
  onClose: () => void;
}

export function LineUndoDialog({
  jobWorkOrderId,
  jwCode,
  lineId,
  lineNo,
  onRemovable,
  onClose,
}: LineUndoDialogProps): React.JSX.Element {
  // Every hook sits at the top, above any branch (CLAUDE.md §23).
  const [phase, setPhase] = useState<'ask' | 'mistake' | 'real'>('ask');
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [doneNow, setDoneNow] = useState<DoneStep[]>([]);
  const inFlight = useRef(false);
  const list = useJwLineUndoList(jobWorkOrderId, lineId, true);
  const saveKey = useSaveKey();
  const runStep = useRunLineUndoStep(jobWorkOrderId, lineId, saveKey);
  const qc = useQueryClient();
  const toast = useToast();

  const data = list.data;
  const steps = data?.steps ?? [];
  const canUndo = data?.canUndo === true;
  const trimmed = reason.trim();
  const ln = `Ln ${lineNo}`;

  /** Run the first open step; with `all`, keep going until the list is empty,
   *  paused (waiting approval / do it on its screen) or a call fails. Steps
   *  already done stay done. */
  async function run(all: boolean): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setRunError(null);
    try {
      let current: JwLineUndoList | undefined = data;
      // A ceiling only against a server that keeps answering "done" for a step
      // it still lists; the list itself is the real stop.
      for (let guard = 0; guard < 100; guard += 1) {
        const step = current?.steps[0];
        // Only a "To do" first step runs — never a waiting or manual one.
        if (!current?.canUndo || !step || step.state !== 'todo') break;
        const res = await runStep.mutateAsync({ stepKey: step.key, reason: trimmed });
        invalidateTouched(qc);
        setDoneNow((prev) => [
          ...prev,
          { key: step.key, docCode: step.docCode, message: res.message },
        ]);
        if (res.outcome === 'requested') toast.info(res.message);
        else toast.ok(res.message);
        const fresh = await list.refetch();
        if (fresh.isError || !fresh.data) {
          throw fresh.error ?? new Error('Could not re-read the Undo list. Open it again.');
        }
        current = fresh.data;
        const next = current.steps[0];
        if (res.outcome === 'done' && next?.key === step.key && next.state === 'todo') {
          throw new Error(
            `${step.docCode} is still listed after it was undone. Close and open this list again.`,
          );
        }
        if (!all) break;
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Could not run the step. Try again.');
      void list.refetch();
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  const firstRunnable = canUndo && steps[0]?.state === 'todo';
  const btnClose = (
    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={running}>
      Close
    </button>
  );
  let body: React.ReactNode;
  let footer: React.ReactNode = btnClose;

  if (phase === 'ask') {
    body = <LineUndoChoice onMistake={() => setPhase('mistake')} onReal={() => setPhase('real')} />;
  } else if (phase === 'real') {
    body = <LineUndoWorkWasReal jobWorkOrderId={jobWorkOrderId} jwCode={jwCode} ln={ln} />;
    footer = (
      <>
        <button type="button" className="btn btn-ghost" onClick={() => setPhase('ask')}>
          Back
        </button>
        {btnClose}
      </>
    );
  } else if (list.isLoading) {
    body = <div style={LINE_UNDO_TEXT}>Checking what still holds {ln}…</div>;
  } else if (list.isError || !data) {
    body = (
      <Banner tone="error" role="alert" flush>
        {list.error instanceof Error ? list.error.message : `Could not read what holds ${ln}.`}
      </Banner>
    );
  } else if (steps.length === 0) {
    body = (
      <>
        <DoneNowList doneNow={doneNow} />
        <Banner tone="success" flush>
          Nothing holds {ln} any more.
        </Banner>
      </>
    );
    footer = (
      <>
        {btnClose}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onRemovable();
            onClose();
          }}
        >
          Remove {ln}
        </button>
      </>
    );
  } else {
    body = (
      <LineUndoSteps
        data={data}
        ln={ln}
        reason={reason}
        onReason={setReason}
        running={running}
        runError={runError}
        doneNow={doneNow}
        onRunOne={() => void run(false)}
      />
    );
    if (canUndo) {
      footer = (
        <>
          {btnClose}
          <span
            title={
              !firstRunnable
                ? 'Step 1 cannot run from here'
                : !trimmed
                  ? 'Type the reason first'
                  : undefined
            }
          >
            <button
              type="button"
              className="btn btn-primary"
              disabled={!firstRunnable || !trimmed || running}
              onClick={() => void run(true)}
            >
              {running ? 'Working…' : 'Undo all I can ▶'}
            </button>
          </span>
        </>
      );
    }
  }

  return (
    <Modal
      title={`Undo ${ln} — ${jwCode}`}
      size="lg"
      onClose={onClose}
      closeLocked={running}
      // Steps already run are saved; only an unused typed reason can be lost.
      confirmExit={trimmed !== '' && doneNow.length === 0}
      footer={footer}
    >
      {body}
    </Modal>
  );
}
