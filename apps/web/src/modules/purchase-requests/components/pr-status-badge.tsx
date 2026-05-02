import type { PrStatus } from '@innovic/shared';

const STYLES: Record<PrStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  approved: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  po_created: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  cancelled: 'bg-zinc-100 text-zinc-600 line-through dark:bg-zinc-800 dark:text-zinc-400',
};

export function PrStatusBadge(props: { status: PrStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[props.status]}`}
    >
      {props.status.replaceAll('_', ' ')}
    </span>
  );
}
