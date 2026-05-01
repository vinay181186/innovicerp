import type { ComputedJcOpStatus, RunningOpStatus } from '@innovic/shared';

// Mirrors the legacy color palette (lines 4333, 5237, 5395 — green=complete,
// amber=qc/at_vendor, cyan=running, gray=waiting).
const JC_OP_TONE: Record<ComputedJcOpStatus, string> = {
  waiting: 'bg-muted text-muted-foreground',
  available: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  in_progress: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  running: 'bg-green-500/15 text-green-700 dark:text-green-300',
  qc_pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  complete: 'bg-green-600 text-white',
  pr_raised: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  po_created: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  at_vendor: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  received: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  ready_for_pr: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  outsource: 'bg-muted text-muted-foreground',
};

const RUNNING_TONE: Record<RunningOpStatus, string> = {
  running: 'bg-green-500/15 text-green-700 dark:text-green-300',
  done: 'bg-muted text-muted-foreground',
  stopped: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const LABELS: Record<ComputedJcOpStatus, string> = {
  waiting: 'Waiting',
  available: 'Available',
  in_progress: 'In Progress',
  running: 'Running',
  qc_pending: 'QC Pending',
  complete: 'Complete',
  pr_raised: 'PR Raised',
  po_created: 'PO Created',
  at_vendor: 'At Vendor',
  received: 'Received',
  ready_for_pr: 'Ready for PR',
  outsource: 'Outsource',
};

export function JcOpStatusBadge({ status }: { status: ComputedJcOpStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${JC_OP_TONE[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}

export function RunningOpStatusBadge({ status }: { status: RunningOpStatus }) {
  const text = status === 'running' ? 'Running' : status === 'done' ? 'Done' : 'Stopped';
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${RUNNING_TONE[status]}`}
    >
      {text}
    </span>
  );
}
