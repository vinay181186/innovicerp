// The Job Cards sheet's ⋯ row menu (owner-approved spec 2026-10-01):
//   Edit · Print · Download Excel · Assign Task · ─ · Move to Trash
// No View — the row click already opens the Job Card. The card view keeps its
// own text buttons (RowActions `labelled` in routes/list.tsx).
//
// Print and Download Excel run the SAME click logic as the old row buttons
// (usePrintJc / useExcelJc: lazy fetch, spinner, popup-blocked alert, one
// print per click); their Promise keeps the ⋯ busy until the job has fired.
// Assign Task opens the same modal the old button did; it is hidden for a
// viewer, whom the server refuses.

import type { JobCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSession } from '@/lib/session';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { RowActions } from '@/ui/layout';
import { useExcelJc } from './excel-jc-button';
import { usePrintJc } from './print-jc-button';

export function JcRowMenu({
  jc,
  canEdit,
  onDelete,
  deleteDisabled,
}: {
  jc: JobCardListItem;
  canEdit: boolean;
  /** Undefined when the user may not delete — the item is then left out. */
  onDelete: (() => Promise<void>) | undefined;
  deleteDisabled: boolean;
}): React.JSX.Element {
  const print = usePrintJc(jc);
  const excel = useExcelJc(jc);
  const { data: me } = useSession();
  const [assigning, setAssigning] = useState(false);

  return (
    // The modal sits in the row's cell, so its clicks must not reach the row.
    <span onClick={(e) => e.stopPropagation()}>
      <RowActions
        // Edit is a ROUTE, so it stays a real link — ctrl-click still works.
        editTo={canEdit ? `/job-cards/${jc.id}/edit` : undefined}
        renderLink={(p) => <Link {...p} />}
        items={[
          { key: 'print', label: 'Print', icon: 'printer', onSelect: print.start },
          { key: 'excel', label: 'Download Excel', icon: 'download', onSelect: excel.start },
          {
            key: 'assign',
            label: 'Assign Task',
            icon: 'user-round',
            group: 'assign',
            hidden: !me || me.role === 'viewer',
            onSelect: () => setAssigning(true),
          },
        ]}
        onDelete={onDelete}
        deleteDisabled={deleteDisabled}
        deleteConfirm={{
          title: `Move Job Card ${jc.code} to Trash?`,
          message: `${itemCodeWithRev(jc.itemCode, jc.itemRevision)} stops appearing in Job Cards, on the shop floor and in Op Entry. You can restore it from Trash.`,
          confirmLabel: 'Move to Trash',
          pendingLabel: 'Moving to Trash…',
        }}
      />
      {assigning ? (
        <AssignTaskModal
          linkedRef={{
            type: 'job_card',
            id: jc.id,
            display: `JC ${jc.code}`,
            navPage: '/job-cards',
          }}
          suggestedTitle={`Follow up on JC ${jc.code}`}
          onClose={() => setAssigning(false)}
        />
      ) : null}
    </span>
  );
}
