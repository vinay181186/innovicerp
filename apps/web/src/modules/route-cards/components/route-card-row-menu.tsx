// The Route Card sheet's ⋯ row menu (owner-approved spec 2026-10-01):
//   Show operations · Edit · Preview · Download PDF · Submit for Approval · ─ · Move to Trash
// "Show operations" opens the op sequence under the row — it replaced the
// row's ▸ (no ▸ on a list row, owner 2026-10-31).
// No View — the row click already opens the card.
//
// ADR-232: the Access Control ticks alone decide — Edit shows per the shared
// canEditRouteCard rule (ADR-277), Move to Trash only for Super Admin (the caller
// passes onDelete only then), greyed on a card with the approver. Submit for
// Approval: the caller passes onSubmitForApproval only when it is allowed.
// Preview / Download PDF run usePrintRouteCard
// (lazy fetch on the click); its Promise keeps the ⋯ busy until it fires.

import type { RouteCardListItem } from '@innovic/shared';
import { ROUTE_CARD_LOCKED_MESSAGE, isRouteCardLocked } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { RowActions } from '@/ui/layout';
import { usePrintRouteCard } from './print-route-card-button';

export function RouteCardRowMenu({
  rc,
  opsOpen,
  onToggleOps,
  canEdit,
  onSubmitForApproval,
  onDelete,
  deleteDisabled,
}: {
  rc: RouteCardListItem;
  /** The op sequence is open under this row. */
  opsOpen: boolean;
  onToggleOps: () => void;
  canEdit: boolean;
  /** Opens the page's own confirm; undefined = not allowed on this row. */
  onSubmitForApproval: (() => void) | undefined;
  /** Opens the page's own reason dialog; undefined = no delete right. */
  onDelete: (() => void) | undefined;
  deleteDisabled: boolean;
}): React.JSX.Element {
  const print = usePrintRouteCard(rc);

  return (
    <RowActions
      // Edit is a ROUTE, so it stays a real link — ctrl-click still works.
      editTo={canEdit ? `/route-cards/${rc.id}/edit` : undefined}
      renderLink={(p) => <Link {...p} />}
      items={[
        {
          key: 'ops',
          label: opsOpen ? 'Hide operations' : `Show operations (${rc.opCount})`,
          icon: 'eye',
          onSelect: onToggleOps,
        },
        { key: 'preview', label: 'Preview', icon: 'eye', onSelect: print.preview },
        { key: 'download', label: 'Download PDF', icon: 'download', onSelect: print.download },
        {
          key: 'submit',
          label: 'Submit for Approval',
          icon: 'check',
          group: 'workflow',
          hidden: !onSubmitForApproval,
          onSelect: onSubmitForApproval,
        },
        {
          // Caller-owned confirm (routes/list.tsx): it asks for the reason,
          // owns the wait, and keeps a failure on screen inside the dialog.
          key: 'delete',
          label: 'Move to Trash',
          icon: 'trash-2',
          group: 'danger',
          hidden: !onDelete,
          disabledReason: isRouteCardLocked(rc.approvalStatus)
            ? ROUTE_CARD_LOCKED_MESSAGE
            : deleteDisabled
              ? 'Working…'
              : undefined,
          onSelect: onDelete,
        },
      ]}
    />
  );
}
