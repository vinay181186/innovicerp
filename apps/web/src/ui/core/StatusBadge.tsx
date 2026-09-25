// StatusBadge — the ONE document-status chip.
//
// MAP and LABELS are carried VERBATIM from
// design-ref/components/core/StatusBadge.jsx. Do not "tidy" a tone here: each
// one reproduces a legacy colour decision, and several look wrong out of
// context on purpose (see the notes under the map).
//
// This component replaces eleven per-module badge files in Phase 4:
//   sales-orders/components/so-status-badge.tsx          → kind="so"
//   job-cards/components/jc-status-badge.tsx             → kind="jc"
//   op-entry/components/status-badge.tsx JcOpStatusBadge → kind="jcop"
//   op-entry/components/status-badge.tsx RunningOp…      → kind="run"
//   purchase-requests/components/pr-status-badge.tsx     → kind="pr"
//   purchase-orders/components/po-status-badge.tsx       → kind="po"
//   production-orders/components/po-status-badge.tsx     → kind="prodorder"
//   goods-receipt-notes/components/qc-status-badge.tsx   → kind="grnqc"
//   delivery-challans/components/dc-status-badge.tsx     → kind="dc"
//   nc-register/components/nc-status-badge.tsx           → kind="nc"
//   nc-register/components/nc-disposition-badge.tsx      → kind="ncdisp"
//   store-transactions/components/txn-type-badge.tsx     → kind="txn"
// Every status each of those files declares is present in the map below —
// checked against the shared enums, not against the badge files alone.

import type { BadgeTone } from './Badge';

/**
 * so · jc · jcop (JC operation) · pr · po · prodorder (Production Order) ·
 * grnqc · grn · dc · nc · ncdisp (NC disposition) · txn (store txn) ·
 * invoice · task · run (running op) · active (Active/Inactive) · rating (⭐A–D) ·
 * doc (the generic related-docs fallback).
 */
export type StatusKind =
  | 'so'
  | 'jc'
  | 'jcop'
  | 'pr'
  | 'po'
  | 'prodorder'
  | 'grnqc'
  | 'dc'
  | 'nc'
  | 'ncdisp'
  | 'txn'
  | 'invoice'
  | 'active'
  | 'rating'
  | 'task'
  | 'grn'
  | 'run'
  | 'doc';

/**
 * A tone, or '' for a DELIBERATELY UNFILLED badge. The legacy stylesheet
 * defined `.b-yellow` / `.b-running` only inside the print window, so on
 * screen those three JC-op states rendered as a bare `.badge`. Reproduced.
 */
type StatusTone = BadgeTone | '';

const MAP: Record<StatusKind, Record<string, StatusTone>> = {
  so: { draft: 'amber', open: 'blue', closed: 'green', dispatched: 'cyan', cancelled: 'grey' },
  jc: { open: 'grey', qc_pending: 'amber', complete: 'cyan', closed: 'green', no_ops: 'red' },
  jcop: {
    waiting: 'red',
    available: 'blue',
    in_progress: '',
    running: '',
    qc_pending: 'amber',
    complete: 'green',
    pr_raised: 'amber',
    po_created: 'blue',
    at_vendor: '',
    received: 'cyan',
    ready_for_pr: 'amber',
    outsource: 'amber',
  },
  pr: { open: 'amber', approved: 'blue', po_created: 'green', cancelled: 'red' },
  po: {
    draft: 'grey',
    open: 'blue',
    partial: 'amber',
    qc_pending: 'amber',
    closed: 'green',
    cancelled: 'grey',
  },
  prodorder: { open: 'amber', partially_closed: 'blue', closed: 'green' },
  grnqc: { pending: 'amber', in_progress: 'blue', completed: 'green' },
  dc: { issued: 'amber', received: 'green', cancelled: 'grey' },
  nc: {
    pending: 'amber',
    disposed: 'blue',
    under_rework: 'amber',
    under_repair: 'amber',
    sent_to_vendor: 'blue',
    received_qc_pending: 'blue',
    rework_done: 'cyan',
    closed: 'green',
  },
  ncdisp: {
    rework: 'cyan',
    repair: 'cyan',
    scrap: 'red',
    use_as_is: 'green',
    return_to_vendor: 'orange',
    make_fresh: 'blue',
  },
  txn: { in: 'green', out: 'amber', adjust: 'grey' },
  // Invoice payment state. The set is closed — packages/shared/src/enums/
  // invoice-status.ts declares exactly unpaid | partial | paid — and these are
  // the app's OWN colours, carried from invoices/routes/detail.tsx:151
  // (`paid ? b-green : partial ? b-amber : b-red`).
  // RED FOR UNPAID IS A WARNING SIGNAL the business reads off the list; do not
  // soften it to the generic `doc` map's amber. `doc` also paints `partial`
  // blue, which is why invoices need their own kind rather than that fallback.
  invoice: { unpaid: 'red', partial: 'amber', paid: 'green' },
  active: { active: 'green', inactive: 'red', true: 'green', false: 'red' },
  rating: { a: 'green', b: 'blue', c: 'amber', d: 'red' },
  task: {
    todo: 'amber',
    to_do: 'amber',
    in_progress: 'blue',
    completed: 'green',
    cancelled: 'grey',
  },
  grn: {
    pending: 'amber',
    qc_pending: 'amber',
    close: 'green',
    qc_cleared: 'green',
    against_po: 'grey',
    against_dc: 'cyan',
    against_nc: 'red',
  },
  run: { running: 'green', done: 'grey', stopped: 'red' },
  doc: {
    open: 'amber',
    in_planning: 'amber',
    draft: 'amber',
    pending: 'amber',
    unpaid: 'amber',
    completed: 'green',
    closed: 'green',
    paid: 'green',
    approved: 'green',
    received: 'green',
    dispatched: 'green',
    in_progress: 'blue',
    assembled: 'blue',
    partial: 'blue',
    partially_paid: 'blue',
    sent: 'blue',
    cancelled: 'red',
    rejected: 'red',
    overdue: 'red',
  },
};

