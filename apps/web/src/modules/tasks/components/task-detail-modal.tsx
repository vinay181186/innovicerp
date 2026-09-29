// Task Detail — the read view a row's "View" opens (ADR-176). Facts in two
// columns, then Attachments / Remarks / Timeline (task-detail-body.tsx), with
// the action buttons in the footer gated by the server-computed permissions.
// Read-only when nothing is allowed. Also the target of the Global Search
// deep link (`?task=<uuid>`).

import { useState } from 'react';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { useTaskDetail, useUpdateTaskStatus } from '../api';
import { isOpenTask } from '../lib/format';
import { CancelModal, CompleteModal, EditTaskModal, ReassignModal } from './task-action-modals';
import { TaskBody } from './task-detail-body';
import { Overlay } from './task-overlay';

type Child =
  | { kind: 'none' }
  | { kind: 'complete' }
  | { kind: 'reassign' }
  | { kind: 'cancel' }
  | { kind: 'edit' }
  | { kind: 'preview'; storagePath: string; fileName: string; fileType: string | null };

export function TaskDetailModal({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { data: t, isLoading, isError, error } = useTaskDetail(taskId);
  const [child, setChild] = useState<Child>({ kind: 'none' });
  const closeChild = (): void => setChild({ kind: 'none' });

  const startTask = useUpdateTaskStatus(taskId);
  const [actionErr, setActionErr] = useState<string | null>(null);
  async function start(): Promise<void> {
    setActionErr(null);
    try {
      await startTask.mutateAsync({ status: 'in_progress' });
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Could not start the task. Try again.');
    }
  }

  const open = t ? isOpenTask(t) : false;
  const p = t?.permissions;
  const footer = t ? (
    <>
      {actionErr ? (
        <span className="form-error" style={{ marginRight: 'auto', alignSelf: 'center' }}>
          {actionErr}
        </span>
      ) : null}
      {p?.canEdit && open ? (
        <button type="button" className="btn btn-ghost" onClick={() => setChild({ kind: 'edit' })}>
          ✏ Edit
        </button>
      ) : null}
      {p?.canReassign && open ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setChild({ kind: 'reassign' })}
        >
          👤 Reassign
        </button>
      ) : null}
      {p?.canCancel && open ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setChild({ kind: 'cancel' })}
        >
          ✖ Cancel Task
        </button>
      ) : null}
      {p?.canUpdateStatus && t.status === 'todo' ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={startTask.isPending}
          onClick={() => void start()}
        >
          ▶ Start
        </button>
      ) : null}
      {p?.canComplete && open ? (
        <button
          type="button"
          className="btn btn-success"
          onClick={() => setChild({ kind: 'complete' })}
        >
          ✅ Complete
        </button>
      ) : null}
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Close
      </button>
    </>
  ) : undefined;

  return (
    <>
      <Overlay
        title={t ? t.code : 'Task Detail'}
        size="lg"
        onClose={onClose}
        escLocked={child.kind !== 'none'}
        footer={footer}
      >
        {isLoading ? (
          <div className="empty-state">Loading…</div>
        ) : isError || !t ? (
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Task not found. Refresh the page.'}
          </div>
        ) : (
          <TaskBody
            t={t}
            onPreview={(a) =>
              setChild({
                kind: 'preview',
                storagePath: a.storagePath,
                fileName: a.fileName,
                fileType: a.fileType,
              })
            }
          />
        )}
      </Overlay>

      {t && child.kind === 'complete' ? <CompleteModal task={t} onClose={closeChild} /> : null}
      {t && child.kind === 'reassign' ? <ReassignModal task={t} onClose={closeChild} /> : null}
      {t && child.kind === 'cancel' ? <CancelModal task={t} onClose={closeChild} /> : null}
      {t && child.kind === 'edit' ? <EditTaskModal task={t} onClose={closeChild} /> : null}
      {child.kind === 'preview' ? (
        <FilePreviewModal
          storagePath={child.storagePath}
          fileName={child.fileName}
          fileType={child.fileType}
          kind="file"
          onClose={closeChild}
        />
      ) : null}
    </>
  );
}
