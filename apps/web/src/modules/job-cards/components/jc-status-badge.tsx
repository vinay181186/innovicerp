import type { JcComputedStatus } from '@innovic/shared';

const STYLES: Record<JcComputedStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  qc_pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  complete: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  closed: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  no_ops: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const LABELS: Record<JcComputedStatus, string> = {
  open: 'open',
  qc_pending: 'qc pending',
  complete: 'complete',
  closed: 'closed',
  no_ops: 'no ops',
};

export function JcStatusBadge(props: { status: JcComputedStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[props.status]}`}
    >
      {LABELS[props.status]}
    </span>
  );
}
