// The Route Card sheet's ⋯ row menu (owner-approved spec 2026-10-01):
//   Edit · Print · ─ · Move to Trash
// No View — the row click already opens the card.
//
// ADR-232: the Access Control ticks alone decide — Edit shows with the
// routecard_create Edit right, Move to Trash only for Super Admin (the caller
// passes onDelete only then). Print runs the same click logic as the old row
// button (usePrintRouteCard); its Promise keeps the ⋯ busy until it fires.

import type { RouteCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { RowActions } from '@/ui/layout';
import { usePrintRouteCard } from './print-route-card-button';

export function RouteCardRowMenu({
  rc,
  canEdit,
  onDelete,
  deleteDisabled,
}: {
  rc: RouteCardListItem;
  canEdit: boolean;
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
        { key: 'print', label: 'Print', icon: 'printer', onSelect: print.start },
        {
          // Caller-owned confirm (routes/list.tsx): it asks for the reason,
          // owns the wait, and keeps a failure on screen inside the dialog.
          key: 'delete',
          label: 'Move to Trash',
          icon: 'trash-2',
          group: 'danger',
          hidden: !onDelete,
          disabledReason: deleteDisabled ? 'Working…' : undefined,
          onSelect: onDelete,
        },
      ]}
    />
  );
}