// Where the enum key is not the words the document uses. Everything else falls
// back to the key with underscores turned into spaces (the CSS uppercases it).
const LABELS: Partial<Record<StatusKind, Record<string, string>>> = {
  jcop: { at_vendor: 'Processing', received: 'Incoming QC' },
  ncdisp: { scrap: 'Reject / Scrap' },
  task: { todo: 'To Do', to_do: 'To Do' },
  grn: { pending: 'QC Pending', close: 'QC Cleared' },
  active: { true: 'Active', false: 'Inactive' },
};

/**
 * Read through a string key so an unknown `kind` — widened to `string` by
 * data, cast with `as StatusKind`, or a new enum member added before this map
 * is updated — comes back undefined instead of typechecking into a crash.
 */
const KIND_MAPS = MAP as Record<string, Record<string, StatusTone> | undefined>;

export interface StatusBadgeProps {
  /** Which module's map to read. Defaults to `so`; `doc` is the generic fallback. */
  kind?: StatusKind;
  /**
   * The enum value. "qc_pending", "QC Pending" and "qc pending" all resolve the
   * same. Null, undefined or blank renders the quiet em dash, NOT a badge.
   */
  status: string | null | undefined;
  /** Override the rendered text — e.g. a label map that lives in @innovic/shared. */
  label?: string;
  title?: string;
  className?: string;
}

export function StatusBadge({ kind = 'so', status, label, title, className }: StatusBadgeProps) {
  // A nullable status column has no chip. modules/nc-register/components/
  // nc-disposition-badge.tsx renders `<span className="text3">—</span>` for a
  // null disposition today; without this branch String(null) would paint a
  // grey badge reading "NULL" and Phase 4 could not swap that file out.
  if (!label && (status === null || status === undefined || String(status).trim() === '')) {
    const emptyCls = ['text3', className].filter(Boolean).join(' ');
    return (
      <span className={emptyCls} title={title}>
        —
      </span>
    );
  }

  const raw = String(status ?? '');
  let key = raw.toLowerCase().replace(/ /g, '_');
  // A rating arrives as "A", "⭐A" or "a" — reduce it to the single letter.
  if (kind === 'rating') key = key.replace(/[^a-z]/g, '').charAt(0);

  // design-ref/components/core/StatusBadge.jsx:25 — `MAP[kind] || MAP.doc`.
  // An unmapped kind degrades to the generic document map; it never throws.
  const m = KIND_MAPS[kind] ?? MAP.doc;
  // `??`, not `||`: '' is a DELIBERATE tone (the unfilled JC-op states above)
  // and must survive.
  const tone = m[key] ?? 'grey';
  const text =
    label ??
    LABELS[kind]?.[key] ??
    (kind === 'rating' ? `⭐${raw.toUpperCase()}` : raw.replace(/_/g, ' '));

  const cls = ['badge', tone ? `b-${tone}` : '', className].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title}>
      {text}
    </span>
  );
}

export type Priority = 'urgent' | 'high' | 'normal' | 'low';

interface PriorityStyle {
  color: string;
  fontWeight: number;
}

// Priority is TEXT, not a badge — it sits inside a task row beside other text
// and a chip there would compete with the task's own status badge.
const PRI: Record<Priority, PriorityStyle> = {
  urgent: { color: 'var(--red2)', fontWeight: 700 },
  high: { color: 'var(--amber2)', fontWeight: 700 },
  normal: { color: 'var(--text2)', fontWeight: 600 },
  low: { color: 'var(--text3)', fontWeight: 600 },
};

function isPriority(value: string): value is Priority {
  return value === 'urgent' || value === 'high' || value === 'normal' || value === 'low';
}

export interface PriorityTextProps {
  priority?: Priority | string;
  className?: string;
}

export function PriorityText({ priority = 'normal', className }: PriorityTextProps) {
  const raw = String(priority);
  const key = raw.toLowerCase();
  const style = isPriority(key) ? PRI[key] : PRI.normal;
  const text = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return (
    <span className={className} style={style}>
      {text}
    </span>
  );
}
