// The Route Card sheet's ⋯ row menu (owner-approved spec 2026-10-01):
//   Edit · Print · ─ · Move to Trash
// No View — the row click already opens the card.
//
// Hidden when the Access Control tier lacks the right; GREYED where the
// server would refuse on role (route-cards service): Edit needs role admin or
// manager, Delete role admin. Print runs the same click logic as the old row
// button (usePrintRouteCard); its Promise keeps the ⋯ busy until it fires.

import type { RouteCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useSession } from '@/lib/session';
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
  const { data: me } = useSession();
  const role = me?.role;
  const editBlocked = role !== undefined && role !== 'admin' && role !== 'manager';
  const deleteBlocked = role !== undefined && role !== 'admin';

  return (
    <RowActions
      // Edit is a ROUTE, so it stays a real link — ctrl-click still works.
      // When the role cannot save it, Edit is a greyed item instead.
      editTo={canEdit && !editBlocked ? `/route-cards/${rc.id}/edit` : undefined}
      renderLink={(p) => <Link {...p} />}
      items={[
        {
          key: 'edit-blocked',
          label: 'Edit',
          icon: 'pencil',
          hidden: !canEdit || !editBlocked,
          disabledReason: 'Needs admin or manager role',
        },
        { key: 'print', label: 'Print', icon: 'printer', onSelect: print.start },
        {
          key: 'delete-blocked',
          label: 'Move to Trash',
          icon: 'trash-2',
          group: 'danger',
          hidden: !onDelete || !deleteBlocked,
          disabledReason: 'Only an admin can delete',
        },
      ]}
      // Caller-owned confirm (routes/list.tsx): it asks for the reason, owns
      // the wait, and keeps a failure on screen inside the dialog.
      onDelete={deleteBlocked ? undefined : onDelete}
      // Every row's Delete greys out while one is in flight.
      deleteDisabled={deleteDisabled}
    />
  );
}
