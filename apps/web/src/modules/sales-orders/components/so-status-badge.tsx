import type { SoStatus } from '@innovic/shared';

const STYLES: Record<SoStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  closed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  dispatched: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  cancelled: 'bg-zinc-100 text-zinc-600 line-through dark:bg-zinc-800 dark:text-zinc-400',
};

export function SoStatusBadge(props: { status: SoStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[props.status]}`}
    >
      {props.status}
    </span>
  );
}
