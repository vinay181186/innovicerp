// Contextual "Assign to user 👤+" button (ISSUE-014). Ports legacy
// _assignTaskFromContext (legacy/InnovicERP_v82_12_3.html L14360): a small
// button dropped onto record screens (SO, PR, PO, NC, CAPA, JC, GRN, Design
// Issues) that opens the Assign Task modal pre-filled with a `linkedRef` so the
// assignee sees a direct link in their My Work list. Gated to admin/manager —
// renders nothing for other roles. User options are fetched lazily (only once
// the modal opens) so importing this onto a screen costs no extra request.

import type { TaskLinkedRef } from '@innovic/shared';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { useTaskUserOptions } from '../api';
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
  const { data: me } = useSession();
  const canAssign = me?.role === 'admin' || me?.role === 'manager';
  const [open, setOpen] = useState(false);
  const { data: userOpts } = useTaskUserOptions(open);

  if (!canAssign) return null;

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
          users={userOpts?.options ?? []}
          linkedRef={linkedRef}
          suggestedTitle={suggestedTitle}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
