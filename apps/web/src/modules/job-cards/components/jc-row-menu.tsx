// The Job Cards sheet's ⋯ row menu (owner-approved spec 2026-10-01):
//   Edit · Preview · Download PDF · Download Excel · Assign Task · ─ · Cancel JC ·
//   Move to Trash. A Cancelled card (ADR-235) keeps only Preview · Download PDF.
// No View — the row click already opens the Job Card. The card view keeps its
// own text buttons (RowActions `labelled` in routes/list.tsx).
//
// Preview / Download PDF (usePrintJc → the in-app Preview box or a saved PDF)
// and Download Excel (useExcelJc) fetch lazily on the click; their Promise
// keeps the ⋯ busy until the job has fired.
// Assign Task opens the same modal the old button did; it shows only to a
// user holding the Job Card page's Advance right (ADR-232).

import type { JobCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { RowActions } from '@/ui/layout';
import { useExcelJc } from './excel-jc-button';
import { isJcCancelled } from './jc-list-columns';
import { usePrintJc } from './print-jc-button';

export function JcRowMenu({
  jc,
  canEdit,
  onDelete,
  deleteDisabled,
  draft,
  onCancel,
}: {
  jc: JobCardListItem;
  canEdit: boolean;
  /** Undefined when the user may not delete — the item is then left out. */
  onDelete: (() => Promise<void>) | undefined;
  deleteDisabled: boolean;
  /** ADR-202 — the JC has a pending edit; its printout shows "Draft". */
  draft?: boolean | undefined;
  /** ADR-235 — opens the ONE Cancel dialog; undefined hides "Cancel JC". */
  onCancel?: (() => void) | undefined;
}): React.JSX.Element {
  const print = usePrintJc(jc, draft);
  const excel = useExcelJc(jc);
  const { data: eff } = useMyAccess();
  // ADR-232: Assign = the page's Advance right.
  const canAssign = effectiveFormPerms(eff, 'jc_create').advance;
  const [assigning, setAssigning] = useState(false);
  // ADR-235 — a Cancelled card is read-only: only Preview / Download PDF.
  const cancelled = isJcCancelled(jc);

  return (
    // The modal sits in the row's cell, so its clicks must not reach the row.
    <span onClick={(e) => e.stopPropagation()}>
      <RowActions
        // Edit is a ROUTE, so it stays a real link — ctrl-click still works.
        editTo={canEdit && !cancelled ? `/job-cards/${jc.id}/edit` : undefined}
        renderLink={(p) => <Link {...p} />}
        items={[
          { key: 'preview', label: 'Preview', icon: 'eye', onSelect: print.preview },
          {
            key: 'download',
            label: 'Download PDF',
            icon: 'download',
            onSelect: print.download,
          },
          {
            key: 'excel',
            label: 'Download Excel',
            icon: 'download',
            hidden: cancelled,
            onSelect: excel.start,
          },
          {
            key: 'assign',
            label: 'Assign Task',
            icon: 'user-round',
            group: 'assign',
            hidden: !canAssign || cancelled,
            onSelect: () => setAssigning(true),
          },
          {
            key: 'cancel',
            label: 'Cancel JC',
            icon: 'x',
            group: 'danger',
            // A Production Order's card is cancelled with its order (ADR-235).
            hidden: !onCancel || cancelled || jc.productionOrderId != null,
            onSelect: () => onCancel?.(),
          },
        ]}
        onDelete={cancelled ? undefined : onDelete}
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
