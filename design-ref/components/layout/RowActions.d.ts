import * as React from 'react';
/** The Action cell: View · Edit · (extra) · Delete, fixed order, 13px Lucide icons named on hover; stops row-click propagation. */
export interface RowActionsProps {
  onView?: () => void;
  onEdit?: () => void;
  /** Delete ALWAYS confirms via ConfirmDialog (caller opens it) */
  onDelete?: () => void;
  /** Extra action buttons (Assign, + Line) — placed before Delete */
  extra?: React.ReactNode;
  /** Text buttons (Edit / Del) for nested line tables and cards */
  labelled?: boolean;
}
export declare function RowActions(props: RowActionsProps): React.JSX.Element;
