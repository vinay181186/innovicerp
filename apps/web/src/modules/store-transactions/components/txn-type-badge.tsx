import type { StoreTxnType } from '@innovic/shared';

const STYLES: Record<StoreTxnType, string> = {
  in: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  out: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  adjust: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

export function TxnTypeBadge(props: { type: StoreTxnType }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[props.type]}`}
    >
      {props.type}
    </span>
  );
}
