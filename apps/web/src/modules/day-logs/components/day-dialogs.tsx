// Small Day Log dialogs: pick a Work Status, give a reason (Reopen / Mark
// Leave), and "Also mark TSK-xxxx Completed?" (D6 — the task is completed
// through the Task Board's own complete endpoint; if that fails the Day Log
// change stays as it is and the reason is shown).

import type { DayLogWorkStatus } from '@innovic/shared';
import { DAY_LOG_WORK_STATUSES, DAY_LOG_WORK_STATUS_LABELS } from '@innovic/shared';
import { useState } from 'react';
import { useCompleteTask } from '@/modules/tasks/api';
import { ConfirmDialog, Modal } from '@/ui/feedback';
import { errText } from '../lib/format';

export function StatusPickDialog({
  title,
  current,
  busy,
  error,
  onPick,
  onClose,
  cancelLabel = 'Cancel',
}: {
  title: string;
  current?: DayLogWorkStatus | null | undefined;
  busy: boolean;
  error: string | null;
  onPick: (s: DayLogWorkStatus) => void;
  onClose: () => void;
  cancelLabel?: string;
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
      }
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {DAY_LOG_WORK_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={s === 'completed' ? 'btn btn-primary' : 'btn btn-ghost'}
            disabled={busy || s === current}
            onClick={() => onPick(s)}
          >
            {DAY_LOG_WORK_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" style={{ color: 'var(--red2)', margin: '10px 0 0', fontSize: 13 }}>
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export function ReasonDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      closeOnOverlayClick={false}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void go()}
          >
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 8px', fontSize: 13 }}>{message}</p>
      <label className="form-label" htmlFor="dl-reason">
        Reason <span className="req">*</span>
      </label>
      <textarea
        id="dl-reason"
        className="innovic-input"
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {err ? (
        <p role="alert" style={{ color: 'var(--red2)', margin: '8px 0 0', fontSize: 13 }}>
          {err}
        </p>
      ) : null}
    </Modal>
  );
}

export function CompleteTaskDialog({
  taskId,
  code,
  onClose,
}: {
  taskId: string;
  code: string;
  onClose: (result: string | null) => void;
}): React.JSX.Element {
  const complete = useCompleteTask(taskId);
  return (
    <ConfirmDialog
      title={`Also mark ${code} Completed?`}
      message="The Day Log entry is saved. This also completes the task on the Task Board."
      confirmLabel={`Complete ${code}`}
      cancelLabel="No, keep the task open"
      pendingLabel="Completing…"
      tone="primary"
      onCancel={() => onClose(null)}
      onConfirm={async () => {
        try {
          await complete.mutateAsync({});
          onClose(`${code} marked Completed.`);
        } catch (e) {
          // D6: the day-log change is not undone; say why the task did not move.
          onClose(`${code} was not completed: ${errText(e)}`);
        }
      }}
    />
  );
}
