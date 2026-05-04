import type { NcDisposition } from '@innovic/shared';

const STYLES: Record<NcDisposition, string> = {
  rework: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  scrap: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  use_as_is: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  return_to_vendor: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  make_fresh: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

export function NcDispositionBadge(props: { disposition: NcDisposition | null }) {
  if (!props.disposition) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[props.disposition]}`}
    >
      {props.disposition.replaceAll('_', ' ')}
    </span>
  );
}
