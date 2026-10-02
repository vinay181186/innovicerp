// JC Operations board — the ⋯ row menu and its link renderer. Moved out of
// jc-ops-columns.tsx (which reached the 400-line rule when the columns gained
// their server Sort & Filter fields, ADR-201); jc-ops-columns re-exports them
// so existing imports keep working.

import type { JcOpsBoardRow } from '@innovic/shared';
import { renderRowMenuLink, type RowMenuItem } from '@/ui/data';
import type { RenderLink } from '@/ui/layout';

const isOutsource = (o: JcOpsBoardRow): boolean => o.opType === 'outsource';
const outsourceStatusOf = (o: JcOpsBoardRow): string => o.outsourceStatus || 'pending';

export interface JcOpsActionProps {
  canWrite: boolean;
  canCreatePr: boolean;
  canOpEntry: boolean;
  onEdit: (o: JcOpsBoardRow) => void;
  onCreatePr: (o: JcOpsBoardRow) => void;
  onOutsource: (o: JcOpsBoardRow) => void;
}

/** The ⋯ menu's link renderer: Start / Log Op deep-link to `/op-entry?…`.
 *  Kept under its old name for the boards that import it; the shared
 *  `renderRowMenuLink` splits the query into the router's `search`. */
export const renderJcOpsLink: RenderLink = renderRowMenuLink;

/**
 * The row's ⋯ menu items — only the ones valid for that op (owner-approved
 * spec 2026-10-01). An item the user has no right to is left out; one the
 * server would refuse for this op's state is greyed with the reason. The
 * outsource state that used to sit in the action cell as text ("PR: …",
 * "PO: …", "At Vendor (n pcs)") now shows in the Outsource Status column, and
 * "✓ Locked / 🔒 Running" is Change Machine's greyed reason.
 */
export function jcOpsRowMenu(o: JcOpsBoardRow, p: JcOpsActionProps): RowMenuItem[] {
  if (isOutsource(o)) {
    // Legacy L11369 — raise a PR from a pending outsource op. The server-side
    // cascade stamps this op as pr_raised + links the new PR.
    return [
      {
        key: 'raise-pr',
        label: 'Raise PR',
        icon: 'plus',
        group: 'workflow',
        hidden: !p.canCreatePr,
        disabledReason: outsourceStatusOf(o) === 'pending' ? undefined : 'PR already raised',
        onSelect: () => p.onCreatePr(o),
      },
    ];
  }

  const running = o.status === 'running';
  const complete = o.status === 'complete';
  // Running / complete op: why the server refuses a machine change or an
  // outsource send for it.
  const stateReason = complete ? 'Completed' : running ? 'Running — stop it first' : undefined;
  // ▶ Start / ✚ Log — the Job Queue's rule: an in-house op with pieces waiting
  // and no session running is the next thing to do. Pieces already made →
  // Log Op (the Complete half); none yet → Start Operation.
  const logging = o.completed > 0;
  const startReason = running
    ? 'Already running'
    : complete
      ? 'Completed'
      : o.available > 0
        ? undefined
        : 'Nothing Pending';
  const opEntryTo = `/op-entry?${new URLSearchParams({
    jc: o.jcCode,
    op: o.jcOpId,
    mode: logging ? 'complete' : 'start',
  }).toString()}`;

  return [
    {
      key: 'start',
      label: logging ? 'Log Op' : 'Start Operation',
      icon: logging ? 'plus' : 'play',
      group: 'workflow',
      hidden: !p.canOpEntry,
      disabledReason: startReason,
      ...(startReason ? {} : { to: opEntryTo }),
    },
    {
      // ADR-125 — a half-done op CAN change machine (each op_log row carries
      // the machine that made its qty). Blocked only when 'complete' or a
      // session is running, matching changeJcOpMachine exactly.
      key: 'change-machine',
      label: 'Change Machine',
      icon: 'settings',
      group: 'workflow',
      hidden: !p.canWrite,
      disabledReason: stateReason,
      onSelect: () => p.onEdit(o),
    },
    {
      // ADR-081 — send the remaining qty out. Qty already covered by open PRs
      // is not on the row; the server refuses it and the dialog shows why.
      key: 'outsource',
      label: 'Outsource Available',
      icon: 'truck',
      group: 'workflow',
      hidden: !p.canWrite || o.opType !== 'process',
      disabledReason: stateReason ?? (o.available > 0 ? undefined : 'Nothing Pending'),
      onSelect: () => p.onOutsource(o),
    },
  ];
}
