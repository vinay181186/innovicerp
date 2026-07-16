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

// Legacy `renderAlerts` sets the dept colour inline from its own `deptColors`
// map (L22333) using raw hexes. Nearest token for each, per ISSUE-067 (map to
// tokens, never copy the literal):
//   sales      #22C55E → --green   · purchase   #2563EB → --blue  (exact)
//   store      #F59E0B → --amber   · design     #8B5CF6 → --purple
//   production #06B6D4 → --cyan    · qc         #EF4444 → --red
// NOT the --dept-* tints: legacy's own :root calls those "muted … not
// shout-colors" and renderAlerts deliberately uses the shout hexes.
export const DEPT_COLOR: Record<AlertDept, string> = {
  sales: 'var(--green)',
  purchase: 'var(--blue)',
  store: 'var(--amber)',
  design: 'var(--purple)',
  production: 'var(--cyan)',
  qc: 'var(--red)',
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
