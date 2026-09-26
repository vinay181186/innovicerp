import type { ComputedJcOpStatus, RunningOpStatus } from '@innovic/shared';

// Badge modifier per legacy `badge()` (HTML L1959-1970), which is the colour
// function Op Entry's Ready-to-Process table calls at L5268. The previous map
// here was Tailwind tone classes citing lines that hold no colour table.
//
// Two legacy keys resolve to modifiers that its MAIN stylesheet never defines:
// 'In Progress'/'At Vendor' -> .b-yellow and 'Running' -> .b-running. Both are
// declared only inside the print-window stylesheet written by document.write
// (HTML L10555-10561), so on the legacy SCREEN they render as a bare `.badge`
// with no fill. We reproduce that by emitting `badge` alone — matching legacy's
// rendering while using only classes that exist in innovic-theme.css.
// Wave 2 (owner, 2026-09-26) overrides the legacy note above: in_progress now
// reads "Partly Completed" (amber) and running (an open session) is green.
const JC_OP_BADGE: Record<ComputedJcOpStatus, string> = {
  waiting: 'b-grey',
  available: 'b-blue',
  in_progress: 'b-amber', // Partly Completed — some qty done, no open session
  running: 'b-green', // an open machine session
  qc_pending: 'b-amber',
  complete: 'b-green',
  pr_raised: 'b-amber',
  po_created: 'b-blue',
  at_vendor: '', // legacy b-yellow — undefined on screen
  received: 'b-cyan',
  ready_for_pr: 'b-amber',
  outsource: 'b-amber',
};

const RUNNING_TONE: Record<RunningOpStatus, string> = {
  running: 'bg-green-500/15 text-green-700 dark:text-green-300',
  done: 'bg-muted text-muted-foreground',
  stopped: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const LABELS: Record<ComputedJcOpStatus, string> = {
  waiting: 'Waiting',
  available: 'Available',
  in_progress: 'Partly Completed',
  running: 'Running',
  qc_pending: 'QC Pending',
  complete: 'Completed',
  pr_raised: 'PR Raised',
  po_created: 'PO Created',
  at_vendor: 'At Vendor',
  received: 'Received – QC Pending',
  ready_for_pr: 'Ready for PR',
  outsource: 'Outsource',
};

export function JcOpStatusBadge({ status }: { status: ComputedJcOpStatus }) {
  return <span className={`badge ${JC_OP_BADGE[status]}`.trim()}>{LABELS[status]}</span>;
}

export function RunningOpStatusBadge({ status }: { status: RunningOpStatus }) {
  const text = status === 'running' ? 'Running' : status === 'done' ? 'Completed' : 'Stopped';
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${RUNNING_TONE[status]}`}
    >
      {text}
    </span>
  );
}
