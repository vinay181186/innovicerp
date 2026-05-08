// Per-department display palette. Mirrors legacy `deptColors` (legacy
// HTML L22333) but mapped to Tailwind tokens that work in light + dark.

import type { AlertDept } from '@innovic/shared';

export const DEPT_LABEL: Record<AlertDept, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  store: 'Store',
  design: 'Design',
  production: 'Production',
  qc: 'QC',
};

export const DEPT_TONE: Record<AlertDept, { text: string; border: string }> = {
  sales: {
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-t-2 border-t-emerald-500',
  },
  purchase: { text: 'text-blue-600 dark:text-blue-400', border: 'border-t-2 border-t-blue-500' },
  store: { text: 'text-amber-600 dark:text-amber-400', border: 'border-t-2 border-t-amber-500' },
  design: {
    text: 'text-violet-600 dark:text-violet-400',
    border: 'border-t-2 border-t-violet-500',
  },
  production: { text: 'text-cyan-600 dark:text-cyan-400', border: 'border-t-2 border-t-cyan-500' },
  qc: { text: 'text-rose-600 dark:text-rose-400', border: 'border-t-2 border-t-rose-500' },
};
