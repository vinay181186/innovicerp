import React from 'react';
const MAP = {
  so: { draft: 'amber', open: 'blue', closed: 'green', dispatched: 'cyan', cancelled: 'grey' },
  jc: { open: 'grey', qc_pending: 'amber', complete: 'cyan', closed: 'green', no_ops: 'red' },
  jcop: { waiting: 'red', available: 'blue', in_progress: '', running: '', qc_pending: 'amber', complete: 'green', pr_raised: 'amber', po_created: 'blue', at_vendor: '', received: 'cyan', ready_for_pr: 'amber', outsource: 'amber' },
  pr: { open: 'amber', approved: 'blue', po_created: 'green', cancelled: 'red' },
  po: { draft: 'grey', open: 'blue', partial: 'amber', qc_pending: 'amber', closed: 'green', cancelled: 'grey' },
  prodorder: { open: 'amber', partially_closed: 'blue', closed: 'green' },
  grnqc: { pending: 'amber', in_progress: 'blue', completed: 'green' },
  dc: { issued: 'amber', received: 'green', cancelled: 'grey' },
  nc: { pending: 'amber', disposed: 'blue', under_rework: 'amber', under_repair: 'amber', sent_to_vendor: 'blue', received_qc_pending: 'blue', rework_done: 'cyan', closed: 'green' },
  ncdisp: { rework: 'cyan', repair: 'cyan', scrap: 'red', use_as_is: 'green', return_to_vendor: 'orange', make_fresh: 'blue' },
  txn: { in: 'green', out: 'amber', adjust: 'grey' },
  active: { active: 'green', inactive: 'red', true: 'green', false: 'red' },
  rating: { a: 'green', b: 'blue', c: 'amber', d: 'red' },
  task: { todo: 'amber', to_do: 'amber', in_progress: 'blue', completed: 'green', cancelled: 'grey' },
  grn: { pending: 'amber', qc_pending: 'amber', close: 'green', qc_cleared: 'green', against_po: 'grey', against_dc: 'cyan', against_nc: 'red' },
  run: { running: 'green', done: 'grey', stopped: 'red' },
  doc: { open: 'amber', in_planning: 'amber', draft: 'amber', pending: 'amber', unpaid: 'amber', completed: 'green', closed: 'green', paid: 'green', approved: 'green', received: 'green', dispatched: 'green', in_progress: 'blue', assembled: 'blue', partial: 'blue', partially_paid: 'blue', sent: 'blue', cancelled: 'red', rejected: 'red', overdue: 'red' },
};
const LABELS = { jcop: { at_vendor: 'Processing', received: 'Incoming QC' }, ncdisp: { scrap: 'Reject / Scrap' }, task: { todo: 'To Do', to_do: 'To Do' }, grn: { pending: 'QC Pending', close: 'QC Cleared' }, active: { true: 'Active', false: 'Inactive' } };
export function StatusBadge({ kind = 'so', status, label }) {
  let key = String(status).toLowerCase().replace(/ /g, '_');
  if (kind === 'rating') key = key.replace(/[^a-z]/g, '').charAt(0);
  const m = MAP[kind] || MAP.doc;
  const tone = key in m ? m[key] : 'grey';
  const text = label || (LABELS[kind] && LABELS[kind][key]) || (kind === 'rating' ? '⭐' + String(status).toUpperCase() : String(status).replace(/_/g, ' '));
  return <span className={('badge ' + (tone ? 'b-' + tone : '')).trim()}>{text}</span>;
}
const PRI = { urgent: ['var(--red2)', 700], high: ['var(--amber2)', 700], normal: ['var(--text2)', 600], low: ['var(--text3)', 600] };
export function PriorityText({ priority = 'normal' }) {
  const [c, w] = PRI[String(priority).toLowerCase()] || PRI.normal;
  return <span style={{ color: c, fontWeight: w }}>{String(priority).charAt(0).toUpperCase() + String(priority).slice(1).toLowerCase()}</span>;
}
