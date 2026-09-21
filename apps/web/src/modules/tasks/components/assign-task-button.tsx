// Contextual "Assign to user 👤+" button (ISSUE-014). Ports legacy
// _assignTaskFromContext (legacy/InnovicERP_v82_12_3.html L14360): a small
// button dropped onto record screens (SO, PR, PO, NC, CAPA, JC, GRN, Design
// Issues) that opens the Assign Task modal pre-filled with a `linkedRef` so the
// assignee sees a direct link in their My Work list. ADR-176: any logged-in
// user may assign a task (the admin/manager gate is gone); the modal loads its
// user options only once it opens, so importing this onto a screen costs no
// extra request.

import type { TaskLinkedRef } from '@innovic/shared';
import { useState } from 'react';
import { AssignTaskModal } from './task-modals';

export function AssignTaskButton({
  linkedRef,
  suggestedTitle,
  className,
  label = 'Assign',
}: {
  linkedRef: TaskLinkedRef;
  suggestedTitle?: string | undefined;
  className?: string | undefined;
  label?: string | undefined;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className ?? 'btn btn-ghost btn-sm'}
        title="Assign a task to a user, linked to this record"
        onClick={() => setOpen(true)}
      >
        👤+ {label}
      </button>
      {open ? (
        <AssignTaskModal
          linkedRef={linkedRef}
          suggestedTitle={suggestedTitle}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
