import type { NcStatus } from '@innovic/shared';

const STYLES: Record<NcStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  disposed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  rework_done: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  closed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

export function NcStatusBadge(props: { status: NcStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[props.status]}`}
    >
      {props.status.replaceAll('_', ' ')}
    </span>
  );
}
