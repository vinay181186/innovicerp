// ADR-324 — the steps part of the JWSO line Undo list (line-undo-dialog.tsx):
// the Reason box, progress, the "Done now" list, the pause / read-only banners
// and the steps table. No hooks and no state: the dialog owns the reason, the
// run loop and what is running; this file only draws them.
//
// A step's button exists only on a "To do" row, and is enabled only on the
// FIRST row. A 'manual' step (e.g. the backend's `manual:<jcId>:<n>`, docType
// possibly null, docId = the Job Card) never gets a button: it shows its
// reason and Open ↗ only.

import type { JwLineUndoList, LineUndoStep } from '@innovic/shared';
import { ActionLink } from '@/components/shared/action-link';
import { linkProps } from '@/modules/dashboard/components/dash-text';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { LINE_UNDO_TEXT } from './line-undo-choice';

/** A step finished in this session of the dialog. */
export interface DoneStep {
  key: string;
  docCode: string;
  message: string;
}

const XS: React.CSSProperties = { fontSize: 'var(--fs-xs)' };

/** "Open ↗" to a step's document, in a new tab; nothing when the caller may
 *  not open that page (ADR-234). */
function OpenLink({
  step,
  small,
}: {
  step: LineUndoStep;
  small?: boolean;
}): React.JSX.Element | null {
  if (!step.href) return null;
  return (
    <>
      {' '}
      <ActionLink
        {...linkProps(step.href)}
        check={step.href}
        target="_blank"
        rel="noreferrer"
        className={small ? 'text3' : 'fw-700'}
        {...(small ? { style: XS } : {})}
        title={`Open ${step.docCode} in a new tab`}
      >
        Open ↗
      </ActionLink>
    </>
  );
}

/** ✓ docCode — message, for every step finished in this session. */
export function DoneNowList({ doneNow }: { doneNow: DoneStep[] }): React.JSX.Element | null {
  if (doneNow.length === 0) return null;
  return (
    <div style={{ ...LINE_UNDO_TEXT, marginBottom: 'var(--sp-2)' }}>
      <div className="fw-700">Done now</div>
      {doneNow.map((d) => (
        <div key={d.key}>
          <span style={{ color: 'var(--green2)' }}>✓</span>{' '}
          <span className="mono fw-700">{d.docCode}</span> — {d.message}
        </div>
      ))}
    </div>
  );
}

function stepColumns(p: {
  canUndo: boolean;
  reasonTyped: boolean;
  running: boolean;
  onRunOne: () => void;
}): DataTableColumn<LineUndoStep>[] {
  const cols: DataTableColumn<LineUndoStep>[] = [
    {
      id: 'step_no',
      header: '#',
      kind: 'num',
      nowrap: true,
      className: 'mono',
      render: (_s, i) => i + 1,
    },
    {
      id: 'document',
      header: 'Document',
      kind: 'code',
      nowrap: true,
      title: (s) => s.docLabel,
      render: (s) => (
        <>
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {s.docCode}
          </span>
          <OpenLink step={s} small />
          <div className="text3" style={XS}>
            {s.docLabel}
          </div>
        </>
      ),
    },
    {
      id: 'what_happens',
      header: 'What happens',
      ellipsis: true,
      title: (s) => s.whatHappens,
      render: (s) => s.whatHappens,
    },
    {
      id: 'approval',
      header: 'Approval',
      nowrap: true,
      render: (s) => (s.needsApproval ? 'Approver' : <span className="text3">—</span>),
    },
    {
      id: 'step_status',
      header: 'Step Status',
      kind: 'badge',
      render: (s) =>
        s.state === 'todo' ? (
          <span className="badge b-blue">To do</span>
        ) : s.state === 'waiting_approval' ? (
          <span className="badge b-orange">Waiting approval</span>
        ) : (
          <>
            <span className="badge b-grey">Do it on its screen</span>
            {s.manualReason ? (
              <div className="text3" style={XS}>
                {s.manualReason}
              </div>
            ) : null}
          </>
        ),
    },
  ];
  if (!p.canUndo) return cols;
  cols.push({
    id: 'action',
    header: 'Action',
    kind: 'control',
    nowrap: true,
    stopRowClick: true,
    render: (s, i) => {
      // Only a "To do" step has a button; waiting / manual rows show none.
      if (s.state !== 'todo') return <span className="text3">—</span>;
      const why =
        i !== 0
          ? 'Do step 1 first'
          : !p.reasonTyped
            ? 'Type the reason first'
            : p.running
              ? 'Working…'
              : undefined;
      return (
        <span title={why}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={why !== undefined}
            onClick={p.onRunOne}
          >
            {s.actionLabel}
          </button>
        </span>
      );
    },
  });
  return cols;
}

/** The pause banner when step 1 cannot run from here. */
function PauseBanner({ first }: { first: LineUndoStep | undefined }): React.JSX.Element | null {
  if (first?.state === 'waiting_approval') {
    return (
      <Banner tone="warn" flush>
        Paused — <b className="mono">{first.docCode}</b> is waiting for approval. You are notified
        when it is decided; open this list again to continue.
      </Banner>
    );
  }
  if (first?.state === 'manual') {
    return (
      <Banner tone="warn" flush>
        {first.manualReason ?? `${first.docCode} has to be undone on its own screen.`}
        <OpenLink step={first} />
      </Banner>
    );
  }
  return null;
}

export function LineUndoSteps({
  data,
  ln,
  reason,
  onReason,
  running,
  runError,
  doneNow,
  onRunOne,
}: {
  data: JwLineUndoList;
  /** "Ln <n>" */
  ln: string;
  reason: string;
  onReason: (v: string) => void;
  running: boolean;
  runError: string | null;
  doneNow: DoneStep[];
  onRunOne: () => void;
}): React.JSX.Element {
  const { canUndo, steps } = data;
  const holders = data.undoHolders.join(', ');
  const columns = stepColumns({
    canUndo,
    reasonTyped: reason.trim() !== '',
    running,
    onRunOne,
  });
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      {!canUndo ? (
        <Banner tone="info" flush>
          {holders
            ? `Only ${holders} can undo from here — ask them.`
            : 'Nobody holds the Undo chain right yet — ask a Super Admin to set it in Access Control.'}
        </Banner>
      ) : (
        <div className="form-grp">
          <label className="form-label" htmlFor="line-undo-reason">
            Reason — used for every step<span className="req">★</span>
          </label>
          <textarea
            id="line-undo-reason"
            className="innovic-input"
            rows={2}
            maxLength={500}
            autoFocus
            disabled={running}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder={`Why is ${ln} being undone?`}
          />
        </div>
      )}
      {canUndo ? (
        <div className="text3" style={XS}>
          {doneNow.length} done · {steps.length} left
        </div>
      ) : null}
      <DoneNowList doneNow={doneNow} />
      <PauseBanner first={steps[0]} />
      {runError ? (
        <Banner tone="error" role="alert" flush>
          {runError}
        </Banner>
      ) : null}
      <DataTable<LineUndoStep>
        tableKey={TABLE_KEYS.jwLineUndo}
        columns={columns}
        rows={steps}
        rowKey={(s) => s.key}
        maxHeight={360}
        emptyText={`Nothing holds ${ln} any more.`}
      />
    </div>
  );
}
